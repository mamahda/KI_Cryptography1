"""Encrypted file variants on disk: <root>/<user_id>/<file_id>.<ALG>.enc.

Upload plaintext only ever exists as an anonymous temp file in <root>/.tmp
(already unlinked, so nothing is left behind even if the server crashes)."""

import os
import shutil
import tempfile


class Storage:
    def __init__(self, root: str):
        self.root = os.path.abspath(root)
        self.tmp = os.path.join(self.root, ".tmp")
        shutil.rmtree(self.tmp, ignore_errors=True)
        os.makedirs(self.tmp, mode=0o700, exist_ok=True)

    def temp_file(self):
        """Anonymous, seekable temp file for upload plaintext."""
        return tempfile.TemporaryFile(dir=self.tmp)

    @staticmethod
    def rel_path(user_id: int, file_id: str, algorithm: str) -> str:
        """The relative path stored in the database."""
        return f"{user_id}/{file_id}.{algorithm}.enc"

    def abs_path(self, rel: str) -> str:
        path = os.path.normpath(os.path.join(self.root, rel))
        if not path.startswith(self.root + os.sep):
            raise ValueError(f"invalid storage path {rel!r}")
        return path

    def create(self, rel: str):
        """Opens a new variant file for writing; fails if it already exists."""
        path = self.abs_path(rel)
        os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        return os.fdopen(fd, "wb")

    def open(self, rel: str):
        return open(self.abs_path(rel), "rb")

    def remove(self, rel: str) -> None:
        """Deletes a variant file; a missing file is not an error."""
        try:
            os.remove(self.abs_path(rel))
        except FileNotFoundError:
            pass
