package api

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"time"

	"vault/internal/crypto"
	"vault/internal/db"
	"vault/internal/stats"
)

const (
	defaultBenchRuns = 10
	maxBenchRuns     = 50
	maxClientRuns    = 200
)

type benchResult struct {
	Algorithm      string        `json:"algorithm"`
	VerifyNs       int64         `json:"verify_ns"`
	Cipher         stats.Summary `json:"cipher"`
	Total          stats.Summary `json:"total"`
	ThroughputMBps float64       `json:"throughput_mbps"`
	CipherNs       []int64       `json:"cipher_ns"`
}

// benchmarkFile decrypts every variant of a file runs times and reports
// statistics. The HMAC is verified once per variant and timed separately,
// since it costs the same for every cipher. A warm-up pass loads the files
// into the page cache, and the algorithm order rotates each run so no
// cipher is systematically measured first.
func (s *Server) benchmarkFile(w http.ResponseWriter, r *http.Request, u db.User) {
	id := r.PathValue("id")
	if !uuidRe.MatchString(id) {
		writeError(w, http.StatusNotFound, "file tidak ditemukan")
		return
	}
	var in struct {
		Runs int `json:"runs"`
	}
	if err := decodeJSON(w, r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if in.Runs == 0 {
		in.Runs = defaultBenchRuns
	}
	if in.Runs < 1 || in.Runs > maxBenchRuns {
		writeError(w, http.StatusBadRequest, "runs harus antara 1 dan 50")
		return
	}
	variants, err := s.db.FileVariants(r.Context(), u.ID, id)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, "file tidak ditemukan")
		return
	}
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	keys, err := s.keys(u)
	if err != nil {
		s.serverError(w, r, err)
		return
	}

	type state struct {
		v      db.FileVariant
		alg    crypto.Algorithm
		f      *os.File
		res    benchResult
		totals []int64
	}
	states := make([]*state, 0, len(variants))
	defer func() {
		for _, st := range states {
			st.f.Close()
		}
	}()
	for _, fv := range variants {
		alg, err := crypto.ParseAlgorithm(fv.Variant.Algorithm)
		if err != nil {
			s.serverError(w, r, err)
			return
		}
		f, err := s.store.Open(fv.Variant.StoragePath)
		if err != nil {
			s.serverError(w, r, err)
			return
		}
		st := &state{v: fv.Variant, alg: alg, f: f, res: benchResult{Algorithm: string(alg)}}
		states = append(states, st)

		start := time.Now()
		err = keys.Verify(alg, fv.Variant.IV, fv.Variant.MAC, []byte(fv.ID), io.NewSectionReader(f, 0, fv.Variant.SizeCipher))
		if errors.Is(err, crypto.ErrAuth) {
			s.integrityError(w, r, "file ("+string(alg)+")")
			return
		}
		if err != nil {
			s.serverError(w, r, err)
			return
		}
		st.res.VerifyNs = time.Since(start).Nanoseconds()
	}

	decrypt := func(st *state) (crypto.Stats, error) {
		return keys.Decrypt(st.alg, st.v.IV, io.Discard, io.NewSectionReader(st.f, 0, st.v.SizeCipher))
	}
	for _, st := range states { // warm-up, not recorded
		if _, err := decrypt(st); err != nil {
			s.serverError(w, r, err)
			return
		}
	}

	var rows []db.Benchmark
	size := variants[0].SizePlain
	for run := 0; run < in.Runs; run++ {
		if r.Context().Err() != nil {
			return // client went away
		}
		for i := range states {
			st := states[(i+run)%len(states)]
			m, err := decrypt(st)
			if err != nil {
				s.serverError(w, r, err)
				return
			}
			st.res.CipherNs = append(st.res.CipherNs, m.CipherNs)
			st.totals = append(st.totals, m.TotalNs)
			rows = append(rows, db.Benchmark{FileID: &id, Algorithm: string(st.alg), Operation: "decrypt",
				Source: "server", Bytes: size, RunIndex: run, DurationNs: m.CipherNs})
		}
	}
	if err := s.db.InsertBenchmarks(context.WithoutCancel(r.Context()), u.ID, rows); err != nil {
		s.log.Error("record decrypt benchmark", "err", err)
	}

	results := make([]benchResult, 0, len(states))
	for _, st := range states {
		st.res.Cipher = stats.Summarize(st.res.CipherNs)
		st.res.Total = stats.Summarize(st.totals)
		st.res.ThroughputMBps = stats.Throughput(float64(size), st.res.Cipher.Mean)
		results = append(results, st.res)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"file_id": id,
		"bytes":   size,
		"runs":    in.Runs,
		"results": results,
	})
}

// recordClientBenchmark stores download times measured in the browser.
// The byte count comes from the database, not the client.
func (s *Server) recordClientBenchmark(w http.ResponseWriter, r *http.Request, u db.User) {
	var in struct {
		FileID      string  `json:"file_id"`
		Algorithm   string  `json:"algorithm"`
		DurationsNs []int64 `json:"durations_ns"`
	}
	if err := decodeJSON(w, r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	alg, err := crypto.ParseAlgorithm(in.Algorithm)
	if err != nil {
		writeError(w, http.StatusBadRequest, "algorithm harus AES, DES, atau RC4")
		return
	}
	if len(in.DurationsNs) < 1 || len(in.DurationsNs) > maxClientRuns {
		writeError(w, http.StatusBadRequest, "durations_ns harus berisi 1–200 nilai")
		return
	}
	for _, d := range in.DurationsNs {
		if d <= 0 || d > int64(time.Hour) {
			writeError(w, http.StatusBadRequest, "durasi harus positif dan kurang dari 1 jam")
			return
		}
	}
	if !uuidRe.MatchString(in.FileID) {
		writeError(w, http.StatusNotFound, "file tidak ditemukan")
		return
	}
	f, err := s.db.FileOwned(r.Context(), u.ID, in.FileID)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, "file tidak ditemukan")
		return
	}
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	rows := make([]db.Benchmark, len(in.DurationsNs))
	for i, d := range in.DurationsNs {
		rows[i] = db.Benchmark{FileID: &f.ID, Algorithm: string(alg), Operation: "download",
			Source: "client", Bytes: f.SizePlain, RunIndex: i, DurationNs: d}
	}
	if err := s.db.InsertBenchmarks(r.Context(), u.ID, rows); err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]int{"inserted": len(rows)})
}

func (s *Server) benchmarkSummary(w http.ResponseWriter, r *http.Request, u db.User) {
	rows, err := s.db.BenchmarkSummaries(r.Context(), u.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	type item struct {
		FileID         *string `json:"file_id"`
		Algorithm      string  `json:"algorithm"`
		Operation      string  `json:"operation"`
		Source         string  `json:"source"`
		Runs           int64   `json:"runs"`
		Bytes          float64 `json:"bytes"`
		MeanNs         float64 `json:"mean_ns"`
		MinNs          int64   `json:"min_ns"`
		MaxNs          int64   `json:"max_ns"`
		StddevNs       float64 `json:"stddev_ns"`
		ThroughputMBps float64 `json:"throughput_mbps"`
	}
	out := make([]item, 0, len(rows))
	for _, b := range rows {
		out = append(out, item{b.FileID, b.Algorithm, b.Operation, b.Source, b.Runs, b.AvgBytes,
			b.MeanNs, b.MinNs, b.MaxNs, b.StddevNs, stats.Throughput(b.AvgBytes, b.MeanNs)})
	}
	writeJSON(w, http.StatusOK, map[string]any{"summary": out})
}

const maxRawRows = 20000

func (s *Server) benchmarkRaw(w http.ResponseWriter, r *http.Request, u db.User) {
	rows, err := s.db.Benchmarks(r.Context(), u.ID, maxRawRows)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	type item struct {
		FileID     *string   `json:"file_id"`
		Algorithm  string    `json:"algorithm"`
		Operation  string    `json:"operation"`
		Source     string    `json:"source"`
		Bytes      int64     `json:"bytes"`
		RunIndex   int       `json:"run_index"`
		DurationNs int64     `json:"duration_ns"`
		CreatedAt  time.Time `json:"created_at"`
	}
	out := make([]item, 0, len(rows))
	for _, b := range rows {
		out = append(out, item{b.FileID, b.Algorithm, b.Operation, b.Source, b.Bytes, b.RunIndex, b.DurationNs, b.CreatedAt})
	}
	writeJSON(w, http.StatusOK, map[string]any{"rows": out})
}

func (s *Server) clearBenchmarks(w http.ResponseWriter, r *http.Request, u db.User) {
	if err := s.db.DeleteBenchmarks(r.Context(), u.ID); err != nil {
		s.serverError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
