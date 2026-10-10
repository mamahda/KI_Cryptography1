"""Summaries of repeated timing measurements."""

import statistics


def summarize(xs: list[int]) -> dict:
    """Mean, median, sample standard deviation, min and max (nanoseconds)."""
    if not xs:
        return {"mean_ns": 0, "median_ns": 0, "stddev_ns": 0, "min_ns": 0, "max_ns": 0}
    return {
        "mean_ns": statistics.fmean(xs),
        "median_ns": float(statistics.median(xs)),
        "stddev_ns": statistics.stdev(xs) if len(xs) > 1 else 0.0,
        "min_ns": min(xs),
        "max_ns": max(xs),
    }


def throughput(nbytes: float, ns: float) -> float:
    """MB/s with MB = 10^6 bytes."""
    if ns <= 0:
        return 0.0
    return nbytes / (ns / 1e9) / 1e6
