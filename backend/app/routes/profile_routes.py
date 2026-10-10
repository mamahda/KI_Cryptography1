"""Personal data (profile): stored as one JSON document encrypted three times.

The general fields follow UU PDP art. 4(3) / GDPR art. 4(1); blood type,
health notes and bank account are "specific" data under UU PDP art. 4(2) /
GDPR art. 9."""

import json
import re
from datetime import date

from flask import Blueprint, g, jsonify

from .. import db
from ..crypto import ALGORITHMS, AuthError, shannon_entropy
from .common import BadRequest, alg_param, error, integrity_error, login_required, parse_json, timing, user_keys

bp = Blueprint("profile", __name__)

FIELDS = (
    "full_name",
    "nik",
    "birth_place",
    "birth_date",
    "gender",
    "nationality",
    "religion",
    "marital_status",
    "address",
    "phone",
    "email",
    "blood_type",
    "health_notes",
    "bank_account",
)

GENDERS = ("Laki-laki", "Perempuan")
RELIGIONS = ("Islam", "Kristen", "Katolik", "Hindu", "Buddha", "Konghucu", "Lainnya")
MARITALS = ("Belum Kawin", "Kawin", "Cerai Hidup", "Cerai Mati")

NIK_RE = re.compile(r"^[0-9]{16}$")
PHONE_RE = re.compile(r"^\+?[0-9]{8,15}$")
BANK_RE = re.compile(r"^[0-9]{5,20}$")
BLOOD_RE = re.compile(r"^(A|B|AB|O)[+-]?$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

MAX_LEN = {
    "full_name": ("nama lengkap", 100),
    "birth_place": ("tempat lahir", 100),
    "nationality": ("kewarganegaraan", 50),
    "address": ("alamat", 300),
    "email": ("email", 254),
    "health_notes": ("catatan kesehatan", 500),
}


def normalize(data: dict) -> dict:
    p = {k: str(data.get(k) or "").strip() for k in FIELDS}
    for k in ("nik", "phone", "bank_account"):
        p[k] = re.sub(r"[\s.\-]", "", p[k])
    p["blood_type"] = p["blood_type"].upper()
    return p


def _one_of(name: str, value: str, allowed: tuple) -> None:
    if value and value not in allowed:
        raise BadRequest(f"{name} harus salah satu dari: {', '.join(allowed)}")


def validate(p: dict) -> None:
    for key, (name, limit) in MAX_LEN.items():
        if len(p[key]) > limit:
            raise BadRequest(f"{name} maksimal {limit} karakter")
    if not p["full_name"]:
        raise BadRequest("nama lengkap wajib diisi")
    if not NIK_RE.match(p["nik"]):
        raise BadRequest("NIK wajib 16 digit angka")
    if p["birth_date"]:
        try:
            d = date.fromisoformat(p["birth_date"])
        except ValueError:
            raise BadRequest("tanggal lahir harus berformat YYYY-MM-DD") from None
        if len(p["birth_date"]) != 10 or d.year < 1900 or d > date.today():
            raise BadRequest("tanggal lahir tidak masuk akal")
    _one_of("jenis kelamin", p["gender"], GENDERS)
    _one_of("agama", p["religion"], RELIGIONS)
    _one_of("status perkawinan", p["marital_status"], MARITALS)
    if p["phone"] and not PHONE_RE.match(p["phone"]):
        raise BadRequest("nomor HP harus 8–15 digit (boleh diawali +)")
    if p["email"] and not EMAIL_RE.match(p["email"]):
        raise BadRequest("format email tidak valid")
    if p["blood_type"] and not BLOOD_RE.match(p["blood_type"]):
        raise BadRequest("golongan darah harus A, B, AB, atau O (opsional + / -)")
    if p["bank_account"] and not BANK_RE.match(p["bank_account"]):
        raise BadRequest("nomor rekening harus 5–20 digit angka")


def profile_aad(user_id: int) -> bytes:
    """Binds a profile ciphertext to its owner, so one user's row cannot be
    copied over another's without failing the HMAC."""
    return f"profile:{user_id}".encode()


@bp.put("/profile")
@login_required
def save():
    data = parse_json(set(FIELDS))
    p = normalize(data)
    validate(p)
    plaintext = json.dumps(p, ensure_ascii=False).encode()
    keys = user_keys()
    records, timings = [], {}
    for alg in ALGORITHMS:
        sealed, ct = keys.seal(alg, plaintext, profile_aad(g.user["id"]))
        records.append(
            {"algorithm": alg, "iv": sealed.iv, "ciphertext": ct, "mac": sealed.mac, "encrypt_ns": sealed.stats.cipher_ns}
        )
        timings[alg] = timing(sealed)
    db.save_profile(g.user["id"], records)
    return jsonify(data=p, size=len(plaintext), encrypt=timings)


@bp.get("/profile")
@login_required
def get():
    alg = alg_param()
    rec = db.profile(g.user["id"], alg)
    if rec is None:
        return jsonify(algorithm=alg, data=None)
    try:
        plaintext, stats = user_keys().open(alg, rec["iv"], rec["ciphertext"], rec["mac"], profile_aad(g.user["id"]))
    except AuthError:
        return integrity_error("data profil")
    try:
        data = json.loads(plaintext)
    except ValueError:
        return error(500, "terjadi kesalahan di server")
    return jsonify(
        algorithm=alg,
        data={k: data.get(k, "") for k in FIELDS},
        decrypt_ns=stats.cipher_ns,
        decrypt_total_ns=stats.total_ns,
        encrypt_ns=rec["encrypt_ns"],
        size=len(rec["ciphertext"]),
        iv_hex=rec["iv"].hex(),
        mac_hex=rec["mac"].hex(),
        ciphertext_hex=rec["ciphertext"].hex(),
        ciphertext_entropy=shannon_entropy(rec["ciphertext"]),
        updated_at=db.iso(rec["updated_at"]),
    )
