package crypto

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"hash"
	"io"
	"time"
)

// ErrAuth means the HMAC did not match: the ciphertext, IV, algorithm or
// associated data was modified or corrupted.
var ErrAuth = errors.New("crypto: message authentication failed")

// MACSize is the length of the stored HMAC-SHA256 tag.
const MACSize = sha256.Size

const chunkSize = 256 << 10

// Stats reports how long one encryption or decryption pass took.
type Stats struct {
	Bytes    int64 // plaintext/ciphertext length
	CipherNs int64 // time inside the cipher only (setup + keystream XOR)
	TotalNs  int64 // whole pass including I/O and HMAC
}

// Sealed is the output of Encrypt: everything needed to decrypt besides the
// ciphertext itself.
type Sealed struct {
	Algorithm Algorithm
	IV        []byte
	MAC       []byte
	Stats
}

// newMAC starts HMAC-SHA256(K_mac, alg || iv || aad || ciphertext), with
// every field length-prefixed so field boundaries are unambiguous. aad binds
// the ciphertext to its record (e.g. the file ID), so ciphertexts cannot be
// swapped between records undetected.
func (k *Keys) newMAC(alg Algorithm, iv, aad []byte) hash.Hash {
	m := hmac.New(sha256.New, k.mac)
	writeField(m, []byte(alg))
	writeField(m, iv)
	writeField(m, aad)
	return m
}

func writeField(h hash.Hash, b []byte) {
	var n [4]byte
	binary.BigEndian.PutUint32(n[:], uint32(len(b)))
	h.Write(n[:])
	h.Write(b)
}

// Encrypt streams src through alg with a fresh IV into dst and returns the
// IV and the encrypt-then-MAC tag.
func (k *Keys) Encrypt(alg Algorithm, dst io.Writer, src io.Reader, aad []byte) (*Sealed, error) {
	start := time.Now()
	iv, err := NewIV(alg)
	if err != nil {
		return nil, err
	}
	ts, err := k.timed(alg, iv)
	if err != nil {
		return nil, err
	}
	mac := k.newMAC(alg, iv, aad)
	n, err := pump(dst, src, ts, mac)
	if err != nil {
		return nil, err
	}
	return &Sealed{
		Algorithm: alg,
		IV:        iv,
		MAC:       mac.Sum(nil),
		Stats:     Stats{Bytes: n, CipherNs: ts.d.Nanoseconds(), TotalNs: time.Since(start).Nanoseconds()},
	}, nil
}

// Verify reads the whole ciphertext from src and checks its tag in constant
// time. It returns ErrAuth on mismatch.
func (k *Keys) Verify(alg Algorithm, iv, tag, aad []byte, src io.Reader) error {
	if _, ok := specs[alg]; !ok || len(iv) != alg.IVSize() {
		return ErrAuth
	}
	mac := k.newMAC(alg, iv, aad)
	buf := make([]byte, chunkSize)
	if _, err := io.CopyBuffer(mac, src, buf); err != nil {
		return err
	}
	if !hmac.Equal(mac.Sum(nil), tag) {
		return ErrAuth
	}
	return nil
}

// Decrypt streams the ciphertext in src through alg into dst. It does not
// authenticate: callers must Verify the same ciphertext first.
func (k *Keys) Decrypt(alg Algorithm, iv []byte, dst io.Writer, src io.Reader) (Stats, error) {
	start := time.Now()
	ts, err := k.timed(alg, iv)
	if err != nil {
		return Stats{}, err
	}
	n, err := pump(dst, src, ts, nil)
	if err != nil {
		return Stats{}, err
	}
	return Stats{Bytes: n, CipherNs: ts.d.Nanoseconds(), TotalNs: time.Since(start).Nanoseconds()}, nil
}

// pump XORs src through s into dst in chunks, feeding the resulting
// ciphertext to mac when one is given.
func pump(dst io.Writer, src io.Reader, s *timedStream, mac hash.Hash) (int64, error) {
	buf := make([]byte, chunkSize)
	var total int64
	for {
		n, rerr := src.Read(buf)
		if n > 0 {
			chunk := buf[:n]
			s.XORKeyStream(chunk, chunk)
			if mac != nil {
				mac.Write(chunk)
			}
			if _, err := dst.Write(chunk); err != nil {
				return total, err
			}
			total += int64(n)
		}
		if rerr == io.EOF {
			return total, nil
		}
		if rerr != nil {
			return total, rerr
		}
	}
}

// Seal encrypts a small in-memory plaintext and returns the ciphertext.
func (k *Keys) Seal(alg Algorithm, plaintext, aad []byte) (*Sealed, []byte, error) {
	var out bytes.Buffer
	out.Grow(len(plaintext))
	s, err := k.Encrypt(alg, &out, bytes.NewReader(plaintext), aad)
	if err != nil {
		return nil, nil, err
	}
	return s, out.Bytes(), nil
}

// Open verifies and decrypts a small in-memory ciphertext.
func (k *Keys) Open(alg Algorithm, iv, ciphertext, tag, aad []byte) ([]byte, Stats, error) {
	if err := k.Verify(alg, iv, tag, aad, bytes.NewReader(ciphertext)); err != nil {
		return nil, Stats{}, err
	}
	var out bytes.Buffer
	out.Grow(len(ciphertext))
	st, err := k.Decrypt(alg, iv, &out, bytes.NewReader(ciphertext))
	if err != nil {
		return nil, Stats{}, err
	}
	return out.Bytes(), st, nil
}
