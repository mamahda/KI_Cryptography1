import math

from app.stats import summarize, throughput


def test_summarize():
    s = summarize([4, 1, 3, 2])
    assert s["mean_ns"] == 2.5
    assert s["median_ns"] == 2.5
    assert (s["min_ns"], s["max_ns"]) == (1, 4)
    assert math.isclose(s["stddev_ns"], math.sqrt(5 / 3))


def test_summarize_edge_cases():
    single = summarize([7])
    assert single["median_ns"] == 7 and single["stddev_ns"] == 0
    assert summarize([])["mean_ns"] == 0


def test_throughput():
    assert throughput(1e6, 1e9) == 1  # 1 MB in 1 s
    assert throughput(1, 0) == 0
