// Package storage keeps encrypted file variants on disk under
// <root>/<user_id>/<file_id>.<alg>.enc. Plaintext only ever exists in
// <root>/.tmp while an upload is being encrypted.
package storage

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

type Store struct {
	root string
	tmp  string
}

// New creates the storage root and empties its temp directory, removing
// plaintext left behind by a crashed upload.
func New(root string) (*Store, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	s := &Store{root: abs, tmp: filepath.Join(abs, ".tmp")}
	if err := os.RemoveAll(s.tmp); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(s.tmp, 0o700); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) Root() string { return s.root }

// TempFile creates a plaintext staging file. Callers must remove it.
func (s *Store) TempFile() (*os.File, error) {
	return os.CreateTemp(s.tmp, "upload-*")
}

// Path returns the relative path stored in the database for a variant.
func Path(userID int64, fileID, algorithm string) string {
	return filepath.Join(fmt.Sprint(userID), fileID+"."+algorithm+".enc")
}

func (s *Store) abs(rel string) (string, error) {
	if !filepath.IsLocal(rel) {
		return "", fmt.Errorf("storage: invalid path %q", rel)
	}
	return filepath.Join(s.root, rel), nil
}

// Create opens a new variant file for writing; it fails if it exists.
func (s *Store) Create(rel string) (*os.File, error) {
	p, err := s.abs(rel)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return nil, err
	}
	return os.OpenFile(p, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
}

func (s *Store) Open(rel string) (*os.File, error) {
	p, err := s.abs(rel)
	if err != nil {
		return nil, err
	}
	return os.Open(p)
}

// Remove deletes a variant file; a missing file is not an error.
func (s *Store) Remove(rel string) error {
	p, err := s.abs(rel)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}
