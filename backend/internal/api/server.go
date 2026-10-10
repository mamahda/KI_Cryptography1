// Package api implements the vault's JSON HTTP API.
package api

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"vault/internal/auth"
	"vault/internal/config"
	"vault/internal/crypto"
	"vault/internal/db"
	"vault/internal/storage"
)

const sessionCookie = "vault_session"

type Server struct {
	cfg   config.Config
	db    *db.DB
	store *storage.Store
	log   *slog.Logger
}

func New(cfg config.Config, database *db.DB, store *storage.Store, log *slog.Logger) *Server {
	return &Server{cfg: cfg, db: database, store: store, log: log}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	mux.HandleFunc("POST /api/auth/register", s.register)
	mux.HandleFunc("POST /api/auth/login", s.login)
	mux.HandleFunc("POST /api/auth/logout", s.logout)
	mux.HandleFunc("GET /api/auth/me", s.authed(s.me))

	mux.HandleFunc("GET /api/profile", s.authed(s.getProfile))
	mux.HandleFunc("PUT /api/profile", s.authed(s.putProfile))

	mux.HandleFunc("POST /api/files", s.authed(s.uploadFile))
	mux.HandleFunc("GET /api/files", s.authed(s.listFiles))
	mux.HandleFunc("GET /api/files/{id}/download", s.authed(s.downloadFile))
	mux.HandleFunc("GET /api/files/{id}/analysis", s.authed(s.analyzeFile))
	mux.HandleFunc("POST /api/files/{id}/benchmark", s.authed(s.benchmarkFile))
	mux.HandleFunc("DELETE /api/files/{id}", s.authed(s.deleteFile))

	mux.HandleFunc("GET /api/benchmarks", s.authed(s.benchmarkSummary))
	mux.HandleFunc("GET /api/benchmarks/raw", s.authed(s.benchmarkRaw))
	mux.HandleFunc("POST /api/benchmarks", s.authed(s.recordClientBenchmark))
	mux.HandleFunc("DELETE /api/benchmarks", s.authed(s.clearBenchmarks))

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "endpoint tidak ditemukan")
	})
	if s.cfg.StaticDir != "" {
		mux.Handle("/", spa(s.cfg.StaticDir))
	}
	return s.recoverer(s.logRequests(securityHeaders(mux)))
}

// authed resolves the session cookie to a user or answers 401.
func (s *Server) authed(h func(http.ResponseWriter, *http.Request, db.User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(sessionCookie)
		if err != nil || c.Value == "" {
			writeError(w, http.StatusUnauthorized, "silakan login terlebih dahulu")
			return
		}
		u, err := s.db.SessionUser(r.Context(), auth.HashToken(c.Value))
		if errors.Is(err, db.ErrNotFound) {
			s.clearCookie(w)
			writeError(w, http.StatusUnauthorized, "sesi sudah berakhir, silakan login ulang")
			return
		}
		if err != nil {
			s.serverError(w, r, err)
			return
		}
		h(w, r, u)
	}
}

func (s *Server) keys(u db.User) (*crypto.Keys, error) {
	return crypto.DeriveKeys(s.cfg.ServerSecret, u.Username)
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		if len(r.URL.Path) >= 5 && r.URL.Path[:5] == "/api/" {
			h.Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (r *statusRecorder) WriteHeader(code int) {
	if r.status == 0 {
		r.status = code
	}
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	n, err := r.ResponseWriter.Write(b)
	r.bytes += int64(n)
	return n, err
}

func (r *statusRecorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }

func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(rec, r)
		s.log.Info("request", "method", r.Method, "path", r.URL.Path, "status", rec.status,
			"bytes", rec.bytes, "duration", time.Since(start).Round(time.Microsecond))
	})
}

func (s *Server) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				if v == http.ErrAbortHandler {
					panic(v)
				}
				s.log.Error("panic", "method", r.Method, "path", r.URL.Path, "panic", v)
				writeError(w, http.StatusInternalServerError, "terjadi kesalahan di server")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// spa serves the built frontend and falls back to index.html for client
// routes such as /files.
func spa(dir string) http.Handler {
	fs := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := filepath.Join(dir, filepath.FromSlash(filepath.Clean("/"+r.URL.Path)))
		if st, err := os.Stat(p); err != nil || st.IsDir() {
			http.ServeFile(w, r, filepath.Join(dir, "index.html"))
			return
		}
		fs.ServeHTTP(w, r)
	})
}
