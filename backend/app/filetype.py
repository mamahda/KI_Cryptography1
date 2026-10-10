"""Upload validation per category: extension, magic bytes and size."""

import os
import unicodedata
import zipfile
from dataclasses import dataclass
from typing import BinaryIO, Callable

MB = 1024 * 1024
MAX_SIZE = {"id_card": 5 * MB, "document": 20 * MB, "video": 200 * MB}
MAX_UPLOAD_SIZE = 200 * MB  # largest size any category accepts
CATEGORIES = tuple(MAX_SIZE)


def _jpeg(h: bytes) -> bool:
    return h.startswith(b"\xff\xd8\xff")


def _png(h: bytes) -> bool:
    return h.startswith(b"\x89PNG\r\n\x1a\n")


def _pdf(h: bytes) -> bool:
    return h.startswith(b"%PDF-")


def _ole2(h: bytes) -> bool:
    """Old Office files (.doc, .xls) are OLE2 compound documents."""
    return h.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")


def _zip(h: bytes) -> bool:
    """New Office files (.docx, .xlsx) are zip archives."""
    return h.startswith(b"PK\x03\x04")


def _mp4(h: bytes) -> bool:
    return len(h) >= 12 and h[4:8] == b"ftyp"


def _ebml(doctype: bytes) -> Callable[[bytes], bool]:
    """WebM and MKV share the EBML header and differ in the doctype string."""
    return lambda h: h.startswith(b"\x1a\x45\xdf\xa3") and doctype in h[:64]


@dataclass(frozen=True)
class Kind:
    mime: str
    magic: Callable[[bytes], bool]
    ooxml: str = ""  # required zip entry prefix for docx/xlsx


RULES: dict[str, dict[str, Kind]] = {
    "id_card": {
        ".jpg": Kind("image/jpeg", _jpeg),
        ".jpeg": Kind("image/jpeg", _jpeg),
        ".png": Kind("image/png", _png),
    },
    "document": {
        ".pdf": Kind("application/pdf", _pdf),
        ".doc": Kind("application/msword", _ole2),
        ".xls": Kind("application/vnd.ms-excel", _ole2),
        ".docx": Kind("application/vnd.openxmlformats-officedocument.wordprocessingml.document", _zip, "word/"),
        ".xlsx": Kind("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", _zip, "xl/"),
    },
    "video": {
        ".mp4": Kind("video/mp4", _mp4),
        ".webm": Kind("video/webm", _ebml(b"webm")),
        ".mkv": Kind("video/x-matroska", _ebml(b"matroska")),
    },
}


class FileTypeError(Exception):
    pass


def parse_category(value: str) -> str:
    c = (value or "").strip()
    if c not in RULES:
        raise FileTypeError("kategori harus id_card, document, atau video")
    return c


def extensions(category: str) -> list[str]:
    return [ext.lstrip(".") for ext in RULES[category]]


def detect(category: str, filename: str, head: bytes, fileobj: BinaryIO) -> str:
    """Checks the extension is allowed for the category and that the
    content really is that type. Returns the canonical MIME type."""
    ext = os.path.splitext(filename)[1].lower()
    kind = RULES[category].get(ext)
    if kind is None:
        raise FileTypeError(
            f"format file tidak didukung untuk kategori ini (yang diterima: {', '.join(extensions(category))})"
        )
    if not kind.magic(head):
        raise FileTypeError(f"isi file tidak sesuai dengan ekstensi {ext}")
    if kind.ooxml and not _is_ooxml(fileobj, kind.ooxml):
        raise FileTypeError(f"isi file tidak sesuai dengan ekstensi {ext}")
    return kind.mime


def _is_ooxml(fileobj: BinaryIO, prefix: str) -> bool:
    """A real docx/xlsx is a zip with [Content_Types].xml plus the part
    folder of the expected Office application."""
    try:
        fileobj.seek(0)
        with zipfile.ZipFile(fileobj) as z:
            names = z.namelist()
    except (zipfile.BadZipFile, OSError):
        return False
    finally:
        fileobj.seek(0)
    return "[Content_Types].xml" in names and any(n.startswith(prefix) for n in names)


def sanitize_filename(name: str) -> str:
    """Keeps only the base name, drops control characters and caps the
    length at 200 characters while preserving the extension."""
    name = (name or "").replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(ch for ch in name if unicodedata.category(ch) != "Cc").strip()
    if name in ("", ".", ".."):
        return ""
    max_len = 200
    if len(name) > max_len:
        base, ext = os.path.splitext(name)
        if len(ext) > 10:
            base, ext = name, ""
        name = base[: max_len - len(ext)] + ext
    return name
