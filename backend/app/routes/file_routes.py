"""KTP image, document and video files: upload, list, download, delete, analysis."""

import os
import time
from urllib.parse import quote

from flask import Blueprint, Response, current_app, g, jsonify, request, stream_with_context

from .. import db, filetype
from ..crypto import ALGORITHMS, AuthError, Entropy, Stats
from .common import (
    UUID_RE,
    alg_param,
    error,
    integrity_error,
    login_required,
    new_uuid,
    storage,
    timing,
    user_keys,
)

bp = Blueprint("files", __name__)

PREVIEW_BYTES = 256

ALG_INFO = {
    "AES": {"mode": "CTR", "key_bits": 256, "block_bits": 128},
    "DES": {"mode": "CTR", "key_bits": 56, "block_bits": 64},
    "RC4": {"mode": "Stream (drop-3072, nonce per file)", "key_bits": 128, "block_bits": 0},
}


def name_aad(file_id: str) -> bytes:
    """Binds an encrypted filename to its file."""
    return f"{file_id}|name".encode()


def file_name(keys, row: dict) -> str:
    """Decrypts the filename stored with a variant. Raises AuthError."""
    name, _ = keys.open(row["algorithm"], row["name_iv"], row["name_ciphertext"], row["name_mac"], name_aad(row["id"]))
    return name.decode()


def file_json(row: dict, name: str) -> dict:
    return {
        "id": row["id"],
        "category": row["category"],
        "filename": name,
        "mime_type": row["mime_type"],
        "size": row["size_plain"],
        "created_at": db.iso(row["created_at"]),
    }


def content_disposition(name: str) -> str:
    """attachment with an ASCII fallback plus the RFC 5987 UTF-8 name."""
    ascii_name = name.encode("ascii", "replace").decode().replace('"', "_").replace("\\", "_")
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}"


@bp.post("/files")
@login_required
def upload():
    """Saves one uploaded file, validates it, then encrypts it separately with
    AES, DES and RC4. Either all three variants and their rows exist
    afterwards, or none do."""
    category_raw = request.form.get("category", "")
    upload_file = request.files.get("file")
    try:
        category = filetype.parse_category(category_raw)
    except filetype.FileTypeError as e:
        return error(400, str(e))
    if upload_file is None:
        return error(400, "field file wajib diisi")

    src = upload_file.stream  # anonymous temp file in storage/.tmp (see VaultRequest)
    src.seek(0, os.SEEK_END)
    size = src.tell()
    src.seek(0)
    if size == 0:
        return error(400, "file kosong")
    if size > filetype.MAX_SIZE[category]:
        return error(413, f"ukuran file melebihi batas {filetype.MAX_SIZE[category] // filetype.MB} MB untuk kategori ini")
    filename = filetype.sanitize_filename(upload_file.filename or "")
    if not filename:
        return error(400, "nama file tidak valid")
    head = src.read(512)
    src.seek(0)
    try:
        mime_type = filetype.detect(category, filename, head, src)
    except filetype.FileTypeError as e:
        return error(415, str(e))

    keys = user_keys()
    file_id = new_uuid()
    user_id = g.user["id"]
    written: list[str] = []
    variants, timings = [], {}
    try:
        for alg in ALGORITHMS:
            rel = storage().rel_path(user_id, file_id, alg)
            src.seek(0)
            with storage().create(rel) as out:
                written.append(rel)
                sealed = keys.encrypt(alg, src, out, file_id.encode())
            name_sealed, name_ct = keys.seal(alg, filename.encode(), name_aad(file_id))
            variants.append(
                {
                    "algorithm": alg,
                    "storage_path": rel,
                    "iv": sealed.iv,
                    "mac": sealed.mac,
                    "name_iv": name_sealed.iv,
                    "name_ciphertext": name_ct,
                    "name_mac": name_sealed.mac,
                    "size_cipher": sealed.stats.bytes,
                    "encrypt_ns": sealed.stats.cipher_ns,
                    "encrypt_total_ns": sealed.stats.total_ns,
                }
            )
            timings[alg] = timing(sealed)
        row = {"id": file_id, "user_id": user_id, "category": category, "mime_type": mime_type, "size_plain": size}
        db.create_file(row, variants)
    except BaseException:
        for rel in written:
            storage().remove(rel)
        raise

    try:
        db.insert_benchmarks(
            user_id,
            [
                {
                    "file_id": file_id,
                    "algorithm": v["algorithm"],
                    "operation": "encrypt",
                    "source": "server",
                    "bytes": size,
                    "duration_ns": v["encrypt_ns"],
                }
                for v in variants
            ],
        )
    except Exception:
        current_app.logger.exception("record encrypt benchmark")

    row["created_at"] = db.file_owned(user_id, file_id)["created_at"]
    return jsonify(file=file_json(row, filename), encrypt=timings), 201


@bp.get("/files")
@login_required
def list_files():
    category = request.args.get("category") or None
    if category:
        try:
            filetype.parse_category(category)
        except filetype.FileTypeError as e:
            return error(400, str(e))
    keys = user_keys()
    out = []
    for row in db.list_files(g.user["id"], category, "AES"):
        try:
            item = file_json(row, file_name(keys, row))
        except AuthError:
            item = file_json(row, "")
            item["integrity_error"] = True
        out.append(item)
    return jsonify(files=out)


def _lookup_variant(file_id: str):
    """Returns (row, alg) for a file owned by the user, or an error response."""
    if not UUID_RE.match(file_id):
        return None, error(404, "file tidak ditemukan")
    alg = alg_param()
    row = db.file_variant(g.user["id"], file_id, alg)
    if row is None:
        return None, error(404, "file tidak ditemukan")
    return (row, alg), None


@bp.get("/files/<file_id>/download")
@login_required
def download(file_id: str):
    """Verifies the HMAC over the whole ciphertext first and only then
    streams the decrypted file, so tampered data is never sent."""
    found, err = _lookup_variant(file_id)
    if err:
        return err
    row, alg = found
    keys = user_keys()
    try:
        name = file_name(keys, row)
    except AuthError:
        return integrity_error("nama file")

    f = storage().open(row["storage_path"])
    start = time.perf_counter_ns()
    try:
        keys.verify(alg, row["iv"], row["mac"], row["id"].encode(), f)
    except AuthError:
        f.close()
        return integrity_error("file")
    verify_ns = time.perf_counter_ns() - start
    f.seek(0)
    user_id, size = g.user["id"], row["size_plain"]

    def generate():
        stats = Stats()
        try:
            yield from keys.decrypt_chunks(alg, row["iv"], f, stats)
        finally:
            f.close()
        try:
            db.insert_benchmarks(
                user_id,
                [
                    {
                        "file_id": row["id"],
                        "algorithm": alg,
                        "operation": "download",
                        "source": "server",
                        "bytes": stats.bytes,
                        "duration_ns": stats.cipher_ns,
                    }
                ],
            )
        except Exception:
            current_app.logger.exception("record download benchmark")

    resp = Response(stream_with_context(generate()), mimetype=row["mime_type"])
    resp.call_on_close(f.close)  # also closes the file if the body is never read (e.g. HEAD)
    resp.headers["Content-Length"] = str(size)
    resp.headers["Content-Disposition"] = content_disposition(name)
    resp.headers["X-Algorithm"] = alg
    resp.headers["X-Verify-Ns"] = str(verify_ns)
    return resp


@bp.delete("/files/<file_id>")
@login_required
def delete(file_id: str):
    if not UUID_RE.match(file_id):
        return error(404, "file tidak ditemukan")
    paths = db.delete_file(g.user["id"], file_id)
    if paths is None:
        return error(404, "file tidak ditemukan")
    for rel in paths:
        try:
            storage().remove(rel)
        except OSError:
            current_app.logger.exception("remove variant %s", rel)
    return Response(status=204)


class _Head:
    """Keeps the first n bytes written to it."""

    def __init__(self, n: int):
        self.n = n
        self.buf = b""

    def update(self, data: bytes) -> None:
        if len(self.buf) < self.n:
            self.buf += data[: self.n - len(self.buf)]


@bp.get("/files/<file_id>/analysis")
@login_required
def analysis(file_id: str):
    """Compares the three ciphertexts of one file (size, overhead, entropy,
    first bytes, HMAC validity) with the plaintext."""
    if not UUID_RE.match(file_id):
        return error(404, "file tidak ditemukan")
    rows = db.file_variants(g.user["id"], file_id)
    if not rows:
        return error(404, "file tidak ditemukan")
    keys = user_keys()
    try:
        name, name_ok = file_name(keys, rows[0]), True
    except AuthError:
        name, name_ok = "", False

    out = file_json(rows[0], name)
    if not name_ok:
        out["integrity_error"] = True
    out["plaintext"] = None
    out["variants"] = []

    for row in rows:
        alg = row["algorithm"]
        info = ALG_INFO[alg]
        va = {
            "algorithm": alg,
            "mode": info["mode"],
            "key_bits": info["key_bits"],
            "block_bits": info["block_bits"],
            "iv_hex": row["iv"].hex(),
            "mac_hex": row["mac"].hex(),
            "size_cipher": row["size_cipher"],
            "overhead_bytes": len(row["iv"]) + len(row["mac"]),
            "entropy": 0.0,
            "hex_preview": "",
            "mac_valid": False,
            "encrypt_ns": row["encrypt_ns"],
            "encrypt_total_ns": row["encrypt_total_ns"],
        }
        try:
            f = storage().open(row["storage_path"])
        except FileNotFoundError:
            out["variants"].append(va)  # reported as mac_valid=false
            continue
        with f:
            ent, head = Entropy(), _Head(PREVIEW_BYTES)

            def observe(chunk: bytes) -> None:
                ent.update(chunk)
                head.update(chunk)

            try:
                keys.verify(alg, row["iv"], row["mac"], row["id"].encode(), f, observe=observe)
                va["mac_valid"] = True
            except AuthError:
                va["mac_valid"] = False
            va["entropy"] = ent.bits()
            va["hex_preview"] = head.buf.hex()

            if va["mac_valid"] and out["plaintext"] is None:
                f.seek(0)
                pent, phead = Entropy(), _Head(PREVIEW_BYTES)
                for chunk in keys.decrypt_chunks(alg, row["iv"], f, Stats()):
                    pent.update(chunk)
                    phead.update(chunk)
                out["plaintext"] = {"entropy": pent.bits(), "hex_preview": phead.buf.hex()}
        out["variants"].append(va)
    return jsonify(out)
