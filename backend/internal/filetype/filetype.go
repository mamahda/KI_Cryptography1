// Package filetype validates uploads per category by extension, magic
// bytes and size.
package filetype

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"
)

type Category string

const (
	IDCard   Category = "id_card"
	Document Category = "document"
	Video    Category = "video"
)

const mb = 1 << 20

var maxSize = map[Category]int64{
	IDCard:   5 * mb,
	Document: 20 * mb,
	Video:    200 * mb,
}

// MaxUploadSize is the largest size any category accepts.
const MaxUploadSize = 200 * mb

type kind struct {
	mime  string
	magic func(head []byte) bool
	ooxml string // required zip entry prefix for docx/xlsx
}

var (
	jpeg = func(h []byte) bool { return bytes.HasPrefix(h, []byte{0xFF, 0xD8, 0xFF}) }
	png  = func(h []byte) bool { return bytes.HasPrefix(h, []byte("\x89PNG\r\n\x1a\n")) }
	pdf  = func(h []byte) bool { return bytes.HasPrefix(h, []byte("%PDF-")) }
	ole2 = func(h []byte) bool { return bytes.HasPrefix(h, []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}) }
	zipM = func(h []byte) bool { return bytes.HasPrefix(h, []byte("PK\x03\x04")) }
	mp4  = func(h []byte) bool { return len(h) >= 12 && string(h[4:8]) == "ftyp" }
	ebml = func(doctype string) func([]byte) bool {
		return func(h []byte) bool {
			return bytes.HasPrefix(h, []byte{0x1A, 0x45, 0xDF, 0xA3}) &&
				bytes.Contains(h[:min(len(h), 64)], []byte(doctype))
		}
	}
)

var rules = map[Category]map[string]kind{
	IDCard: {
		".jpg":  {mime: "image/jpeg", magic: jpeg},
		".jpeg": {mime: "image/jpeg", magic: jpeg},
		".png":  {mime: "image/png", magic: png},
	},
	Document: {
		".pdf":  {mime: "application/pdf", magic: pdf},
		".doc":  {mime: "application/msword", magic: ole2},
		".xls":  {mime: "application/vnd.ms-excel", magic: ole2},
		".docx": {mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", magic: zipM, ooxml: "word/"},
		".xlsx": {mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", magic: zipM, ooxml: "xl/"},
	},
	Video: {
		".mp4":  {mime: "video/mp4", magic: mp4},
		".webm": {mime: "video/webm", magic: ebml("webm")},
		".mkv":  {mime: "video/x-matroska", magic: ebml("matroska")},
	},
}

func ParseCategory(s string) (Category, error) {
	c := Category(strings.TrimSpace(s))
	if _, ok := rules[c]; !ok {
		return "", errors.New("kategori harus id_card, document, atau video")
	}
	return c, nil
}

func (c Category) MaxSize() int64 { return maxSize[c] }

// Extensions lists the accepted extensions, for error messages.
func (c Category) Extensions() []string {
	var out []string
	for _, ext := range []string{".jpg", ".jpeg", ".png", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".mp4", ".webm", ".mkv"} {
		if _, ok := rules[c][ext]; ok {
			out = append(out, strings.TrimPrefix(ext, "."))
		}
	}
	return out
}

// Detect checks that filename's extension is allowed for the category and
// that the file content (head = first bytes, path = full file for
// docx/xlsx) really is that type. It returns the canonical MIME type.
func Detect(c Category, filename string, head []byte, path string) (string, error) {
	ext := strings.ToLower(filepath.Ext(filename))
	k, ok := rules[c][ext]
	if !ok {
		return "", fmt.Errorf("format file tidak didukung untuk kategori ini (yang diterima: %s)",
			strings.Join(c.Extensions(), ", "))
	}
	if !k.magic(head) {
		return "", fmt.Errorf("isi file tidak sesuai dengan ekstensi %s", ext)
	}
	if k.ooxml != "" {
		if err := checkOOXML(path, k.ooxml); err != nil {
			return "", fmt.Errorf("isi file tidak sesuai dengan ekstensi %s", ext)
		}
	}
	return k.mime, nil
}

// checkOOXML opens the zip and looks for [Content_Types].xml plus the
// part folder of the expected Office application.
func checkOOXML(path, prefix string) error {
	r, err := zip.OpenReader(path)
	if err != nil {
		return err
	}
	defer r.Close()
	var types, part bool
	for _, f := range r.File {
		types = types || f.Name == "[Content_Types].xml"
		part = part || strings.HasPrefix(f.Name, prefix)
	}
	if !types || !part {
		return errors.New("not an Office Open XML file of the expected type")
	}
	return nil
}

// SanitizeFilename keeps only the base name, drops control characters and
// caps the length at 200 runes while preserving the extension.
func SanitizeFilename(name string) string {
	name = strings.ReplaceAll(name, "\\", "/")
	name = filepath.Base(name)
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || r == utf8.RuneError {
			return -1
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == ".." || name == "/" {
		return ""
	}
	const maxRunes = 200
	if utf8.RuneCountInString(name) > maxRunes {
		ext := filepath.Ext(name)
		if utf8.RuneCountInString(ext) > 10 {
			ext = ""
		}
		base := []rune(strings.TrimSuffix(name, ext))
		name = string(base[:maxRunes-utf8.RuneCountInString(ext)]) + ext
	}
	return name
}
