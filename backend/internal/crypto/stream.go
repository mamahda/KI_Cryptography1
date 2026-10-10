package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/des"
	"crypto/rc4"
	"crypto/sha256"
	"fmt"
	"time"
)

// rc4Drop is how many initial RC4 keystream bytes are discarded, because
// the first bytes of RC4 output are measurably biased.
const rc4Drop = 3072

// Stream returns the keystream cipher for alg with the user's key and the
// record's iv. CTR and RC4 are both XOR keystreams, so the same stream
// encrypts and decrypts.
func (k *Keys) Stream(alg Algorithm, iv []byte) (cipher.Stream, error) {
	key, ok := k.enc[alg]
	if !ok {
		return nil, fmt.Errorf("crypto: unknown algorithm %q", alg)
	}
	if len(iv) != alg.IVSize() {
		return nil, fmt.Errorf("crypto: %s needs a %d-byte IV, got %d", alg, alg.IVSize(), len(iv))
	}
	switch alg {
	case AES:
		block, err := aes.NewCipher(key)
		if err != nil {
			return nil, err
		}
		return cipher.NewCTR(block, iv), nil
	case DES:
		block, err := des.NewCipher(key)
		if err != nil {
			return nil, err
		}
		return cipher.NewCTR(block, iv), nil
	default: // RC4
		return newRC4Drop(rc4RecordKey(key, iv))
	}
}

// rc4RecordKey gives every record its own RC4 key. RC4 has no IV, so
// without this all of a user's records would share one keystream and
// C1 xor C2 would equal P1 xor P2. The key and nonce are hashed rather than
// concatenated, because raw key||IV is what made WEP's RC4 breakable.
func rc4RecordKey(key, nonce []byte) []byte {
	h := sha256.New()
	h.Write(key)
	h.Write(nonce)
	return h.Sum(nil)[:RC4.KeySize()]
}

func newRC4Drop(key []byte) (cipher.Stream, error) {
	c, err := rc4.NewCipher(key)
	if err != nil {
		return nil, err
	}
	discard := make([]byte, rc4Drop)
	c.XORKeyStream(discard, discard)
	return c, nil
}

// timedStream wraps a cipher.Stream and accumulates the time spent in it,
// so that cipher cost can be measured separately from disk I/O and HMAC.
type timedStream struct {
	s cipher.Stream
	d time.Duration
}

func (t *timedStream) XORKeyStream(dst, src []byte) {
	start := time.Now()
	t.s.XORKeyStream(dst, src)
	t.d += time.Since(start)
}

// timed builds the stream and counts its setup (key schedule, RC4 drop)
// as cipher time.
func (k *Keys) timed(alg Algorithm, iv []byte) (*timedStream, error) {
	start := time.Now()
	s, err := k.Stream(alg, iv)
	if err != nil {
		return nil, err
	}
	return &timedStream{s: s, d: time.Since(start)}, nil
}
