package db

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

type File struct {
	ID        string
	UserID    int64
	Category  string
	MimeType  string
	SizePlain int64
	CreatedAt time.Time
}

type FileVariant struct {
	FileID         string
	Algorithm      string
	StoragePath    string
	IV             []byte
	MAC            []byte
	NameIV         []byte
	NameCiphertext []byte
	NameMAC        []byte
	SizeCipher     int64
	EncryptNs      int64
	EncryptTotalNs int64
}

// FileWithVariant is a file joined with one of its encrypted variants.
type FileWithVariant struct {
	File
	Variant FileVariant
}

func (d *DB) CreateFile(ctx context.Context, f File, variants []FileVariant) error {
	return d.inTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx,
			`INSERT INTO files (id, user_id, category, mime_type, size_plain) VALUES (?, ?, ?, ?, ?)`,
			f.ID, f.UserID, f.Category, f.MimeType, f.SizePlain)
		if err != nil {
			return err
		}
		for _, v := range variants {
			_, err := tx.ExecContext(ctx,
				`INSERT INTO file_variants (file_id, algorithm, storage_path, iv, mac,
				   name_iv, name_ciphertext, name_mac, size_cipher, encrypt_ns, encrypt_total_ns)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				f.ID, v.Algorithm, v.StoragePath, v.IV, v.MAC,
				v.NameIV, v.NameCiphertext, v.NameMAC, v.SizeCipher, v.EncryptNs, v.EncryptTotalNs)
			if err != nil {
				return err
			}
		}
		return nil
	})
}

const fileVariantColumns = `f.id, f.user_id, f.category, f.mime_type, f.size_plain, f.created_at,
	v.file_id, v.algorithm, v.storage_path, v.iv, v.mac, v.name_iv, v.name_ciphertext, v.name_mac,
	v.size_cipher, v.encrypt_ns, v.encrypt_total_ns`

func scanFileVariant(row interface{ Scan(...any) error }) (FileWithVariant, error) {
	var fv FileWithVariant
	f, v := &fv.File, &fv.Variant
	err := row.Scan(&f.ID, &f.UserID, &f.Category, &f.MimeType, &f.SizePlain, &f.CreatedAt,
		&v.FileID, &v.Algorithm, &v.StoragePath, &v.IV, &v.MAC, &v.NameIV, &v.NameCiphertext, &v.NameMAC,
		&v.SizeCipher, &v.EncryptNs, &v.EncryptTotalNs)
	return fv, err
}

// ListFiles returns the user's files joined with the variant for algorithm
// (used to decrypt the filename), newest first. category may be empty.
func (d *DB) ListFiles(ctx context.Context, userID int64, category, algorithm string) ([]FileWithVariant, error) {
	q := `SELECT ` + fileVariantColumns + `
		FROM files f JOIN file_variants v ON v.file_id = f.id AND v.algorithm = ?
		WHERE f.user_id = ?`
	args := []any{algorithm, userID}
	if category != "" {
		q += ` AND f.category = ?`
		args = append(args, category)
	}
	q += ` ORDER BY f.created_at DESC, f.id`

	rows, err := d.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FileWithVariant
	for rows.Next() {
		fv, err := scanFileVariant(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, fv)
	}
	return out, rows.Err()
}

// FileVariant returns one variant of a file owned by userID.
func (d *DB) FileVariant(ctx context.Context, userID int64, fileID, algorithm string) (FileWithVariant, error) {
	fv, err := scanFileVariant(d.QueryRowContext(ctx,
		`SELECT `+fileVariantColumns+`
		 FROM files f JOIN file_variants v ON v.file_id = f.id
		 WHERE f.id = ? AND f.user_id = ? AND v.algorithm = ?`, fileID, userID, algorithm))
	if errors.Is(err, sql.ErrNoRows) {
		return FileWithVariant{}, ErrNotFound
	}
	return fv, err
}

// FileVariants returns every variant of a file owned by userID, in
// AES, DES, RC4 order.
func (d *DB) FileVariants(ctx context.Context, userID int64, fileID string) ([]FileWithVariant, error) {
	rows, err := d.QueryContext(ctx,
		`SELECT `+fileVariantColumns+`
		 FROM files f JOIN file_variants v ON v.file_id = f.id
		 WHERE f.id = ? AND f.user_id = ? ORDER BY v.algorithm`, fileID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FileWithVariant
	for rows.Next() {
		fv, err := scanFileVariant(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, fv)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, ErrNotFound
	}
	return out, nil
}

// DeleteFile removes a file and its variants and returns the storage paths
// that should be removed from disk.
func (d *DB) DeleteFile(ctx context.Context, userID int64, fileID string) ([]string, error) {
	var paths []string
	err := d.inTx(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx,
			`SELECT v.storage_path FROM files f JOIN file_variants v ON v.file_id = f.id
			 WHERE f.id = ? AND f.user_id = ? FOR UPDATE`, fileID, userID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var p string
			if err := rows.Scan(&p); err != nil {
				rows.Close()
				return err
			}
			paths = append(paths, p)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, `DELETE FROM files WHERE id = ? AND user_id = ?`, fileID, userID)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		return nil
	})
	return paths, err
}

func (d *DB) FileOwned(ctx context.Context, userID int64, fileID string) (File, error) {
	var f File
	err := d.QueryRowContext(ctx,
		`SELECT id, user_id, category, mime_type, size_plain, created_at FROM files WHERE id = ? AND user_id = ?`,
		fileID, userID,
	).Scan(&f.ID, &f.UserID, &f.Category, &f.MimeType, &f.SizePlain, &f.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return File{}, ErrNotFound
	}
	return f, err
}
