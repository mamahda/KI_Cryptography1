import io
import zipfile

import pytest

from app.filetype import FileTypeError, detect, parse_category, sanitize_filename

JPG = b"\xff\xd8\xff\xe0\x00\x00"
PNG = b"\x89PNG\r\n\x1a\n...."
PDF = b"%PDF-1.7\n"
OLE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1\x00"
MP4 = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00"
WEBM = b"\x1a\x45\xdf\xa3\x9f\x42\x82\x84webm"
MKV = b"\x1a\x45\xdf\xa3\xa3\x42\x82\x88matroska"


def office_zip(*names: str) -> io.BytesIO:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for n in names:
            z.writestr(n, "x")
    buf.seek(0)
    return buf


@pytest.mark.parametrize(
    "category,name,head,mime",
    [
        ("id_card", "ktp.JPG", JPG, "image/jpeg"),
        ("id_card", "ktp.jpeg", JPG, "image/jpeg"),
        ("id_card", "ktp.png", PNG, "image/png"),
        ("document", "a.pdf", PDF, "application/pdf"),
        ("document", "a.doc", OLE, "application/msword"),
        ("document", "a.xls", OLE, "application/vnd.ms-excel"),
        ("video", "v.mp4", MP4, "video/mp4"),
        ("video", "v.webm", WEBM, "video/webm"),
        ("video", "v.mkv", MKV, "video/x-matroska"),
    ],
)
def test_detect_accepts(category, name, head, mime):
    assert detect(category, name, head, io.BytesIO(head)) == mime


def test_detect_office_open_xml():
    docx = office_zip("[Content_Types].xml", "word/document.xml")
    xlsx = office_zip("[Content_Types].xml", "xl/workbook.xml")
    assert detect("document", "a.docx", b"PK\x03\x04", docx).endswith("wordprocessingml.document")
    assert detect("document", "a.xlsx", b"PK\x03\x04", xlsx).endswith("spreadsheetml.sheet")


@pytest.mark.parametrize(
    "category,name,head,fileobj",
    [
        ("id_card", "ktp.pdf", PDF, None),  # wrong category
        ("id_card", "ktp.png", JPG, None),  # extension/content mismatch
        ("document", "evil.pdf", b"MZ\x90", None),  # exe renamed
        ("document", "a.docx", b"PK\x03\x04", office_zip("readme.txt")),
        ("document", "a.docx", b"PK\x03\x04", office_zip("[Content_Types].xml", "xl/workbook.xml")),
        ("video", "v.mkv", WEBM, None),
        ("video", "noext", MP4, None),
    ],
)
def test_detect_rejects(category, name, head, fileobj):
    with pytest.raises(FileTypeError):
        detect(category, name, head, fileobj or io.BytesIO(head))


def test_parse_category():
    for c in ("id_card", "document", "video"):
        assert parse_category(c) == c
    for bad in ("", "ktp", "ID_CARD"):
        with pytest.raises(FileTypeError):
            parse_category(bad)


@pytest.mark.parametrize(
    "raw,want",
    [
        ("ktp.jpg", "ktp.jpg"),
        ("../../etc/passwd", "passwd"),
        ("C:\\Users\\me\\ktp.png", "ktp.png"),
        ("a\x00b\r\n.pdf", "ab.pdf"),
        ("  spasi.pdf  ", "spasi.pdf"),
        ("", ""),
        ("..", ""),
        ("KTP Budi Santoso.jpeg", "KTP Budi Santoso.jpeg"),
        ("документ.pdf", "документ.pdf"),
        ("a" * 300 + ".pdf", "a" * 196 + ".pdf"),
    ],
)
def test_sanitize_filename(raw, want):
    assert sanitize_filename(raw) == want
