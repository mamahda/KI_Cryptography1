package api

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"

	"vault/internal/crypto"
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// serverError logs the real cause and gives the client a generic message.
func (s *Server) serverError(w http.ResponseWriter, r *http.Request, err error) {
	s.log.Error("internal error", "method", r.Method, "path", r.URL.Path, "err", err)
	writeError(w, http.StatusInternalServerError, "terjadi kesalahan di server")
}

// integrityError reports a failed HMAC check.
func (s *Server) integrityError(w http.ResponseWriter, r *http.Request, what string) {
	s.log.Warn("integrity check failed", "path", r.URL.Path, "what", what)
	writeError(w, http.StatusUnprocessableEntity,
		"verifikasi integritas "+what+" gagal (HMAC tidak cocok): data rusak atau telah dimodifikasi")
}

const maxJSONBody = 64 << 10

// decodeJSON reads exactly one JSON object with no unknown fields.
func decodeJSON(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return errors.New("body terlalu besar")
		}
		return fmt.Errorf("body JSON tidak valid: %v", err)
	}
	if dec.More() {
		return errors.New("body JSON tidak valid: lebih dari satu objek")
	}
	return nil
}

// algParam reads ?alg=, defaulting to AES.
func algParam(r *http.Request) (crypto.Algorithm, error) {
	q := r.URL.Query().Get("alg")
	if q == "" {
		return crypto.AES, nil
	}
	alg, err := crypto.ParseAlgorithm(q)
	if err != nil {
		return "", errors.New("parameter alg harus AES, DES, atau RC4")
	}
	return alg, nil
}

var uuidRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func newUUID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = b[6]&0x0f | 0x40 // version 4
	b[8] = b[8]&0x3f | 0x80 // RFC 4122 variant
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}

type timing struct {
	CipherNs int64 `json:"cipher_ns"`
	TotalNs  int64 `json:"total_ns"`
}
