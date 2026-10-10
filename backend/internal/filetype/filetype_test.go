package filetype

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeZip(t *testing.T, names ...string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "f.zip")
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	w := zip.NewWriter(f)
	for _, n := range names {
		fw, _ := w.Create(n)
		fw.Write([]byte("x"))
	}
	w.Close()
	f.Close()
	return p
}

func TestDetect(t *testing.T) {
	jpg := []byte{0xFF, 0xD8, 0xFF, 0xE0, 0, 0}
	pngH := []byte("\x89PNG\r\n\x1a\n....")
	pdfH := []byte("%PDF-1.7\n")
	ole := []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0}
	mp4H := []byte("\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00")
	webm := append([]byte{0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x82, 0x84}, []byte("webm")...)
	mkv := append([]byte{0x1A, 0x45, 0xDF, 0xA3, 0xA3, 0x42, 0x82, 0x88}, []byte("matroska")...)
	docx := writeZip(t, "[Content_Types].xml", "word/document.xml")
	xlsx := writeZip(t, "[Content_Types].xml", "xl/workbook.xml")
	plainZip := writeZip(t, "readme.txt")

	ok := []struct {
		c    Category
		name string
		head []byte
		path string
		mime string
	}{
		{IDCard, "ktp.JPG", jpg, "", "image/jpeg"},
		{IDCard, "ktp.jpeg", jpg, "", "image/jpeg"},
		{IDCard, "ktp.png", pngH, "", "image/png"},
		{Document, "a.pdf", pdfH, "", "application/pdf"},
		{Document, "a.doc", ole, "", "application/msword"},
		{Document, "a.xls", ole, "", "application/vnd.ms-excel"},
		{Document, "a.docx", []byte("PK\x03\x04"), docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
		{Document, "a.xlsx", []byte("PK\x03\x04"), xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
		{Video, "v.mp4", mp4H, "", "video/mp4"},
		{Video, "v.webm", webm, "", "video/webm"},
		{Video, "v.mkv", mkv, "", "video/x-matroska"},
	}
	for _, tc := range ok {
		mime, err := Detect(tc.c, tc.name, tc.head, tc.path)
		if err != nil || mime != tc.mime {
			t.Errorf("Detect(%s, %s) = %q, %v; want %q", tc.c, tc.name, mime, err, tc.mime)
		}
	}

	bad := []struct {
		c    Category
		name string
		head []byte
		path string
	}{
		{IDCard, "ktp.pdf", pdfH, ""},                // wrong category
		{IDCard, "ktp.png", jpg, ""},                 // extension/content mismatch
		{Document, "evil.pdf", []byte("MZ\x90"), ""}, // exe renamed
		{Document, "a.docx", []byte("PK\x03\x04"), plainZip},
		{Document, "a.docx", []byte("PK\x03\x04"), xlsx}, // xlsx renamed to docx
		{Video, "v.mkv", webm, ""},
		{Video, "noext", mp4H, ""},
	}
	for _, tc := range bad {
		if _, err := Detect(tc.c, tc.name, tc.head, tc.path); err == nil {
			t.Errorf("Detect(%s, %s) accepted", tc.c, tc.name)
		}
	}
}

func TestParseCategory(t *testing.T) {
	for _, s := range []string{"id_card", "document", "video"} {
		if _, err := ParseCategory(s); err != nil {
			t.Errorf("%s rejected", s)
		}
	}
	for _, s := range []string{"", "ktp", "ID_CARD"} {
		if _, err := ParseCategory(s); err == nil {
			t.Errorf("%q accepted", s)
		}
	}
}

func TestSanitizeFilename(t *testing.T) {
	cases := map[string]string{
		"ktp.jpg":                         "ktp.jpg",
		"../../etc/passwd":                "passwd",
		`C:\Users\me\ktp.png`:             "ktp.png",
		"a\x00b\r\n.pdf":                  "ab.pdf",
		"  spasi.pdf  ":                   "spasi.pdf",
		"":                                "",
		"..":                              "",
		"KTP Budi Santoso.jpeg":           "KTP Budi Santoso.jpeg",
		"документ.pdf":                    "документ.pdf",
		strings.Repeat("a", 300) + ".pdf": strings.Repeat("a", 196) + ".pdf",
	}
	for in, want := range cases {
		if got := SanitizeFilename(in); got != want {
			t.Errorf("SanitizeFilename(%q) = %q, want %q", in, got, want)
		}
	}
}
