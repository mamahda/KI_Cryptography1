// Command bench measures AES-256-CTR, DES-CTR and RC4-drop[3072] in memory
// and analyses their ciphertexts, writing CSV files for the report.
//
//	go run ./cmd/bench -runs 30 -sizes 1KB,100KB,1MB,10MB,100MB -out ../report
package main

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/des"
	"crypto/rand"
	"encoding/csv"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"text/tabwriter"
	"time"

	"vault/internal/crypto"
	"vault/internal/stats"
)

func main() {
	sizesFlag := flag.String("sizes", "1KB,100KB,1MB,10MB,100MB", "comma-separated plaintext sizes (B, KB, MB; powers of 1024)")
	runs := flag.Int("runs", 30, "measured runs per algorithm, size and operation")
	out := flag.String("out", "../report", "directory for CSV output")
	flag.Parse()

	sizes, err := parseSizes(*sizesFlag)
	if err != nil {
		log.Fatal(err)
	}
	if *runs < 1 {
		log.Fatal("-runs must be at least 1")
	}
	if err := os.MkdirAll(*out, 0o755); err != nil {
		log.Fatal(err)
	}

	secret := make([]byte, crypto.SecretSize)
	rand.Read(secret)
	keys, err := crypto.DeriveKeys(secret, "bench")
	if err != nil {
		log.Fatal(err)
	}

	if err := timing(keys, sizes, *runs, *out); err != nil {
		log.Fatal(err)
	}
	if err := analysis(keys, *out); err != nil {
		log.Fatal(err)
	}
}

// timing encrypts and decrypts random data of each size runs times per
// algorithm. Every measurement includes building the stream (key schedule,
// RC4 drop) and the keystream XOR, and nothing else: no I/O, no HMAC.
func timing(keys *crypto.Keys, sizes []int, runs int, out string) error {
	rawF, raw, err := newCSV(filepath.Join(out, "bench_raw.csv"),
		"algorithm", "size_bytes", "operation", "run", "ns")
	if err != nil {
		return err
	}
	defer rawF.Close()
	sumF, sum, err := newCSV(filepath.Join(out, "bench_summary.csv"),
		"algorithm", "size_bytes", "operation", "runs", "mean_ns", "median_ns", "stddev_ns", "min_ns", "max_ns", "throughput_mbps")
	if err != nil {
		return err
	}
	defer sumF.Close()

	tw := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', tabwriter.AlignRight)
	fmt.Fprintln(tw, "algorithm\tsize\toperation\tmean\tmedian\tstddev\tMB/s\t")

	algs := crypto.Algorithms
	for _, size := range sizes {
		pt := make([]byte, size)
		rand.Read(pt)
		ct := make([]byte, size)
		dec := make([]byte, size)
		enc := map[crypto.Algorithm][]int64{}
		decT := map[crypto.Algorithm][]int64{}

		for run := -1; run < runs; run++ { // run -1 is a warm-up
			for i := range algs {
				alg := algs[(i+max(run, 0))%len(algs)]
				iv, err := crypto.NewIV(alg)
				if err != nil {
					return err
				}
				e, err := xorTimed(keys, alg, iv, ct, pt)
				if err != nil {
					return err
				}
				d, err := xorTimed(keys, alg, iv, dec, ct)
				if err != nil {
					return err
				}
				if !bytes.Equal(dec, pt) {
					return fmt.Errorf("%s: round trip mismatch at size %d", alg, size)
				}
				if run < 0 {
					continue
				}
				enc[alg] = append(enc[alg], e)
				decT[alg] = append(decT[alg], d)
				raw.Write([]string{string(alg), itoa(size), "encrypt", itoa(run), i64(e)})
				raw.Write([]string{string(alg), itoa(size), "decrypt", itoa(run), i64(d)})
			}
		}

		for _, alg := range algs {
			for _, op := range []struct {
				name string
				xs   []int64
			}{{"encrypt", enc[alg]}, {"decrypt", decT[alg]}} {
				s := stats.Summarize(op.xs)
				mbps := stats.Throughput(float64(size), s.Mean)
				sum.Write([]string{string(alg), itoa(size), op.name, itoa(len(op.xs)),
					f2(s.Mean), f2(s.Median), f2(s.Stddev), i64(s.Min), i64(s.Max), f2(mbps)})
				fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\t%s\t%.1f\t\n", alg, sizeLabel(size), op.name,
					dur(s.Mean), dur(s.Median), dur(s.Stddev), mbps)
			}
		}
	}
	tw.Flush()
	raw.Flush()
	sum.Flush()
	if err := raw.Error(); err != nil {
		return err
	}
	return sum.Error()
}

func xorTimed(keys *crypto.Keys, alg crypto.Algorithm, iv, dst, src []byte) (int64, error) {
	start := time.Now()
	s, err := keys.Stream(alg, iv)
	if err != nil {
		return 0, err
	}
	s.XORKeyStream(dst, src)
	return time.Since(start).Nanoseconds(), nil
}

// analysis compares ciphertext properties on structured and random
// plaintexts, with ECB rows for contrast only (ECB is never used by the app).
func analysis(keys *crypto.Keys, out string) error {
	f, w, err := newCSV(filepath.Join(out, "cipher_analysis.csv"),
		"plaintext", "algorithm", "plaintext_bytes", "ciphertext_bytes", "stored_overhead_bytes",
		"plain_entropy", "cipher_entropy", "bitflip_changed_bits", "fresh_iv_hamming_ratio")
	if err != nil {
		return err
	}
	defer f.Close()

	const size = 1 << 20
	const line = "Nama: Budi Santoso; NIK: 3174012345678901; Alamat: Jl. Merdeka No. 1, Jakarta. "
	text := []byte(strings.Repeat(line, size/len(line)+1))[:size]
	random := make([]byte, size)
	rand.Read(random)
	inputs := []struct {
		name string
		data []byte
	}{{"zeros", make([]byte, size)}, {"text", text}, {"random", random}}

	fmt.Println()
	tw := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "plaintext\talgorithm\tH(plain)\tH(cipher)\tbitflip\tfresh-IV hamming\t")
	for _, in := range inputs {
		pH := crypto.ShannonEntropy(in.data)
		for _, alg := range crypto.Algorithms {
			iv, _ := crypto.NewIV(alg)
			c1 := make([]byte, size)
			if _, err := xorTimed(keys, alg, iv, c1, in.data); err != nil {
				return err
			}
			// Same key and IV, one plaintext bit flipped.
			flipped := bytes.Clone(in.data)
			flipped[size/2] ^= 0x01
			c2 := make([]byte, size)
			xorTimed(keys, alg, iv, c2, flipped)
			// Same plaintext, fresh IV.
			iv2, _ := crypto.NewIV(alg)
			c3 := make([]byte, size)
			xorTimed(keys, alg, iv2, c3, in.data)

			cH := crypto.ShannonEntropy(c1)
			bitflip := crypto.HammingDistance(c1, c2)
			ratio := float64(crypto.HammingDistance(c1, c3)) / float64(size*8)
			w.Write([]string{in.name, string(alg), itoa(size), itoa(len(c1)), itoa(alg.IVSize() + crypto.MACSize),
				f4(pH), f4(cH), itoa(bitflip), f4(ratio)})
			fmt.Fprintf(tw, "%s\t%s\t%.4f\t%.4f\t%d bit\t%.4f\t\n", in.name, alg, pH, cH, bitflip, ratio)
		}
		for _, e := range ecbModes() {
			c := e.encrypt(in.data)
			cH := crypto.ShannonEntropy(c)
			w.Write([]string{in.name, e.name, itoa(size), itoa(len(c)), "0", f4(pH), f4(cH), "", ""})
			fmt.Fprintf(tw, "%s\t%s\t%.4f\t%.4f\t-\t-\t\n", in.name, e.name, pH, cH)
		}
	}
	tw.Flush()
	w.Flush()
	return w.Error()
}

type ecb struct {
	name    string
	encrypt func([]byte) []byte
}

// ecbModes encrypts each block independently. Identical plaintext blocks
// give identical ciphertext blocks, which is why the assignment forbids ECB.
func ecbModes() []ecb {
	mk := func(name string, b cipher.Block) ecb {
		return ecb{name, func(pt []byte) []byte {
			bs := b.BlockSize()
			n := len(pt) / bs * bs // inputs here are block-aligned
			out := make([]byte, n)
			for i := 0; i < n; i += bs {
				b.Encrypt(out[i:i+bs], pt[i:i+bs])
			}
			return out
		}}
	}
	k32 := make([]byte, 32)
	k8 := make([]byte, 8)
	rand.Read(k32)
	rand.Read(k8)
	a, _ := aes.NewCipher(k32)
	d, _ := des.NewCipher(k8)
	return []ecb{mk("AES-ECB (pembanding)", a), mk("DES-ECB (pembanding)", d)}
}

func newCSV(path string, header ...string) (*os.File, *csv.Writer, error) {
	f, err := os.Create(path)
	if err != nil {
		return nil, nil, err
	}
	w := csv.NewWriter(f)
	w.Write(header)
	return f, w, nil
}

func parseSizes(s string) ([]int, error) {
	var out []int
	for _, part := range strings.Split(s, ",") {
		p := strings.ToUpper(strings.TrimSpace(part))
		mult := 1
		switch {
		case strings.HasSuffix(p, "MB"):
			mult, p = 1<<20, strings.TrimSuffix(p, "MB")
		case strings.HasSuffix(p, "KB"):
			mult, p = 1<<10, strings.TrimSuffix(p, "KB")
		case strings.HasSuffix(p, "B"):
			p = strings.TrimSuffix(p, "B")
		}
		n, err := strconv.Atoi(p)
		if err != nil || n <= 0 {
			return nil, fmt.Errorf("invalid size %q", part)
		}
		out = append(out, n*mult)
	}
	return out, nil
}

func sizeLabel(n int) string {
	switch {
	case n >= 1<<20 && n%(1<<20) == 0:
		return fmt.Sprintf("%dMB", n>>20)
	case n >= 1<<10 && n%(1<<10) == 0:
		return fmt.Sprintf("%dKB", n>>10)
	}
	return fmt.Sprintf("%dB", n)
}

func dur(ns float64) string { return time.Duration(ns).Round(100 * time.Nanosecond).String() }
func itoa(n int) string     { return strconv.Itoa(n) }
func i64(n int64) string    { return strconv.FormatInt(n, 10) }
func f2(x float64) string   { return strconv.FormatFloat(x, 'f', 2, 64) }
func f4(x float64) string   { return strconv.FormatFloat(x, 'f', 4, 64) }
