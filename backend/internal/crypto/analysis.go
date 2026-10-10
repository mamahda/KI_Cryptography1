package crypto

import (
	"math"
	"math/bits"
)

// Entropy is an io.Writer that accumulates a byte histogram so the Shannon
// entropy of arbitrarily large streams can be computed in one pass.
type Entropy struct {
	counts [256]uint64
	n      uint64
}

func (e *Entropy) Write(p []byte) (int, error) {
	for _, b := range p {
		e.counts[b]++
	}
	e.n += uint64(len(p))
	return len(p), nil
}

// Bits returns the entropy in bits per byte: 0 for constant data, 8 for
// uniformly random data.
func (e *Entropy) Bits() float64 {
	if e.n == 0 {
		return 0
	}
	var h float64
	total := float64(e.n)
	for _, c := range e.counts {
		if c == 0 {
			continue
		}
		p := float64(c) / total
		h -= p * math.Log2(p)
	}
	return h
}

// ShannonEntropy returns the entropy of b in bits per byte.
func ShannonEntropy(b []byte) float64 {
	var e Entropy
	e.Write(b)
	return e.Bits()
}

// HammingDistance counts differing bits between a and b, which must have
// equal length.
func HammingDistance(a, b []byte) int {
	if len(a) != len(b) {
		panic("crypto: HammingDistance on slices of different length")
	}
	d := 0
	for i := range a {
		d += bits.OnesCount8(a[i] ^ b[i])
	}
	return d
}
