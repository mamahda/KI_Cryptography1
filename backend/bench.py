"""Measures AES-256-CTR, DES-CTR and RC4-drop[3072] in memory and analyses
their ciphertexts, writing CSV files for the report.

    python bench.py --runs 30 --sizes 1KB,100KB,1MB,10MB,100MB --out ../report

Every timing covers building the cipher (key schedule, RC4 drop) plus the
keystream XOR, and nothing else: no disk I/O and no HMAC.
"""

import argparse
import csv
import os
import time

from Crypto.Cipher import AES, DES

from app.crypto import ALGORITHMS, IV_SIZE, MAC_SIZE, SECRET_SIZE, Keys, hamming_distance, new_iv, shannon_entropy
from app.stats import summarize, throughput


def parse_sizes(text: str) -> list[int]:
    units = {"MB": 1024 * 1024, "KB": 1024, "B": 1}
    out = []
    for part in text.split(","):
        p = part.strip().upper()
        for suffix, mult in units.items():
            if p.endswith(suffix):
                out.append(int(p[: -len(suffix)]) * mult)
                break
        else:
            out.append(int(p))
    if any(n <= 0 for n in out):
        raise argparse.ArgumentTypeError("sizes must be positive")
    return out


def size_label(n: int) -> str:
    if n >= 1 << 20 and n % (1 << 20) == 0:
        return f"{n >> 20}MB"
    if n >= 1 << 10 and n % (1 << 10) == 0:
        return f"{n >> 10}KB"
    return f"{n}B"


def fmt_ns(ns: float) -> str:
    for unit, div in (("s", 1e9), ("ms", 1e6), ("µs", 1e3)):
        if ns >= div:
            return f"{ns / div:.2f} {unit}"
    return f"{ns:.0f} ns"


def xor_timed(keys: Keys, alg: str, iv: bytes, data: bytes) -> tuple[bytes, int]:
    start = time.perf_counter_ns()
    out = keys.cipher(alg, iv).encrypt(data)
    return out, time.perf_counter_ns() - start


def timing(keys: Keys, sizes: list[int], runs: int, out_dir: str) -> None:
    raw_f = open(os.path.join(out_dir, "bench_raw.csv"), "w", newline="")
    sum_f = open(os.path.join(out_dir, "bench_summary.csv"), "w", newline="")
    with raw_f, sum_f:
        raw = csv.writer(raw_f)
        summ = csv.writer(sum_f)
        raw.writerow(["algorithm", "size_bytes", "operation", "run", "ns"])
        summ.writerow(
            ["algorithm", "size_bytes", "operation", "runs", "mean_ns", "median_ns", "stddev_ns", "min_ns", "max_ns",
             "throughput_mbps"]
        )
        print(f"{'algorithm':>9} {'size':>6} {'operation':>9} {'mean':>11} {'median':>11} {'stddev':>11} {'MB/s':>9}")
        for size in sizes:
            pt = os.urandom(size)
            enc = {a: [] for a in ALGORITHMS}
            dec = {a: [] for a in ALGORITHMS}
            for run in range(-1, runs):  # run -1 is a warm-up
                for i in range(len(ALGORITHMS)):
                    alg = ALGORITHMS[(i + max(run, 0)) % len(ALGORITHMS)]
                    iv = new_iv(alg)
                    ct, e = xor_timed(keys, alg, iv, pt)
                    back, d = xor_timed(keys, alg, iv, ct)
                    if back != pt:
                        raise SystemExit(f"{alg}: round trip mismatch at size {size}")
                    if run < 0:
                        continue
                    enc[alg].append(e)
                    dec[alg].append(d)
                    raw.writerow([alg, size, "encrypt", run, e])
                    raw.writerow([alg, size, "decrypt", run, d])
            for alg in ALGORITHMS:
                for op, xs in (("encrypt", enc[alg]), ("decrypt", dec[alg])):
                    s = summarize(xs)
                    mbps = throughput(size, s["mean_ns"])
                    summ.writerow(
                        [alg, size, op, len(xs), f"{s['mean_ns']:.2f}", f"{s['median_ns']:.2f}", f"{s['stddev_ns']:.2f}",
                         s["min_ns"], s["max_ns"], f"{mbps:.2f}"]
                    )
                    print(
                        f"{alg:>9} {size_label(size):>6} {op:>9} {fmt_ns(s['mean_ns']):>11} {fmt_ns(s['median_ns']):>11} "
                        f"{fmt_ns(s['stddev_ns']):>11} {mbps:>9.1f}"
                    )


def ecb_encrypt(cipher, data: bytes) -> bytes:
    """ECB, for contrast only (never used by the app): identical plaintext
    blocks give identical ciphertext blocks, which is why the assignment
    forbids it."""
    n = len(data) // cipher.block_size * cipher.block_size
    return cipher.encrypt(data[:n])


def analysis(keys: Keys, out_dir: str) -> None:
    size = 1 << 20
    line = b"Nama: Budi Santoso; NIK: 3174012345678901; Alamat: Jl. Merdeka No. 1, Jakarta. "
    inputs = {
        "zeros": bytes(size),
        "text": (line * (size // len(line) + 1))[:size],
        "random": os.urandom(size),
    }
    ecb = {
        "AES-ECB (pembanding)": AES.new(os.urandom(32), AES.MODE_ECB),
        "DES-ECB (pembanding)": DES.new(os.urandom(8), DES.MODE_ECB),
    }
    with open(os.path.join(out_dir, "cipher_analysis.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(
            ["plaintext", "algorithm", "plaintext_bytes", "ciphertext_bytes", "stored_overhead_bytes", "plain_entropy",
             "cipher_entropy", "bitflip_changed_bits", "fresh_iv_hamming_ratio"]
        )
        print(f"\n{'plaintext':<9} {'algorithm':<22} {'H(plain)':>8} {'H(cipher)':>9} {'bitflip':>8} {'fresh-IV hamming':>17}")
        for name, data in inputs.items():
            p_h = shannon_entropy(data)
            for alg in ALGORITHMS:
                iv = new_iv(alg)
                c1, _ = xor_timed(keys, alg, iv, data)
                # Same key and IV, one plaintext bit flipped.
                flipped = bytearray(data)
                flipped[size // 2] ^= 0x01
                c2, _ = xor_timed(keys, alg, iv, bytes(flipped))
                # Same plaintext, fresh IV.
                c3, _ = xor_timed(keys, alg, new_iv(alg), data)
                c_h = shannon_entropy(c1)
                bitflip = hamming_distance(c1, c2)
                ratio = hamming_distance(c1, c3) / (size * 8)
                w.writerow(
                    [name, alg, size, len(c1), IV_SIZE[alg] + MAC_SIZE, f"{p_h:.4f}", f"{c_h:.4f}", bitflip, f"{ratio:.4f}"]
                )
                print(f"{name:<9} {alg:<22} {p_h:>8.4f} {c_h:>9.4f} {bitflip:>4} bit {ratio:>17.4f}")
            for label, cipher in ecb.items():
                c = ecb_encrypt(cipher, data)
                c_h = shannon_entropy(c)
                w.writerow([name, label, size, len(c), 0, f"{p_h:.4f}", f"{c_h:.4f}", "", ""])
                print(f"{name:<9} {label:<22} {p_h:>8.4f} {c_h:>9.4f} {'-':>8} {'-':>17}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sizes", type=parse_sizes, default=parse_sizes("1KB,100KB,1MB,10MB,100MB"))
    ap.add_argument("--runs", type=int, default=30, help="measured runs per algorithm, size and operation")
    ap.add_argument("--out", default="../report", help="directory for CSV output")
    args = ap.parse_args()
    if args.runs < 1:
        ap.error("--runs must be at least 1")
    os.makedirs(args.out, exist_ok=True)
    keys = Keys(os.urandom(SECRET_SIZE), "bench")
    timing(keys, args.sizes, args.runs, args.out)
    analysis(keys, args.out)
    print(f"\nCSV ditulis ke {os.path.abspath(args.out)}")


if __name__ == "__main__":
    main()
