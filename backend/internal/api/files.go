package api

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"strconv"
	"time"

	"vault/internal/crypto"
	"vault/internal/db"
	"vault/internal/filetype"
	"vault/internal/storage"
)

type fileJSON struct {
	ID             string    `json:"id"`
	Category       string    `json:"category"`
	Filename       string    `json:"filename"`
	MimeType       string    `json:"mime_type"`
	Size           int64     `json:"size"`
	CreatedAt      time.Time `json:"created_at"`
	IntegrityError bool      `json:"integrity_error,omitempty"`
}

// nameAAD binds an encrypted filename to its file.
func nameAAD(fileID string) []byte { return []byte(fileID + "|name") }

func (s *Server) fileName(keys *crypto.Keys, v db.FileVariant) (string, error) {
	alg, err := crypto.ParseAlgorithm(v.Algorithm)
	if err != nil {
		return "", err
	}
	name, _, err := keys.Open(alg, v.NameIV, v.NameCiphertext, v.NameMAC, nameAAD(v.FileID))
	return string(name), err
}

func toFileJSON(f db.File, name string) fileJSON {
	return fileJSON{ID: f.ID, Category: f.Category, Filename: name, MimeType: f.MimeType, Size: f.SizePlain, CreatedAt: f.CreatedAt}
}

// uploadFile streams one multipart file to a temp file, validates it, then
// encrypts it separately with AES, DES and RC4. Either all three variants
// and their rows exist afterwards, or none do.
func (s *Server) uploadFile(w http.ResponseWriter, r *http.Request, u db.User) {
	r.Body = http.MaxBytesReader(w, r.Body, filetype.MaxUploadSize+1<<20)
	mr, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusBadRequest, "request harus multipart/form-data")
		return
	}

	var (
		categoryRaw string
		rawName     string
		tmp         *os.File
		size        int64
	)
	defer func() {
		if tmp != nil {
			tmp.Close()
			os.Remove(tmp.Name())
		}
	}()

	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			s.uploadReadError(w, r, err)
			return
		}
		switch part.FormName() {
		case "category":
			b, err := io.ReadAll(io.LimitReader(part, 64))
			if err != nil {
				s.uploadReadError(w, r, err)
				return
			}
			categoryRaw = string(b)
		case "file":
			if tmp != nil {
				writeError(w, http.StatusBadRequest, "hanya satu file per upload")
				return
			}
			rawName = part.FileName()
			if tmp, err = s.store.TempFile(); err != nil {
				s.serverError(w, r, err)
				return
			}
			size, err = io.Copy(tmp, io.LimitReader(part, filetype.MaxUploadSize+1))
			if err != nil {
				s.uploadReadError(w, r, err)
				return
			}
		}
		part.Close()
	}

	category, err := filetype.ParseCategory(categoryRaw)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if tmp == nil {
		writeError(w, http.StatusBadRequest, "field file wajib diisi")
		return
	}
	if size == 0 {
		writeError(w, http.StatusBadRequest, "file kosong")
		return
	}
	if size > category.MaxSize() {
		writeError(w, http.StatusRequestEntityTooLarge,
			fmt.Sprintf("ukuran file melebihi batas %d MB untuk kategori ini", category.MaxSize()>>20))
		return
	}
	filename := filetype.SanitizeFilename(rawName)
	if filename == "" {
		writeError(w, http.StatusBadRequest, "nama file tidak valid")
		return
	}
	head := make([]byte, 512)
	n, err := tmp.ReadAt(head, 0)
	if err != nil && err != io.EOF {
		s.serverError(w, r, err)
		return
	}
	mimeType, err := filetype.Detect(category, filename, head[:n], tmp.Name())
	if err != nil {
		writeError(w, http.StatusUnsupportedMediaType, err.Error())
		return
	}

	keys, err := s.keys(u)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	fileID, err := newUUID()
	if err != nil {
		s.serverError(w, r, err)
		return
	}

	var written []string
	committed := false
	defer func() {
		if !committed {
			for _, p := range written {
				s.store.Remove(p)
			}
		}
	}()

	variants := make([]db.FileVariant, 0, len(crypto.Algorithms))
	timings := make(map[crypto.Algorithm]timing, len(crypto.Algorithms))
	for _, alg := range crypto.Algorithms {
		rel := storage.Path(u.ID, fileID, string(alg))
		out, err := s.store.Create(rel)
		if err != nil {
			s.serverError(w, r, err)
			return
		}
		written = append(written, rel)
		sealed, err := keys.Encrypt(alg, out, io.NewSectionReader(tmp, 0, size), []byte(fileID))
		if cerr := out.Close(); err == nil {
			err = cerr
		}
		if err != nil {
			s.serverError(w, r, err)
			return
		}
		nameSealed, nameCT, err := keys.Seal(alg, []byte(filename), nameAAD(fileID))
		if err != nil {
			s.serverError(w, r, err)
			return
		}
		variants = append(variants, db.FileVariant{
			FileID: fileID, Algorithm: string(alg), StoragePath: rel,
			IV: sealed.IV, MAC: sealed.MAC,
			NameIV: nameSealed.IV, NameCiphertext: nameCT, NameMAC: nameSealed.MAC,
			SizeCipher: sealed.Bytes, EncryptNs: sealed.CipherNs, EncryptTotalNs: sealed.TotalNs,
		})
		timings[alg] = timing{CipherNs: sealed.CipherNs, TotalNs: sealed.TotalNs}
	}

	f := db.File{ID: fileID, UserID: u.ID, Category: string(category), MimeType: mimeType, SizePlain: size, CreatedAt: time.Now().UTC()}
	if err := s.db.CreateFile(r.Context(), f, variants); err != nil {
		s.serverError(w, r, err)
		return
	}
	committed = true

	bench := make([]db.Benchmark, 0, len(variants))
	for _, v := range variants {
		bench = append(bench, db.Benchmark{FileID: &f.ID, Algorithm: v.Algorithm, Operation: "encrypt",
			Source: "server", Bytes: size, DurationNs: v.EncryptNs})
	}
	if err := s.db.InsertBenchmarks(context.WithoutCancel(r.Context()), u.ID, bench); err != nil {
		s.log.Error("record encrypt benchmark", "err", err)
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"file":    toFileJSON(f, filename),
		"encrypt": timings,
	})
}

func (s *Server) uploadReadError(w http.ResponseWriter, r *http.Request, err error) {
	var mbe *http.MaxBytesError
	if errors.As(err, &mbe) {
		writeError(w, http.StatusRequestEntityTooLarge,
			fmt.Sprintf("ukuran upload melebihi batas maksimum %d MB", filetype.MaxUploadSize>>20))
		return
	}
	s.log.Warn("upload read failed", "err", err)
	writeError(w, http.StatusBadRequest, "gagal membaca upload")
}

func (s *Server) listFiles(w http.ResponseWriter, r *http.Request, u db.User) {
	category := r.URL.Query().Get("category")
	if category != "" {
		if _, err := filetype.ParseCategory(category); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	rows, err := s.db.ListFiles(r.Context(), u.ID, category, string(crypto.AES))
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	keys, err := s.keys(u)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	out := make([]fileJSON, 0, len(rows))
	for _, fv := range rows {
		name, err := s.fileName(keys, fv.Variant)
		fj := toFileJSON(fv.File, name)
		if err != nil {
			fj.IntegrityError = true
		}
		out = append(out, fj)
	}
	writeJSON(w, http.StatusOK, map[string]any{"files": out})
}

// lookupVariant loads the requested variant of a file owned by u, writing
// the error response itself when it returns ok=false.
func (s *Server) lookupVariant(w http.ResponseWriter, r *http.Request, u db.User) (db.FileWithVariant, crypto.Algorithm, bool) {
	id := r.PathValue("id")
	if !uuidRe.MatchString(id) {
		writeError(w, http.StatusNotFound, "file tidak ditemukan")
		return db.FileWithVariant{}, "", false
	}
	alg, err := algParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return db.FileWithVariant{}, "", false
	}
	fv, err := s.db.FileVariant(r.Context(), u.ID, id, string(alg))
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, "file tidak ditemukan")
		return db.FileWithVariant{}, "", false
	}
	if err != nil {
		s.serverError(w, r, err)
		return db.FileWithVariant{}, "", false
	}
	return fv, alg, true
}

// downloadFile verifies the HMAC over the whole ciphertext first and only
// then streams the decrypted file, so tampered data is never sent.
func (s *Server) downloadFile(w http.ResponseWriter, r *http.Request, u db.User) {
	fv, alg, ok := s.lookupVariant(w, r, u)
	if !ok {
		return
	}
	keys, err := s.keys(u)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	name, err := s.fileName(keys, fv.Variant)
	if errors.Is(err, crypto.ErrAuth) {
		s.integrityError(w, r, "nama file")
		return
	}
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	f, err := s.store.Open(fv.Variant.StoragePath)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	defer f.Close()

	verifyStart := time.Now()
	err = keys.Verify(alg, fv.Variant.IV, fv.Variant.MAC, []byte(fv.ID), f)
	if errors.Is(err, crypto.ErrAuth) {
		s.integrityError(w, r, "file")
		return
	}
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	verifyNs := time.Since(verifyStart).Nanoseconds()
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		s.serverError(w, r, err)
		return
	}

	disposition := mime.FormatMediaType("attachment", map[string]string{"filename": name})
	if disposition == "" {
		disposition = "attachment"
	}
	h := w.Header()
	h.Set("Content-Type", fv.MimeType)
	h.Set("Content-Length", strconv.FormatInt(fv.SizePlain, 10))
	h.Set("Content-Disposition", disposition)
	h.Set("X-Algorithm", string(alg))
	h.Set("X-Verify-Ns", strconv.FormatInt(verifyNs, 10))
	w.WriteHeader(http.StatusOK)

	st, err := keys.Decrypt(alg, fv.Variant.IV, w, f)
	if err != nil {
		// Headers are already sent; the client sees a truncated body.
		s.log.Warn("download interrupted", "file", fv.ID, "alg", alg, "err", err)
		return
	}
	err = s.db.InsertBenchmarks(context.WithoutCancel(r.Context()), u.ID, []db.Benchmark{{
		FileID: &fv.ID, Algorithm: string(alg), Operation: "download", Source: "server",
		Bytes: st.Bytes, DurationNs: st.CipherNs,
	}})
	if err != nil {
		s.log.Error("record download benchmark", "err", err)
	}
}

func (s *Server) deleteFile(w http.ResponseWriter, r *http.Request, u db.User) {
	id := r.PathValue("id")
	if !uuidRe.MatchString(id) {
		writeError(w, http.StatusNotFound, "file tidak ditemukan")
		return
	}
	paths, err := s.db.DeleteFile(r.Context(), u.ID, id)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, "file tidak ditemukan")
		return
	}
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	for _, p := range paths {
		if err := s.store.Remove(p); err != nil {
			s.log.Error("remove variant", "path", p, "err", err)
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// headWriter keeps the first max bytes written to it.
type headWriter struct {
	buf []byte
	max int
}

func (h *headWriter) Write(p []byte) (int, error) {
	if room := h.max - len(h.buf); room > 0 {
		h.buf = append(h.buf, p[:min(room, len(p))]...)
	}
	return len(p), nil
}

const previewBytes = 256

type variantAnalysis struct {
	Algorithm      string  `json:"algorithm"`
	Mode           string  `json:"mode"`
	KeyBits        int     `json:"key_bits"`
	BlockBits      int     `json:"block_bits"`
	IV             string  `json:"iv_hex"`
	MAC            string  `json:"mac_hex"`
	SizeCipher     int64   `json:"size_cipher"`
	OverheadBytes  int     `json:"overhead_bytes"`
	Entropy        float64 `json:"entropy"`
	HexPreview     string  `json:"hex_preview"`
	MACValid       bool    `json:"mac_valid"`
	EncryptNs      int64   `json:"encrypt_ns"`
	EncryptTotalNs int64   `json:"encrypt_total_ns"`
}

var algInfo = map[crypto.Algorithm]struct {
	mode      string
	keyBits   int
	blockBits int
}{
	crypto.AES: {"CTR", 256, 128},
	crypto.DES: {"CTR", 56, 64},
	crypto.RC4: {"Stream (drop-3072, nonce per file)", 128, 0},
}

// analyzeFile compares the three ciphertexts of one file: size, overhead,
// entropy, first bytes and HMAC validity, plus the plaintext's entropy.
func (s *Server) analyzeFile(w http.ResponseWriter, r *http.Request, u db.User) {
	id := r.PathValue("id")
	if !uuidRe.MatchString(id) {
		writeError(w, http.StatusNotFound, "file tidak ditemukan")
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

	file := variants[0].File
	name, nameErr := s.fileName(keys, variants[0].Variant)
	out := struct {
		fileJSON
		Plaintext *struct {
			Entropy    float64 `json:"entropy"`
			HexPreview string  `json:"hex_preview"`
		} `json:"plaintext"`
		Variants []variantAnalysis `json:"variants"`
	}{fileJSON: toFileJSON(file, name)}
	out.IntegrityError = nameErr != nil

	for _, fv := range variants {
		alg, err := crypto.ParseAlgorithm(fv.Variant.Algorithm)
		if err != nil {
			s.serverError(w, r, err)
			return
		}
		info := algInfo[alg]
		va := variantAnalysis{
			Algorithm: string(alg), Mode: info.mode, KeyBits: info.keyBits, BlockBits: info.blockBits,
			IV: hex.EncodeToString(fv.Variant.IV), MAC: hex.EncodeToString(fv.Variant.MAC),
			SizeCipher: fv.Variant.SizeCipher, OverheadBytes: len(fv.Variant.IV) + len(fv.Variant.MAC),
			EncryptNs: fv.Variant.EncryptNs, EncryptTotalNs: fv.Variant.EncryptTotalNs,
		}
		f, err := s.store.Open(fv.Variant.StoragePath)
		if errors.Is(err, os.ErrNotExist) {
			out.Variants = append(out.Variants, va) // reported as mac_valid=false
			continue
		}
		if err != nil {
			s.serverError(w, r, err)
			return
		}
		var ent crypto.Entropy
		head := &headWriter{max: previewBytes}
		err = keys.Verify(alg, fv.Variant.IV, fv.Variant.MAC, []byte(fv.ID), io.TeeReader(f, io.MultiWriter(&ent, head)))
		if err != nil && !errors.Is(err, crypto.ErrAuth) {
			f.Close()
			s.serverError(w, r, err)
			return
		}
		va.MACValid = err == nil
		va.Entropy = ent.Bits()
		va.HexPreview = hex.EncodeToString(head.buf)

		if va.MACValid && out.Plaintext == nil {
			var pent crypto.Entropy
			phead := &headWriter{max: previewBytes}
			if _, err := f.Seek(0, io.SeekStart); err == nil {
				if _, err := keys.Decrypt(alg, fv.Variant.IV, io.MultiWriter(&pent, phead), f); err == nil {
					out.Plaintext = &struct {
						Entropy    float64 `json:"entropy"`
						HexPreview string  `json:"hex_preview"`
					}{pent.Bits(), hex.EncodeToString(phead.buf)}
				}
			}
		}
		f.Close()
		out.Variants = append(out.Variants, va)
	}
	writeJSON(w, http.StatusOK, out)
}
