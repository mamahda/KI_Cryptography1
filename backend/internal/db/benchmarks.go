package db

import (
	"context"
	"database/sql"
	"strings"
	"time"
)

type Benchmark struct {
	FileID     *string
	Algorithm  string
	Operation  string // encrypt | decrypt | download
	Source     string // server | client
	Bytes      int64
	RunIndex   int
	DurationNs int64
	CreatedAt  time.Time
}

type BenchmarkSummary struct {
	FileID    *string
	Algorithm string
	Operation string
	Source    string
	Runs      int64
	AvgBytes  float64
	MeanNs    float64
	MinNs     int64
	MaxNs     int64
	StddevNs  float64
}

func (d *DB) InsertBenchmarks(ctx context.Context, userID int64, rows []Benchmark) error {
	if len(rows) == 0 {
		return nil
	}
	const batch = 500
	for start := 0; start < len(rows); start += batch {
		chunk := rows[start:min(start+batch, len(rows))]
		var sb strings.Builder
		sb.WriteString(`INSERT INTO benchmarks
			(user_id, file_id, algorithm, operation, source, bytes, run_index, duration_ns) VALUES `)
		args := make([]any, 0, len(chunk)*8)
		for i, r := range chunk {
			if i > 0 {
				sb.WriteString(",")
			}
			sb.WriteString("(?, ?, ?, ?, ?, ?, ?, ?)")
			args = append(args, userID, r.FileID, r.Algorithm, r.Operation, r.Source, r.Bytes, r.RunIndex, r.DurationNs)
		}
		if _, err := d.ExecContext(ctx, sb.String(), args...); err != nil {
			return err
		}
	}
	return nil
}

func (d *DB) BenchmarkSummaries(ctx context.Context, userID int64) ([]BenchmarkSummary, error) {
	rows, err := d.QueryContext(ctx,
		`SELECT file_id, algorithm, operation, source, COUNT(*), AVG(bytes),
		   AVG(duration_ns), MIN(duration_ns), MAX(duration_ns), COALESCE(STDDEV_SAMP(duration_ns), 0)
		 FROM benchmarks WHERE user_id = ?
		 GROUP BY file_id, algorithm, operation, source
		 ORDER BY file_id, operation, source, algorithm`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BenchmarkSummary
	for rows.Next() {
		var s BenchmarkSummary
		var fileID sql.NullString
		if err := rows.Scan(&fileID, &s.Algorithm, &s.Operation, &s.Source, &s.Runs, &s.AvgBytes,
			&s.MeanNs, &s.MinNs, &s.MaxNs, &s.StddevNs); err != nil {
			return nil, err
		}
		if fileID.Valid {
			s.FileID = &fileID.String
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// Benchmarks returns raw measurements, oldest first, capped at limit.
func (d *DB) Benchmarks(ctx context.Context, userID int64, limit int) ([]Benchmark, error) {
	rows, err := d.QueryContext(ctx,
		`SELECT file_id, algorithm, operation, source, bytes, run_index, duration_ns, created_at
		 FROM benchmarks WHERE user_id = ? ORDER BY id LIMIT ?`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Benchmark
	for rows.Next() {
		var b Benchmark
		var fileID sql.NullString
		if err := rows.Scan(&fileID, &b.Algorithm, &b.Operation, &b.Source, &b.Bytes,
			&b.RunIndex, &b.DurationNs, &b.CreatedAt); err != nil {
			return nil, err
		}
		if fileID.Valid {
			b.FileID = &fileID.String
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (d *DB) DeleteBenchmarks(ctx context.Context, userID int64) error {
	_, err := d.ExecContext(ctx, `DELETE FROM benchmarks WHERE user_id = ?`, userID)
	return err
}
