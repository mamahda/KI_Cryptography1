package db

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

type User struct {
	ID           int64
	Username     string
	PasswordHash string
}

func (d *DB) CreateUser(ctx context.Context, username, passwordHash string) (int64, error) {
	res, err := d.ExecContext(ctx,
		`INSERT INTO users (username, password_hash) VALUES (?, ?)`, username, passwordHash)
	if isDuplicate(err) {
		return 0, ErrDuplicate
	}
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (d *DB) UserByUsername(ctx context.Context, username string) (User, error) {
	var u User
	err := d.QueryRowContext(ctx,
		`SELECT id, username, password_hash FROM users WHERE username = ?`, username,
	).Scan(&u.ID, &u.Username, &u.PasswordHash)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return u, err
}

func (d *DB) CreateSession(ctx context.Context, tokenHash []byte, userID int64, ttl time.Duration) error {
	_, err := d.ExecContext(ctx,
		`INSERT INTO sessions (token_hash, user_id, expires_at)
		 VALUES (?, ?, DATE_ADD(NOW(6), INTERVAL ? SECOND))`,
		tokenHash, userID, int64(ttl.Seconds()))
	return err
}

// SessionUser returns the user owning an unexpired session.
func (d *DB) SessionUser(ctx context.Context, tokenHash []byte) (User, error) {
	var u User
	err := d.QueryRowContext(ctx,
		`SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
		 WHERE s.token_hash = ? AND s.expires_at > NOW(6)`, tokenHash,
	).Scan(&u.ID, &u.Username)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return u, err
}

func (d *DB) DeleteSession(ctx context.Context, tokenHash []byte) error {
	_, err := d.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = ?`, tokenHash)
	return err
}

func (d *DB) DeleteExpiredSessions(ctx context.Context) (int64, error) {
	res, err := d.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at <= NOW(6)`)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
