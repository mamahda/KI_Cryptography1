package db

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

type ProfileRecord struct {
	Algorithm  string
	IV         []byte
	Ciphertext []byte
	MAC        []byte
	EncryptNs  int64
	UpdatedAt  time.Time
}

// SaveProfile replaces all encrypted versions of a user's profile at once.
func (d *DB) SaveProfile(ctx context.Context, userID int64, recs []ProfileRecord) error {
	return d.inTx(ctx, func(tx *sql.Tx) error {
		for _, r := range recs {
			_, err := tx.ExecContext(ctx,
				`INSERT INTO profiles (user_id, algorithm, iv, ciphertext, mac, encrypt_ns)
				 VALUES (?, ?, ?, ?, ?, ?)
				 ON DUPLICATE KEY UPDATE iv = VALUES(iv), ciphertext = VALUES(ciphertext),
				   mac = VALUES(mac), encrypt_ns = VALUES(encrypt_ns), updated_at = CURRENT_TIMESTAMP(6)`,
				userID, r.Algorithm, r.IV, r.Ciphertext, r.MAC, r.EncryptNs)
			if err != nil {
				return err
			}
		}
		return nil
	})
}

func (d *DB) Profile(ctx context.Context, userID int64, algorithm string) (ProfileRecord, error) {
	var r ProfileRecord
	err := d.QueryRowContext(ctx,
		`SELECT algorithm, iv, ciphertext, mac, encrypt_ns, updated_at
		 FROM profiles WHERE user_id = ? AND algorithm = ?`, userID, algorithm,
	).Scan(&r.Algorithm, &r.IV, &r.Ciphertext, &r.MAC, &r.EncryptNs, &r.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ProfileRecord{}, ErrNotFound
	}
	return r, err
}
