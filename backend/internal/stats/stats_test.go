package stats

import (
	"math"
	"testing"
)

func TestSummarize(t *testing.T) {
	s := Summarize([]int64{4, 1, 3, 2})
	if s.Mean != 2.5 || s.Median != 2.5 || s.Min != 1 || s.Max != 4 {
		t.Errorf("got %+v", s)
	}
	if want := math.Sqrt(5.0 / 3.0); math.Abs(s.Stddev-want) > 1e-12 {
		t.Errorf("stddev = %v, want %v", s.Stddev, want)
	}
	if s := Summarize([]int64{7}); s.Median != 7 || s.Stddev != 0 {
		t.Errorf("single: %+v", s)
	}
	if s := Summarize(nil); s != (Summary{}) {
		t.Errorf("empty: %+v", s)
	}
}

func TestThroughput(t *testing.T) {
	if got := Throughput(1e6, 1e9); got != 1 {
		t.Errorf("1MB in 1s = %v MB/s", got)
	}
	if got := Throughput(1, 0); got != 0 {
		t.Errorf("zero time = %v", got)
	}
}
