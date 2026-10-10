"""Running-time measurements: repeated decryption on the server, download
times measured in the browser, and the stored history."""

import time

from flask import Blueprint, Response, g, jsonify, request

from .. import db
from ..crypto import AuthError, parse_algorithm
from ..stats import summarize, throughput
from .common import BadRequest, UUID_RE, error, integrity_error, login_required, parse_json, storage, user_keys

bp = Blueprint("bench", __name__)

DEFAULT_RUNS = 10
MAX_RUNS = 50
MAX_CLIENT_RUNS = 200
MAX_RAW_ROWS = 20000


@bp.post("/files/<file_id>/benchmark")
@login_required
def benchmark_file(file_id: str):
    """Decrypts every variant of a file `runs` times and reports statistics.

    - Only cipher time is measured (setup + keystream XOR), not disk I/O.
    - The HMAC is verified once per variant and timed separately, since it
      costs the same for every cipher.
    - A warm-up pass loads the files into the OS page cache.
    - The algorithm order rotates each run so no cipher is always measured first.
    """
    if not UUID_RE.match(file_id):
        return error(404, "file tidak ditemukan")
    data = parse_json({"runs"}) if request.content_length else {}
    runs = data.get("runs") or DEFAULT_RUNS
    if not isinstance(runs, int) or isinstance(runs, bool) or not 1 <= runs <= MAX_RUNS:
        raise BadRequest(f"runs harus antara 1 dan {MAX_RUNS}")

    rows = db.file_variants(g.user["id"], file_id)
    if not rows:
        return error(404, "file tidak ditemukan")
    keys = user_keys()
    size = rows[0]["size_plain"]

    states = []
    try:
        for row in rows:
            f = storage().open(row["storage_path"])
            state = {"row": row, "alg": row["algorithm"], "f": f, "cipher": [], "total": []}
            states.append(state)
            start = time.perf_counter_ns()
            try:
                keys.verify(row["algorithm"], row["iv"], row["mac"], row["id"].encode(), f)
            except AuthError:
                return integrity_error(f"file ({row['algorithm']})")
            state["verify_ns"] = time.perf_counter_ns() - start

        def decrypt(state):
            state["f"].seek(0)
            return keys.decrypt(state["alg"], state["row"]["iv"], state["f"])

        for state in states:  # warm-up, not recorded
            decrypt(state)

        records = []
        for run in range(runs):
            for i in range(len(states)):
                state = states[(i + run) % len(states)]
                m = decrypt(state)
                state["cipher"].append(m.cipher_ns)
                state["total"].append(m.total_ns)
                records.append(
                    {
                        "file_id": file_id,
                        "algorithm": state["alg"],
                        "operation": "decrypt",
                        "source": "server",
                        "bytes": size,
                        "run_index": run,
                        "duration_ns": m.cipher_ns,
                    }
                )
    finally:
        for state in states:
            state["f"].close()

    db.insert_benchmarks(g.user["id"], records)
    results = []
    for state in states:
        cipher = summarize(state["cipher"])
        results.append(
            {
                "algorithm": state["alg"],
                "verify_ns": state["verify_ns"],
                "cipher": cipher,
                "total": summarize(state["total"]),
                "throughput_mbps": throughput(size, cipher["mean_ns"]),
                "cipher_ns": state["cipher"],
            }
        )
    return jsonify(file_id=file_id, bytes=size, runs=runs, results=results)


@bp.post("/benchmarks")
@login_required
def record_client_benchmark():
    """Stores download times measured in the browser. The byte count comes
    from the database, not the client."""
    data = parse_json({"file_id", "algorithm", "durations_ns"})
    try:
        alg = parse_algorithm(str(data.get("algorithm", "")))
    except ValueError:
        return error(400, "algorithm harus AES, DES, atau RC4")
    durations = data.get("durations_ns")
    if not isinstance(durations, list) or not 1 <= len(durations) <= MAX_CLIENT_RUNS:
        return error(400, f"durations_ns harus berisi 1–{MAX_CLIENT_RUNS} nilai")
    hour = 3600 * 10**9
    if not all(isinstance(d, int) and not isinstance(d, bool) and 0 < d <= hour for d in durations):
        return error(400, "durasi harus bilangan bulat positif dan kurang dari 1 jam")
    file_id = str(data.get("file_id", ""))
    f = db.file_owned(g.user["id"], file_id) if UUID_RE.match(file_id) else None
    if f is None:
        return error(404, "file tidak ditemukan")
    db.insert_benchmarks(
        g.user["id"],
        [
            {
                "file_id": file_id,
                "algorithm": alg,
                "operation": "download",
                "source": "client",
                "bytes": f["size_plain"],
                "run_index": i,
                "duration_ns": d,
            }
            for i, d in enumerate(durations)
        ],
    )
    return jsonify(inserted=len(durations)), 201


@bp.get("/benchmarks")
@login_required
def summary():
    out = []
    for r in db.benchmark_summaries(g.user["id"]):
        mean = float(r["mean_ns"])
        nbytes = float(r["bytes"])
        out.append(
            {
                "file_id": r["file_id"],
                "algorithm": r["algorithm"],
                "operation": r["operation"],
                "source": r["source"],
                "runs": int(r["runs"]),
                "bytes": nbytes,
                "mean_ns": mean,
                "min_ns": int(r["min_ns"]),
                "max_ns": int(r["max_ns"]),
                "stddev_ns": float(r["stddev_ns"] or 0),
                "throughput_mbps": throughput(nbytes, mean),
            }
        )
    return jsonify(summary=out)


@bp.get("/benchmarks/raw")
@login_required
def raw():
    rows = db.benchmarks(g.user["id"], MAX_RAW_ROWS)
    for r in rows:
        r["created_at"] = db.iso(r["created_at"])
    return jsonify(rows=rows)


@bp.delete("/benchmarks")
@login_required
def clear():
    db.delete_benchmarks(g.user["id"])
    return Response(status=204)
