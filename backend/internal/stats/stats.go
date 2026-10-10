// Package stats summarizes repeated timing measurements.
package stats

import (
	"math"
	"slices"
)

type Summary struct {
	Mean   float64 `json:"mean_ns"`
	Median float64 `json:"median_ns"`
	Stddev float64 `json:"stddev_ns"`
	Min    int64   `json:"min_ns"`
	Max    int64   `json:"max_ns"`
}

// Summarize returns mean, median, sample standard deviation, min and max.
func Summarize(xs []int64) Summary {
	if len(xs) == 0 {
		return Summary{}
	}
	s := slices.Clone(xs)
	slices.Sort(s)
	var sum float64
	for _, x := range s {
		sum += float64(x)
	}
	mean := sum / float64(len(s))
	var median float64
	if n := len(s); n%2 == 1 {
		median = float64(s[n/2])
	} else {
		median = (float64(s[n/2-1]) + float64(s[n/2])) / 2
	}
	var sq float64
	for _, x := range s {
		d := float64(x) - mean
		sq += d * d
	}
	var sd float64
	if len(s) > 1 {
		sd = math.Sqrt(sq / float64(len(s)-1))
	}
	return Summary{Mean: mean, Median: median, Stddev: sd, Min: s[0], Max: s[len(s)-1]}
}

// Throughput converts bytes processed in ns nanoseconds to MB/s
// (10^6 bytes per second).
func Throughput(bytes, ns float64) float64 {
	if ns <= 0 {
		return 0
	}
	return bytes / (ns / 1e9) / 1e6
}
