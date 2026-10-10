package api

import (
	"errors"
	"net/http"

	"vault/internal/auth"
	"vault/internal/db"
)

type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type userJSON struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	var in credentials
	if err := decodeJSON(w, r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	username := auth.NormalizeUsername(in.Username)
	if err := auth.ValidateUsername(username); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := auth.ValidatePassword(in.Password); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	hash, err := auth.HashPassword(in.Password)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	id, err := s.db.CreateUser(r.Context(), username, hash)
	if errors.Is(err, db.ErrDuplicate) {
		writeError(w, http.StatusConflict, "username sudah dipakai")
		return
	}
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if err := s.startSession(w, r, id); err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, userJSON{ID: id, Username: username})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var in credentials
	if err := decodeJSON(w, r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	u, err := s.db.UserByUsername(r.Context(), auth.NormalizeUsername(in.Username))
	if err != nil && !errors.Is(err, db.ErrNotFound) {
		s.serverError(w, r, err)
		return
	}
	// u.PasswordHash is empty for unknown users; CheckPassword still spends
	// a bcrypt comparison so response time does not reveal which usernames exist.
	if !auth.CheckPassword(u.PasswordHash, in.Password) {
		writeError(w, http.StatusUnauthorized, "username atau password salah")
		return
	}
	if err := s.startSession(w, r, u.ID); err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, userJSON{ID: u.ID, Username: u.Username})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil && c.Value != "" {
		if err := s.db.DeleteSession(r.Context(), auth.HashToken(c.Value)); err != nil {
			s.serverError(w, r, err)
			return
		}
	}
	s.clearCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request, u db.User) {
	writeJSON(w, http.StatusOK, userJSON{ID: u.ID, Username: u.Username})
}

// session reports the signed-in user, or {"user": null}, always with 200.
// The frontend calls it on page load, where "not signed in" is a normal
// state rather than an error.
func (s *Server) session(w http.ResponseWriter, r *http.Request) {
	none := map[string]any{"user": nil}
	c, err := r.Cookie(sessionCookie)
	if err != nil || c.Value == "" {
		writeJSON(w, http.StatusOK, none)
		return
	}
	u, err := s.db.SessionUser(r.Context(), auth.HashToken(c.Value))
	if errors.Is(err, db.ErrNotFound) {
		s.clearCookie(w)
		writeJSON(w, http.StatusOK, none)
		return
	}
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": userJSON{ID: u.ID, Username: u.Username}})
}

func (s *Server) startSession(w http.ResponseWriter, r *http.Request, userID int64) error {
	token, hash, err := auth.NewSessionToken()
	if err != nil {
		return err
	}
	if err := s.db.CreateSession(r.Context(), hash, userID, s.cfg.SessionTTL); err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		MaxAge:   int(s.cfg.SessionTTL.Seconds()),
		HttpOnly: true,
		Secure:   s.cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
	return nil
}

func (s *Server) clearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   s.cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}
