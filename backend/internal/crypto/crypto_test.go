package crypto

import (
	"bytes"
	"crypto/cipher"
	"crypto/des"
	"crypto/rand"
	"crypto/rc4"
	"encoding/hex"
	"errors"
	"testing"
)

var testSecret = bytes.Repeat([]byte{0x42}, SecretSize)

func testKeys(t testing.TB, user string) *Keys {
	t.Helper()
	k, err := DeriveKeys(testSecret, user)
	if err != nil {
		t.Fatal(err)
	}
	return k
}

func randBytes(t testing.TB, n int) []byte {
	t.Helper()
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	return b
}

func TestDeriveKeys(t *testing.T) {
	if _, err := DeriveKeys(testSecret[:SecretSize-1], "alice"); err == nil {
		t.Error("short secret accepted")
	}
	if _, err := DeriveKeys(testSecret, ""); err == nil {
		t.Error("empty username accepted")
	}

	a1, a2, b := testKeys(t, "alice"), testKeys(t, "alice"), testKeys(t, "bob")
	for _, alg := range Algorithms {
		if got, want := len(a1.enc[alg]), alg.KeySize(); got != want {
			t.Errorf("%s key length = %d, want %d", alg, got, want)
		}
		if !bytes.Equal(a1.enc[alg], a2.enc[alg]) {
			t.Errorf("%s key not deterministic", alg)
		}
		if bytes.Equal(a1.enc[alg], b.enc[alg]) {
			t.Errorf("%s key identical for different users", alg)
		}
	}
	if bytes.Equal(a1.enc[AES][:8], a1.enc[DES]) {
		t.Error("DES key is a prefix of the AES key")
	}
	if bytes.Equal(a1.mac, b.mac) {
		t.Error("MAC key identical for different users")
	}
}

func TestParseAlgorithm(t *testing.T) {
	for in, want := range map[string]Algorithm{"aes": AES, " DES ": DES, "Rc4": RC4} {
		got, err := ParseAlgorithm(in)
		if err != nil || got != want {
			t.Errorf("ParseAlgorithm(%q) = %q, %v", in, got, err)
		}
	}
	for _, in := range []string{"", "ECB", "3DES", "aes-256"} {
		if _, err := ParseAlgorithm(in); err == nil {
			t.Errorf("ParseAlgorithm(%q) accepted", in)
		}
	}
}

func TestRoundTrip(t *testing.T) {
	k := testKeys(t, "alice")
	aad := []byte("file-123")
	// Sizes around block boundaries (8 for DES, 16 for AES) and the
	// internal chunk size.
	sizes := []int{0, 1, 7, 8, 9, 15, 16, 17, 1000, chunkSize - 1, chunkSize, chunkSize + 1, 3*chunkSize + 5}
	for _, alg := range Algorithms {
		for _, n := range sizes {
			pt := randBytes(t, n)
			s, ct, err := k.Seal(alg, pt, aad)
			if err != nil {
				t.Fatalf("%s/%d: seal: %v", alg, n, err)
			}
			if len(ct) != n {
				t.Errorf("%s/%d: ciphertext length %d, want %d (no padding)", alg, n, len(ct), n)
			}
			if len(s.IV) != alg.IVSize() || len(s.MAC) != MACSize {
				t.Errorf("%s/%d: iv=%d mac=%d bytes", alg, n, len(s.IV), len(s.MAC))
			}
			if s.Bytes != int64(n) {
				t.Errorf("%s/%d: stats bytes = %d", alg, n, s.Bytes)
			}
			if n >= 16 && bytes.Equal(ct, pt) {
				t.Errorf("%s/%d: ciphertext equals plaintext", alg, n)
			}
			got, _, err := k.Open(alg, s.IV, ct, s.MAC, aad)
			if err != nil {
				t.Fatalf("%s/%d: open: %v", alg, n, err)
			}
			if !bytes.Equal(got, pt) {
				t.Fatalf("%s/%d: round trip mismatch", alg, n)
			}
		}
	}
}

// smallReader returns at most 3 bytes per Read, to exercise chunking.
type smallReader struct{ r *bytes.Reader }

func (s smallReader) Read(p []byte) (int, error) {
	if len(p) > 3 {
		p = p[:3]
	}
	return s.r.Read(p)
}

func TestStreamingShortReads(t *testing.T) {
	k := testKeys(t, "alice")
	pt := randBytes(t, 4099)
	for _, alg := range Algorithms {
		var ct bytes.Buffer
		s, err := k.Encrypt(alg, &ct, smallReader{bytes.NewReader(pt)}, nil)
		if err != nil {
			t.Fatal(err)
		}
		if err := k.Verify(alg, s.IV, s.MAC, nil, smallReader{bytes.NewReader(ct.Bytes())}); err != nil {
			t.Fatalf("%s: verify: %v", alg, err)
		}
		var out bytes.Buffer
		if _, err := k.Decrypt(alg, s.IV, &out, smallReader{bytes.NewReader(ct.Bytes())}); err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(out.Bytes(), pt) {
			t.Fatalf("%s: short-read round trip mismatch", alg)
		}
	}
}

func TestFreshIVPerEncryption(t *testing.T) {
	k := testKeys(t, "alice")
	pt := bytes.Repeat([]byte("same plaintext "), 100)
	for _, alg := range Algorithms {
		s1, c1, _ := k.Seal(alg, pt, nil)
		s2, c2, _ := k.Seal(alg, pt, nil)
		if bytes.Equal(s1.IV, s2.IV) {
			t.Errorf("%s: IV reused", alg)
		}
		if bytes.Equal(c1, c2) {
			t.Errorf("%s: same plaintext gave same ciphertext", alg)
		}
	}
}

func TestTamperDetection(t *testing.T) {
	k := testKeys(t, "alice")
	pt := randBytes(t, 100)
	aad := []byte("file-1")
	for _, alg := range Algorithms {
		s, ct, err := k.Seal(alg, pt, aad)
		if err != nil {
			t.Fatal(err)
		}
		flip := func(b []byte, i int) []byte {
			c := bytes.Clone(b)
			c[i] ^= 0x01
			return c
		}
		other := AES
		if alg == AES {
			other = RC4
		}
		cases := map[string]func() error{
			"ciphertext bit": func() error { _, _, err := k.Open(alg, s.IV, flip(ct, 50), s.MAC, aad); return err },
			"truncated":      func() error { _, _, err := k.Open(alg, s.IV, ct[:99], s.MAC, aad); return err },
			"iv bit":         func() error { _, _, err := k.Open(alg, flip(s.IV, 0), ct, s.MAC, aad); return err },
			"mac bit":        func() error { _, _, err := k.Open(alg, s.IV, ct, flip(s.MAC, 31), aad); return err },
			"aad":            func() error { _, _, err := k.Open(alg, s.IV, ct, s.MAC, []byte("file-2")); return err },
			"other user":     func() error { _, _, err := testKeys(t, "bob").Open(alg, s.IV, ct, s.MAC, aad); return err },
			"other alg":      func() error { _, _, err := k.Open(other, s.IV, ct, s.MAC, aad); return err },
		}
		for name, open := range cases {
			if err := open(); !errors.Is(err, ErrAuth) {
				t.Errorf("%s/%s: got %v, want ErrAuth", alg, name, err)
			}
		}
	}
}

// TestCTRBitFlipNoDiffusion documents the malleability that makes the HMAC
// necessary: with the same key and IV, one flipped plaintext bit flips
// exactly one ciphertext bit.
func TestCTRBitFlipNoDiffusion(t *testing.T) {
	k := testKeys(t, "alice")
	pt := randBytes(t, 4096)
	pt2 := bytes.Clone(pt)
	pt2[1234] ^= 0x10
	for _, alg := range Algorithms {
		iv, _ := NewIV(alg)
		s1, _ := k.Stream(alg, iv)
		s2, _ := k.Stream(alg, iv)
		c1, c2 := make([]byte, len(pt)), make([]byte, len(pt))
		s1.XORKeyStream(c1, pt)
		s2.XORKeyStream(c2, pt2)
		if d := HammingDistance(c1, c2); d != 1 {
			t.Errorf("%s: %d bits differ, want 1", alg, d)
		}
	}
}

// NIST SP 800-38A, F.5.5 CTR-AES256.Encrypt.
func TestAESCTRKnownAnswer(t *testing.T) {
	key, _ := hex.DecodeString("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4")
	iv, _ := hex.DecodeString("f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff")
	pt, _ := hex.DecodeString("6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51")
	want, _ := hex.DecodeString("601ec313775789a5b7a7f504bbf3d228f443e3ca4d62b59aca84e990cacaf5c5")
	k := &Keys{enc: map[Algorithm][]byte{AES: key}}
	s, err := k.Stream(AES, iv)
	if err != nil {
		t.Fatal(err)
	}
	got := make([]byte, len(pt))
	s.XORKeyStream(got, pt)
	if !bytes.Equal(got, want) {
		t.Errorf("AES-256-CTR = %x, want %x", got, want)
	}
}

// TestDESCTRMatchesManualCounter checks DES-CTR against counter mode built
// by hand from raw DES block encryptions of IV, IV+1, IV+2, ...
func TestDESCTRMatchesManualCounter(t *testing.T) {
	key := randBytes(t, 8)
	iv := []byte{0, 0, 0, 0, 0, 0, 0xff, 0xfe} // forces a carry across bytes
	pt := randBytes(t, 8*5+3)

	k := &Keys{enc: map[Algorithm][]byte{DES: key}}
	s, err := k.Stream(DES, iv)
	if err != nil {
		t.Fatal(err)
	}
	got := make([]byte, len(pt))
	s.XORKeyStream(got, pt)

	block, _ := des.NewCipher(key)
	ctr := bytes.Clone(iv)
	want := make([]byte, len(pt))
	ks := make([]byte, 8)
	for off := 0; off < len(pt); off += 8 {
		block.Encrypt(ks, ctr)
		for i := 0; i < 8 && off+i < len(pt); i++ {
			want[off+i] = pt[off+i] ^ ks[i]
		}
		for i := 7; i >= 0; i-- { // big-endian increment
			ctr[i]++
			if ctr[i] != 0 {
				break
			}
		}
	}
	if !bytes.Equal(got, want) {
		t.Error("DES-CTR does not match manual counter mode")
	}
}

func TestRC4DropAndRecordKey(t *testing.T) {
	k := testKeys(t, "alice")
	nonce := randBytes(t, 16)
	s, err := k.Stream(RC4, nonce)
	if err != nil {
		t.Fatal(err)
	}
	got := make([]byte, 64)
	s.XORKeyStream(got, got)

	// Expected: raw RC4 keyed with SHA-256(K_rc4 || nonce)[:16], first 3072
	// keystream bytes skipped.
	raw, _ := rc4.NewCipher(rc4RecordKey(k.enc[RC4], nonce))
	want := make([]byte, rc4Drop+64)
	raw.XORKeyStream(want, want)
	if !bytes.Equal(got, want[rc4Drop:]) {
		t.Error("RC4 keystream does not start at offset 3072")
	}

	// Different nonces must give unrelated keystreams under the same user key.
	s2, _ := k.Stream(RC4, randBytes(t, 16))
	got2 := make([]byte, 64)
	s2.XORKeyStream(got2, got2)
	if bytes.Equal(got, got2) {
		t.Error("RC4 keystream reused across nonces")
	}
}

func TestStreamRejectsBadIV(t *testing.T) {
	k := testKeys(t, "alice")
	for _, alg := range Algorithms {
		if _, err := k.Stream(alg, make([]byte, alg.IVSize()+1)); err == nil {
			t.Errorf("%s accepted wrong IV length", alg)
		}
	}
	if _, err := k.Stream("ECB", nil); err == nil {
		t.Error("unknown algorithm accepted")
	}
}

func TestEntropy(t *testing.T) {
	if h := ShannonEntropy(bytes.Repeat([]byte{7}, 1000)); h != 0 {
		t.Errorf("constant data entropy = %v, want 0", h)
	}
	all := make([]byte, 256*4)
	for i := range all {
		all[i] = byte(i)
	}
	if h := ShannonEntropy(all); h != 8 {
		t.Errorf("uniform data entropy = %v, want 8", h)
	}
	if h := ShannonEntropy(nil); h != 0 {
		t.Errorf("empty entropy = %v", h)
	}
}

func BenchmarkCipher(b *testing.B) {
	k := testKeys(b, "bench")
	for _, size := range []int{1 << 10, 1 << 20} {
		buf := randBytes(b, size)
		for _, alg := range Algorithms {
			b.Run(string(alg)+"/"+sizeLabel(size), func(b *testing.B) {
				iv, _ := NewIV(alg)
				b.SetBytes(int64(size))
				for b.Loop() {
					var s cipher.Stream
					s, _ = k.Stream(alg, iv)
					s.XORKeyStream(buf, buf)
				}
			})
		}
	}
}

func sizeLabel(n int) string {
	if n >= 1<<20 {
		return "1MB"
	}
	return "1KB"
}
