// Package auth handles password hashing, credential validation and
// session tokens.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"regexp"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

// BcryptCost is deliberately slow (~250ms) to make offline guessing of
// leaked hashes expensive.
const BcryptCost = 12

var usernameRe = regexp.MustCompile(`^[a-z0-9_]{3,32}$`)

// NormalizeUsername lowercases and trims the username. The stored form is
// the HKDF salt, so it must be canonical: "Budi" and "budi" are one user.
func NormalizeUsername(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

func ValidateUsername(u string) error {
	if !usernameRe.MatchString(u) {
		return errors.New("username harus 3–32 karakter: huruf kecil, angka, atau underscore")
	}
	return nil
}

func ValidatePassword(p string) error {
	switch {
	case len(p) < 8:
		return errors.New("password minimal 8 karakter")
	case len(p) > 72: // bcrypt only uses the first 72 bytes
		return errors.New("password maksimal 72 byte")
	}
	return nil
}

func HashPassword(p string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(p), BcryptCost)
	return string(h), err
}

// dummyHash is compared against when the username does not exist, so a
// failed login takes the same time whether or not the user exists.
var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("dummy-password-for-timing"), BcryptCost)

// CheckPassword reports whether p matches hash. Pass an empty hash for an
// unknown user to burn the same bcrypt time.
func CheckPassword(hash, p string) bool {
	if hash == "" {
		bcrypt.CompareHashAndPassword(dummyHash, []byte(p))
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(p)) == nil
}

// NewSessionToken returns a random token for the cookie and its SHA-256
// for the database. A leaked sessions table cannot be replayed.
func NewSessionToken() (token string, hash []byte, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", nil, err
	}
	token = base64.RawURLEncoding.EncodeToString(b)
	return token, HashToken(token), nil
}

func HashToken(token string) []byte {
	h := sha256.Sum256([]byte(token))
	return h[:]
}
