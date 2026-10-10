"""End-to-end API tests against a real MariaDB/MySQL.

Skipped unless VAULT_TEST=1. The database settings come from the usual
DB_* variables (or backend/.env), e.g.

    VAULT_TEST=1 pytest tests/test_api.py -v
"""

import hashlib
import io
import os
import time
import zipfile

import pytest

from app import create_app, db
from app.config import Config

pytestmark = pytest.mark.skipif(os.environ.get("VAULT_TEST") != "1", reason="set VAULT_TEST=1 to run API tests")

MARKER = b"PLAINTEXT-MARKER-7f3a"


@pytest.fixture(scope="module")
def app(tmp_path_factory):
    from dotenv import load_dotenv

    load_dotenv(".env", override=False)
    env = os.environ.get
    cfg = Config(
        db_host=env("DB_HOST", "127.0.0.1"),
        db_port=int(env("DB_PORT", "3306")),
        db_user=env("DB_USER", "vault"),
        db_password=env("DB_PASSWORD", "vault"),
        db_name=env("DB_NAME", "vault"),
        server_secret=os.urandom(32),
        storage_dir=str(tmp_path_factory.mktemp("storage")),
        host="127.0.0.1",
        port=0,
        cookie_secure=False,
        session_ttl=3600,
        static_dir=None,
    )
    app = create_app(cfg)
    app.config["TESTING"] = True
    return app


@pytest.fixture(scope="module")
def names():
    suffix = str(time.time_ns() % 10**9)
    return f"alice_{suffix}", f"bob_{suffix}"


@pytest.fixture(scope="module", autouse=True)
def cleanup(app, names):
    yield
    with app.app_context():
        conn = db.get_db()
        with conn.cursor() as cur:
            cur.execute("DELETE FROM users WHERE username IN (%s, %s)", names)


def rnd(n: int) -> bytes:
    return os.urandom(n)


def office_zip(part: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<xml>PLAINTEXT-MARKER-OFFICE</xml>")
        z.writestr(part, "<xml>PLAINTEXT-MARKER-OFFICE</xml>")
    return buf.getvalue()


def upload(client, category, filename, content):
    data = {}
    if category:
        data["category"] = category
    if filename:
        data["file"] = (io.BytesIO(content), filename)
    return client.post("/api/files", data=data, content_type="multipart/form-data")


def test_end_to_end(app, names):
    alice, bob, anon = app.test_client(), app.test_client(), app.test_client()
    alice_name, bob_name = names
    storage_root = app.extensions["vault_storage"].root

    # --- auth ---
    assert anon.get("/api/auth/me").status_code == 401
    r = anon.get("/api/auth/session")
    assert r.status_code == 200 and r.json["user"] is None
    assert alice.post("/api/auth/register", json={"username": "x", "password": "password123"}).status_code == 400
    assert alice.post("/api/auth/register", json={"username": alice_name, "password": "short"}).status_code == 400
    r = alice.post("/api/auth/register", json={"username": alice_name.upper(), "password": "password123"})
    assert r.status_code == 201, r.json
    assert r.json["username"] == alice_name, "username not normalized"
    assert bob.post("/api/auth/register", json={"username": alice_name, "password": "password123"}).status_code == 409
    assert bob.post("/api/auth/register", json={"username": bob_name, "password": "password456"}).status_code == 201
    assert anon.post("/api/auth/login", json={"username": alice_name, "password": "wrong-password"}).status_code == 401
    assert anon.post("/api/auth/login", json={"username": "nobody_x", "password": "password123"}).status_code == 401
    assert anon.post("/api/auth/login", json={"username": alice_name, "password": "password123"}).status_code == 200
    assert anon.get("/api/auth/session").json["user"]["username"] == alice_name
    assert anon.post("/api/auth/logout").status_code == 204
    assert anon.get("/api/auth/me").status_code == 401

    # --- profile ---
    r = alice.get("/api/profile?alg=AES")
    assert r.status_code == 200 and r.json["data"] is None
    assert alice.put("/api/profile", json={"full_name": "Budi", "nik": "123"}).status_code == 400
    assert alice.put("/api/profile", json={"full_name": "Budi", "unknown": "x"}).status_code == 400
    prof = {
        "full_name": "Budi Santoso " + MARKER.decode(),
        "nik": "3174 0123 4567 8901",
        "birth_place": "Jakarta",
        "birth_date": "2000-01-31",
        "gender": "Laki-laki",
        "nationality": "Indonesia",
        "religion": "Islam",
        "marital_status": "Belum Kawin",
        "address": "Jl. Merdeka No. 1",
        "phone": "+62 812-3456-7890",
        "email": "budi@example.com",
        "blood_type": "o+",
        "health_notes": "Alergi kacang",
        "bank_account": "1234-5678-90",
    }
    assert alice.put("/api/profile", json=prof).status_code == 200
    for alg in ("AES", "DES", "RC4", "aes"):
        r = alice.get(f"/api/profile?alg={alg}")
        assert r.status_code == 200
        d = r.json["data"]
        assert d["nik"] == "3174012345678901" and d["blood_type"] == "O+" and d["phone"] == "+6281234567890"
    assert alice.get("/api/profile?alg=ECB").status_code == 400
    assert bob.get("/api/profile?alg=AES").json["data"] is None

    with app.app_context():
        conn = db.get_db()
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE username = %s", (alice_name,))
            alice_id = cur.fetchone()["id"]
            cur.execute("SELECT ciphertext FROM profiles WHERE user_id = %s", (alice_id,))
            rows = cur.fetchall()
            assert len(rows) == 3
            for row in rows:
                assert b"3174012345678901" not in row["ciphertext"] and MARKER not in row["ciphertext"]
            # Tampering with one profile row is detected; the others still work.
            cur.execute(
                "UPDATE profiles SET ciphertext = CONCAT(ciphertext, 'x') WHERE user_id = %s AND algorithm = 'DES'",
                (alice_id,),
            )
    assert alice.get("/api/profile?alg=DES").status_code == 422
    assert alice.get("/api/profile?alg=RC4").status_code == 200
    assert alice.put("/api/profile", json=prof).status_code == 200

    # --- uploads ---
    pdf = b"%PDF-1.4\n" + (MARKER + b" ") * 2000 + rnd(100_000)
    ole = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
    files = [
        ("id_card", "KTP Budi.jpg", b"\xff\xd8\xff\xe0" + rnd(80_000), "image/jpeg"),
        ("id_card", "ktp.png", b"\x89PNG\r\n\x1a\n" + rnd(1000), "image/png"),
        ("document", "laporan.pdf", pdf, "application/pdf"),
        ("document", "surat.doc", ole + rnd(5000), "application/msword"),
        ("document", "surat.docx", office_zip("word/document.xml"),
         "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        ("document", "tabel.xls", ole + rnd(5000), "application/vnd.ms-excel"),
        ("document", "tabel.xlsx", office_zip("xl/workbook.xml"),
         "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        ("video", "video.mp4", b"\x00\x00\x00\x18ftypmp42" + rnd(3 * 1024 * 1024 + 7), "video/mp4"),
        ("video", "video.webm", b"\x1a\x45\xdf\xa3\x9f\x42\x82\x84webm" + rnd(10_000), "video/webm"),
    ]
    ids = {}
    for category, name, content, mime in files:
        r = upload(alice, category, name, content)
        assert r.status_code == 201, (name, r.json)
        f = r.json["file"]
        assert f["filename"] == name and f["mime_type"] == mime and f["size"] == len(content)
        assert set(r.json["encrypt"]) == {"AES", "DES", "RC4"}
        ids[name] = f["id"]

    rejects = [
        ("", "ktp.jpg", b"\xff\xd8\xff", 400),
        ("id_card", "", b"", 400),
        ("id_card", "ktp.jpg", b"", 400),
        ("id_card", "ktp.gif", b"GIF89a", 415),
        ("id_card", "ktp.png", b"\xff\xd8\xff\xe0", 415),
        ("document", "evil.pdf", b"MZ\x90\x00", 415),
        ("document", "a.docx", office_zip("xl/workbook.xml"), 415),
        ("id_card", "big.jpg", b"\xff\xd8\xff" + rnd(5 * 1024 * 1024), 413),
    ]
    for category, name, content, status in rejects:
        r = upload(alice, category, name, content)
        assert r.status_code == status, (category, name, r.status_code, r.json)

    # No plaintext on disk, no temp files left, exactly three .enc per upload.
    enc_count = 0
    for root, _dirs, fnames in os.walk(storage_root):
        for fn in fnames:
            path = os.path.join(root, fn)
            assert os.path.basename(root) != ".tmp", f"temp file left behind: {path}"
            data = open(path, "rb").read()
            assert MARKER not in data and b"PLAINTEXT-MARKER-OFFICE" not in data, path
            enc_count += 1
    assert enc_count == 3 * len(files)

    # --- list ---
    assert len(alice.get("/api/files?category=document").json["files"]) == 5
    assert len(alice.get("/api/files").json["files"]) == len(files)
    assert bob.get("/api/files").json["files"] == []

    # --- every file decrypts to the original under every algorithm ---
    for category, name, content, mime in files:
        for alg in ("AES", "DES", "RC4"):
            r = alice.get(f"/api/files/{ids[name]}/download?alg={alg}")
            assert r.status_code == 200, (name, alg)
            assert hashlib.sha256(r.data).digest() == hashlib.sha256(content).digest(), (name, alg)
            assert r.headers["Content-Type"] == mime
            assert "attachment" in r.headers["Content-Disposition"]

    pdf_id = ids["laporan.pdf"]
    # --- IDOR: bob cannot touch alice's file ---
    assert bob.get(f"/api/files/{pdf_id}/download?alg=AES").status_code == 404
    assert bob.get(f"/api/files/{pdf_id}/analysis").status_code == 404
    assert bob.post(f"/api/files/{pdf_id}/benchmark", json={"runs": 1}).status_code == 404
    assert bob.delete(f"/api/files/{pdf_id}").status_code == 404
    assert bob.post("/api/benchmarks", json={"file_id": pdf_id, "algorithm": "AES", "durations_ns": [1]}).status_code == 404
    assert anon.get(f"/api/files/{pdf_id}/download?alg=AES").status_code == 401
    assert alice.get("/api/files/not-a-uuid/download").status_code == 404

    # --- analysis ---
    r = alice.get(f"/api/files/{pdf_id}/analysis")
    assert r.status_code == 200
    an = r.json
    assert an["plaintext"]["hex_preview"].startswith("255044462d")  # "%PDF-"
    assert len(an["variants"]) == 3
    for v in an["variants"]:
        assert v["mac_valid"] and v["size_cipher"] == len(pdf) and v["entropy"] > 7.9
        assert len(v["hex_preview"]) == 2 * 256
    assert an["variants"][0]["hex_preview"] != an["variants"][1]["hex_preview"]

    # --- benchmark ---
    assert alice.post(f"/api/files/{pdf_id}/benchmark", json={"runs": 51}).status_code == 400
    r = alice.post(f"/api/files/{pdf_id}/benchmark", json={"runs": 3})
    assert r.status_code == 200
    assert len(r.json["results"]) == 3
    for res in r.json["results"]:
        assert len(res["cipher_ns"]) == 3 and res["cipher"]["mean_ns"] > 0 and res["throughput_mbps"] > 0
    r = alice.post("/api/benchmarks", json={"file_id": pdf_id, "algorithm": "RC4", "durations_ns": [1000, 2000]})
    assert r.status_code == 201
    r = alice.post("/api/benchmarks", json={"file_id": pdf_id, "algorithm": "RC4", "durations_ns": [-5]})
    assert r.status_code == 400
    assert len(alice.get("/api/benchmarks").json["summary"]) > 0
    assert alice.get("/api/benchmarks/raw").status_code == 200

    # --- tampering with one ciphertext file is caught before any byte is sent ---
    mp4_id = ids["video.mp4"]
    with app.app_context():
        with db.get_db().cursor() as cur:
            cur.execute("SELECT storage_path FROM file_variants WHERE file_id = %s AND algorithm = 'DES'", (mp4_id,))
            des_path = os.path.join(storage_root, cur.fetchone()["storage_path"])
    data = bytearray(open(des_path, "rb").read())
    data[len(data) // 2] ^= 0x01
    open(des_path, "wb").write(bytes(data))
    assert alice.get(f"/api/files/{mp4_id}/download?alg=DES").status_code == 422
    assert alice.get(f"/api/files/{mp4_id}/download?alg=AES").status_code == 200
    for v in alice.get(f"/api/files/{mp4_id}/analysis").json["variants"]:
        assert v["mac_valid"] == (v["algorithm"] != "DES")

    # --- delete removes rows and all three files ---
    with app.app_context():
        with db.get_db().cursor() as cur:
            cur.execute("SELECT storage_path FROM file_variants WHERE file_id = %s", (pdf_id,))
            paths = [os.path.join(storage_root, row["storage_path"]) for row in cur.fetchall()]
    assert alice.delete(f"/api/files/{pdf_id}").status_code == 204
    assert not any(os.path.exists(p) for p in paths)
    assert alice.get(f"/api/files/{pdf_id}/download?alg=AES").status_code == 404
    assert alice.delete(f"/api/files/{pdf_id}").status_code == 404

    assert alice.delete("/api/benchmarks").status_code == 204
