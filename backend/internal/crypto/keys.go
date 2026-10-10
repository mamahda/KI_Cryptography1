// Package crypto implements the vault's encryption scheme:
//
//   - per-user, per-algorithm keys derived with HKDF-SHA256 from the server
//     secret, using the username as salt;
//   - AES-256-CTR, DES-CTR and RC4-drop[3072] keystreams;
//   - HMAC-SHA256 encrypt-then-MAC over algorithm, IV, associated data and
//     ciphertext.
package crypto

import (
	"crypto/aes"
	"crypto/des"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"
)

// Algorithm names a cipher every record is encrypted with.
type Algorithm string

const (
	AES Algorithm = "AES"
	DES Algorithm = "DES"
	RC4 Algorithm = "RC4"
)

// Algorithms lists the ciphers each record is stored under, in display order.
var Algorithms = []Algorithm{AES, DES, RC4}

type spec struct {
	keyLen int // bytes of key material derived per user
	ivLen  int // bytes of IV (CTR) or nonce (RC4) generated per record
}

var specs = map[Algorithm]spec{
	AES: {keyLen: 32, ivLen: aes.BlockSize}, // AES-256, 128-bit counter block
	DES: {keyLen: 8, ivLen: des.BlockSize},  // 56-bit effective key, 64-bit counter block
	RC4: {keyLen: 16, ivLen: 16},            // RC4-128, 128-bit per-record nonce
}

// ParseAlgorithm accepts "aes", "DES", ... and returns the canonical name.
func ParseAlgorithm(s string) (Algorithm, error) {
	a := Algorithm(strings.ToUpper(strings.TrimSpace(s)))
	if _, ok := specs[a]; !ok {
		return "", fmt.Errorf("crypto: unknown algorithm %q", s)
	}
	return a, nil
}

// IVSize is the length of the per-record IV (AES/DES) or nonce (RC4).
func (a Algorithm) IVSize() int { return specs[a].ivLen }

// KeySize is the length of the per-user key derived for the algorithm.
func (a Algorithm) KeySize() int { return specs[a].keyLen }

// SecretSize is the minimum length of the server secret.
const SecretSize = 32

const macKeySize = 32

// Keys holds one user's derived keys. It is cheap to derive, so it is
// recomputed per request and never stored.
type Keys struct {
	enc map[Algorithm][]byte
	mac []byte
}

// DeriveKeys derives the encryption and MAC keys for username:
//
//	K_alg = HKDF-SHA256(secret, salt=username, info="vault|"+alg)
//	K_mac = HKDF-SHA256(secret, salt=username, info="vault|mac")
//
// Distinct info strings make the keys independent, so brute-forcing the
// 56-bit DES key reveals nothing about the AES, RC4 or MAC keys.
func DeriveKeys(secret []byte, username string) (*Keys, error) {
	if len(secret) < SecretSize {
		return nil, fmt.Errorf("crypto: server secret must be at least %d bytes", SecretSize)
	}
	if username == "" {
		return nil, errors.New("crypto: empty username")
	}
	salt := []byte(username)
	k := &Keys{enc: make(map[Algorithm][]byte, len(Algorithms))}
	for _, alg := range Algorithms {
		key, err := hkdf.Key(sha256.New, secret, salt, "vault|"+string(alg), alg.KeySize())
		if err != nil {
			return nil, err
		}
		k.enc[alg] = key
	}
	mac, err := hkdf.Key(sha256.New, secret, salt, "vault|mac", macKeySize)
	if err != nil {
		return nil, err
	}
	k.mac = mac
	return k, nil
}

// NewIV returns a fresh random IV (AES/DES) or nonce (RC4) for alg.
func NewIV(alg Algorithm) ([]byte, error) {
	if _, ok := specs[alg]; !ok {
		return nil, fmt.Errorf("crypto: unknown algorithm %q", alg)
	}
	iv := make([]byte, alg.IVSize())
	if _, err := rand.Read(iv); err != nil {
		return nil, err
	}
	return iv, nil
}
