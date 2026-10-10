import type { Summary } from './api'

/** Mean, median, sample standard deviation, min and max (same as the backend). */
export function summarize(xs: number[]): Summary {
  if (xs.length === 0) return { mean_ns: 0, median_ns: 0, stddev_ns: 0, min_ns: 0, max_ns: 0 }
  const s = [...xs].sort((a, b) => a - b)
  const n = s.length
  const mean = s.reduce((a, b) => a + b, 0) / n
  const median = n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
  const variance = n > 1 ? s.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (n - 1) : 0
  return { mean_ns: mean, median_ns: median, stddev_ns: Math.sqrt(variance), min_ns: s[0], max_ns: s[n - 1] }
}

/** MB/s with MB = 10^6 bytes. */
export function throughput(bytes: number, ns: number): number {
  return ns > 0 ? bytes / (ns / 1e9) / 1e6 : 0
}
