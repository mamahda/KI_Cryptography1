// Package config loads server settings from the environment and an
// optional .env file.
package config

import (
	"bufio"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"vault/internal/crypto"
)

type Config struct {
	DBDSN        string        // go-sql-driver/mysql DSN
	ServerSecret []byte        // root secret for HKDF key derivation
	StorageDir   string        // where encrypted files are written
	HTTPAddr     string        // listen address
	CookieSecure bool          // set Secure on the session cookie (HTTPS only)
	StaticDir    string        // optional built frontend to serve
	SessionTTL   time.Duration // session lifetime
}

// Load reads path (if it exists) into the environment without overriding
// variables that are already set, then builds the Config.
func Load(path string) (Config, error) {
	if err := loadDotEnv(path); err != nil {
		return Config{}, err
	}
	c := Config{
		DBDSN:      getenv("DB_DSN", "vault:vault@tcp(127.0.0.1:3306)/vault"),
		StorageDir: getenv("STORAGE_DIR", "../storage"),
		HTTPAddr:   getenv("HTTP_ADDR", ":8080"),
		StaticDir:  os.Getenv("STATIC_DIR"),
		SessionTTL: 24 * time.Hour,
	}

	secret := strings.TrimSpace(os.Getenv("SERVER_SECRET"))
	if secret == "" {
		return Config{}, errors.New("SERVER_SECRET is not set (generate one with: openssl rand -hex 32)")
	}
	b, err := hex.DecodeString(secret)
	if err != nil {
		return Config{}, fmt.Errorf("SERVER_SECRET must be hex: %w", err)
	}
	if len(b) < crypto.SecretSize {
		return Config{}, fmt.Errorf("SERVER_SECRET must be at least %d bytes (%d hex chars)", crypto.SecretSize, 2*crypto.SecretSize)
	}
	c.ServerSecret = b

	if v := os.Getenv("COOKIE_SECURE"); v != "" {
		if c.CookieSecure, err = strconv.ParseBool(v); err != nil {
			return Config{}, fmt.Errorf("COOKIE_SECURE: %w", err)
		}
	}
	if v := os.Getenv("SESSION_TTL"); v != "" {
		if c.SessionTTL, err = time.ParseDuration(v); err != nil || c.SessionTTL <= 0 {
			return Config{}, fmt.Errorf("SESSION_TTL must be a positive duration like 24h")
		}
	}
	return c, nil
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// loadDotEnv parses KEY=VALUE lines; blank lines and # comments are
// skipped and surrounding quotes are stripped.
func loadDotEnv(path string) error {
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	for n := 1; sc.Scan(); n++ {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			return fmt.Errorf("%s:%d: expected KEY=VALUE", path, n)
		}
		key = strings.TrimSpace(key)
		val = strings.TrimSpace(val)
		if len(val) >= 2 && (val[0] == '"' || val[0] == '\'') && val[len(val)-1] == val[0] {
			val = val[1 : len(val)-1]
		}
		if _, set := os.LookupEnv(key); !set {
			os.Setenv(key, val)
		}
	}
	return sc.Err()
}
