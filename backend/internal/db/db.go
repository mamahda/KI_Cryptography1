// Package db holds every SQL query the server runs against MySQL.
package db

import (
	"context"
	"database/sql"
	_ "embed"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

//go:embed schema.sql
var schema string

// ErrNotFound is returned when a row does not exist or is not owned by the
// requesting user. Callers cannot tell the two apart, by design.
var ErrNotFound = errors.New("db: not found")

// ErrDuplicate is returned when a unique key (e.g. username) already exists.
var ErrDuplicate = errors.New("db: duplicate")

type DB struct {
	*sql.DB
}

// Open connects to MySQL, retrying for up to a minute so the server can be
// started right after `docker compose up`. Sessions run in UTC so
// NOW() and the driver agree on timestamps.
func Open(ctx context.Context, dsn string) (*DB, error) {
	cfg, err := mysql.ParseDSN(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse DB_DSN: %w", err)
	}
	cfg.ParseTime = true
	cfg.Loc = time.UTC
	if cfg.Params == nil {
		cfg.Params = map[string]string{}
	}
	cfg.Params["time_zone"] = "'+00:00'"

	conn, err := mysql.NewConnector(cfg)
	if err != nil {
		return nil, err
	}
	sqlDB := sql.OpenDB(conn)
	sqlDB.SetMaxOpenConns(20)
	sqlDB.SetMaxIdleConns(10)
	sqlDB.SetConnMaxLifetime(5 * time.Minute)

	deadline := time.Now().Add(time.Minute)
	for {
		err = sqlDB.PingContext(ctx)
		if err == nil {
			return &DB{sqlDB}, nil
		}
		if time.Now().After(deadline) || ctx.Err() != nil {
			sqlDB.Close()
			return nil, fmt.Errorf("connect to MySQL: %w", err)
		}
		time.Sleep(2 * time.Second)
	}
}

// Migrate applies schema.sql. Comment lines are dropped before splitting on
// ";", and every statement is CREATE ... IF NOT EXISTS.
func (d *DB) Migrate(ctx context.Context) error {
	for _, stmt := range strings.Split(stripComments(schema), ";") {
		if strings.TrimSpace(stmt) == "" {
			continue
		}
		if _, err := d.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("migrate: %w\n%s", err, stmt)
		}
	}
	return nil
}

func stripComments(s string) string {
	var b strings.Builder
	for line := range strings.Lines(s) {
		if !strings.HasPrefix(strings.TrimSpace(line), "--") {
			b.WriteString(line)
		}
	}
	return b.String()
}

func isDuplicate(err error) bool {
	var me *mysql.MySQLError
	return errors.As(err, &me) && me.Number == 1062
}

// inTx runs fn in a transaction, committing on success.
func (d *DB) inTx(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}
