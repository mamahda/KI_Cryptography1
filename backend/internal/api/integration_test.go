package api

// End-to-end tests against a real MySQL/MariaDB. They are skipped unless
// VAULT_TEST_DSN is set, e.g.
//
//	VAULT_TEST_DSN='vault:vault@tcp(127.0.0.1:3307)/vault' go test ./internal/api -v

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"vault/internal/config"
	"vault/internal/db"
	"vault/internal/storage"
)

type env struct {
	t     *testing.T
	srv   *httptest.Server
	db    *db.DB
	store *storage.Store
}

func newEnv(t *testing.T) *env {
	t.Helper()
	dsn := os.Getenv("VAULT_TEST_DSN")
	if dsn == "" {
		t.Skip("VAULT_TEST_DSN not set")
	}
	ctx := context.Background()
	database, err := db.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	if err := database.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	store, err := storage.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	secret := make([]byte, 32)
	rand.Read(secret)
	cfg := config.Config{ServerSecret: secret, SessionTTL: time.Hour}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv := httptest.NewServer(New(cfg, database, store, log).Handler())
	t.Cleanup(srv.Close)
	return &env{t: t, srv: srv, db: database, store: store}
}

type client struct {
	e  *env
	hc *http.Client
}

func (e *env) client() *client {
	jar, _ := cookiejar.New(nil)
	return &client{e: e, hc: &http.Client{Jar: jar}}
}

func (c *client) do(method, path string, body any) (int, []byte) {
	c.e.t.Helper()
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, c.e.srv.URL+path, r)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		c.e.t.Fatal(err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, out
}

func (c *client) upload(category, filename string, content []byte) (int, []byte) {
	c.e.t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	if category != "" {
		mw.WriteField("category", category)
	}
	if filename != "" {
		fw, _ := mw.CreateFormFile("file", filename)
		fw.Write(content)
	}
	mw.Close()
	req, _ := http.NewRequest("POST", c.e.srv.URL+"/api/files", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	resp, err := c.hc.Do(req)
	if err != nil {
		c.e.t.Fatal(err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, out
}

func expect(t *testing.T, what string, got, want int, body []byte) {
	t.Helper()
	if got != want {
		t.Fatalf("%s: status %d, want %d: %s", what, got, want, body)
	}
}

func decode[T any](t *testing.T, b []byte) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatalf("decode %s: %v", b, err)
	}
	return v
}

func rnd(n int) []byte {
	b := make([]byte, n)
	rand.Read(b)
	return b
}

func cat(parts ...[]byte) []byte { return bytes.Join(parts, nil) }

func officeZip(part string) []byte {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for _, name := range []string{"[Content_Types].xml", part} {
		f, _ := w.Create(name)
		f.Write([]byte("<xml>PLAINTEXT-MARKER-OFFICE</xml>"))
	}
	w.Close()
	return buf.Bytes()
}

const marker = "PLAINTEXT-MARKER-7f3a"

func TestIntegration(t *testing.T) {
	e := newEnv(t)
	alice, bob, anon := e.client(), e.client(), e.client()
	suffix := fmt.Sprint(time.Now().UnixNano() % 1e9)
	aliceName, bobName := "alice_"+suffix, "bob_"+suffix

	// --- auth ---
	st, b := anon.do("GET", "/api/auth/me", nil)
	expect(t, "me without session", st, 401, b)
	st, b = alice.do("POST", "/api/auth/register", credentials{"x", "password123"})
	expect(t, "short username", st, 400, b)
	st, b = alice.do("POST", "/api/auth/register", credentials{aliceName, "short"})
	expect(t, "short password", st, 400, b)
	st, b = alice.do("POST", "/api/auth/register", credentials{strings.ToUpper(aliceName), "password123"})
	expect(t, "register alice", st, 201, b)
	if u := decode[userJSON](t, b); u.Username != aliceName {
		t.Fatalf("username not normalized: %q", u.Username)
	}
	st, b = bob.do("POST", "/api/auth/register", credentials{aliceName, "password123"})
	expect(t, "duplicate username", st, 409, b)
	st, b = bob.do("POST", "/api/auth/register", credentials{bobName, "password456"})
	expect(t, "register bob", st, 201, b)
	st, b = anon.do("POST", "/api/auth/login", credentials{aliceName, "wrong-password"})
	expect(t, "wrong password", st, 401, b)
	st, b = anon.do("POST", "/api/auth/login", credentials{"nobody_" + suffix, "password123"})
	expect(t, "unknown user", st, 401, b)
	st, b = anon.do("POST", "/api/auth/login", credentials{aliceName, "password123"})
	expect(t, "login", st, 200, b)
	st, b = anon.do("POST", "/api/auth/logout", nil)
	expect(t, "logout", st, 204, b)
	st, b = anon.do("GET", "/api/auth/me", nil)
	expect(t, "me after logout", st, 401, b)

	// --- profile ---
	st, b = alice.do("GET", "/api/profile?alg=AES", nil)
	expect(t, "empty profile", st, 200, b)
	if p := decode[profileResponse](t, b); p.Data != nil {
		t.Fatal("expected no profile yet")
	}
	bad := Profile{FullName: "Budi", NIK: "123"}
	st, b = alice.do("PUT", "/api/profile", bad)
	expect(t, "invalid NIK", st, 400, b)
	st, b = alice.do("PUT", "/api/profile", map[string]string{"full_name": "Budi", "unknown": "x"})
	expect(t, "unknown field", st, 400, b)
	prof := Profile{
		FullName: "Budi Santoso " + marker, NIK: "3174 0123 4567 8901", BirthPlace: "Jakarta", BirthDate: "2000-01-31",
		Gender: "Laki-laki", Nationality: "Indonesia", Religion: "Islam", MaritalStatus: "Belum Kawin",
		Address: "Jl. Merdeka No. 1", Phone: "+62 812-3456-7890", Email: "budi@example.com",
		BloodType: "o+", HealthNotes: "Alergi kacang", BankAccount: "1234-5678-90",
	}
	st, b = alice.do("PUT", "/api/profile", prof)
	expect(t, "save profile", st, 200, b)
	for _, alg := range []string{"AES", "DES", "RC4", "aes"} {
		st, b = alice.do("GET", "/api/profile?alg="+alg, nil)
		expect(t, "get profile "+alg, st, 200, b)
		p := decode[profileResponse](t, b)
		if p.Data == nil || p.Data.NIK != "3174012345678901" || p.Data.BloodType != "O+" || p.Data.Phone != "+6281234567890" {
			t.Fatalf("%s: wrong profile %+v", alg, p.Data)
		}
	}
	st, b = alice.do("GET", "/api/profile?alg=ECB", nil)
	expect(t, "bad alg", st, 400, b)
	st, b = bob.do("GET", "/api/profile?alg=AES", nil)
	if p := decode[profileResponse](t, b); p.Data != nil {
		t.Fatal("bob sees alice's profile")
	}

	// Plaintext must not be in the database.
	var aliceID int64
	e.db.QueryRow(`SELECT id FROM users WHERE username = ?`, aliceName).Scan(&aliceID)
	rows, err := e.db.Query(`SELECT ciphertext FROM profiles WHERE user_id = ?`, aliceID)
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for rows.Next() {
		var ct []byte
		rows.Scan(&ct)
		if bytes.Contains(ct, []byte("3174012345678901")) || bytes.Contains(ct, []byte(marker)) {
			t.Fatal("profile plaintext found in database")
		}
		n++
	}
	rows.Close()
	if n != 3 {
		t.Fatalf("%d profile rows, want 3", n)
	}

	// Tampering with one profile row is detected; others still work.
	e.db.Exec(`UPDATE profiles SET ciphertext = CONCAT(ciphertext, 'x') WHERE user_id = ? AND algorithm = 'DES'`, aliceID)
	st, b = alice.do("GET", "/api/profile?alg=DES", nil)
	expect(t, "tampered profile", st, 422, b)
	st, b = alice.do("GET", "/api/profile?alg=RC4", nil)
	expect(t, "untampered profile", st, 200, b)
	st, b = alice.do("PUT", "/api/profile", prof)
	expect(t, "re-save profile", st, 200, b)

	// --- uploads ---
	pdf := cat([]byte("%PDF-1.4\n"), bytes.Repeat([]byte(marker+" "), 2000), rnd(100_000))
	files := []struct {
		category, name string
		content        []byte
		mime           string
	}{
		{"id_card", "KTP Budi.jpg", cat([]byte{0xFF, 0xD8, 0xFF, 0xE0}, rnd(80_000)), "image/jpeg"},
		{"id_card", "ktp.png", cat([]byte("\x89PNG\r\n\x1a\n"), rnd(1000)), "image/png"},
		{"document", "laporan.pdf", pdf, "application/pdf"},
		{"document", "surat.doc", cat([]byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}, rnd(5000)), "application/msword"},
		{"document", "surat.docx", officeZip("word/document.xml"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
		{"document", "tabel.xls", cat([]byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}, rnd(5000)), "application/vnd.ms-excel"},
		{"document", "tabel.xlsx", officeZip("xl/workbook.xml"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
		{"video", "video.mp4", cat([]byte("\x00\x00\x00\x18ftypmp42"), rnd(3<<20+7)), "video/mp4"},
		{"video", "video.webm", cat([]byte{0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x82, 0x84}, []byte("webm"), rnd(10_000)), "video/webm"},
	}
	ids := map[string]string{}
	for _, f := range files {
		st, b := alice.upload(f.category, f.name, f.content)
		expect(t, "upload "+f.name, st, 201, b)
		res := decode[struct {
			File    fileJSON          `json:"file"`
			Encrypt map[string]timing `json:"encrypt"`
		}](t, b)
		if res.File.Filename != f.name || res.File.MimeType != f.mime || res.File.Size != int64(len(f.content)) || len(res.Encrypt) != 3 {
			t.Fatalf("upload %s: %+v", f.name, res)
		}
		ids[f.name] = res.File.ID
	}

	// Rejected uploads.
	rejects := []struct {
		category, name string
		content        []byte
		status         int
	}{
		{"", "ktp.jpg", []byte{0xFF, 0xD8, 0xFF}, 400},
		{"id_card", "", nil, 400},
		{"id_card", "ktp.jpg", []byte{}, 400},
		{"id_card", "ktp.gif", []byte("GIF89a"), 415},
		{"id_card", "ktp.png", []byte{0xFF, 0xD8, 0xFF, 0xE0}, 415},
		{"document", "evil.pdf", []byte("MZ\x90\x00"), 415},
		{"document", "a.docx", officeZip("xl/workbook.xml"), 415},
		{"id_card", "big.jpg", cat([]byte{0xFF, 0xD8, 0xFF}, rnd(5<<20)), 413},
	}
	for _, r := range rejects {
		st, b := alice.upload(r.category, r.name, r.content)
		expect(t, fmt.Sprintf("reject %s/%s", r.category, r.name), st, r.status, b)
	}

	// No plaintext on disk, and exactly three .enc files per upload.
	encCount := 0
	filepath.WalkDir(e.store.Root(), func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		if filepath.Dir(p) == filepath.Join(e.store.Root(), ".tmp") {
			t.Errorf("temp file left behind: %s", p)
		}
		data, _ := os.ReadFile(p)
		if bytes.Contains(data, []byte(marker)) || bytes.Contains(data, []byte("PLAINTEXT-MARKER-OFFICE")) {
			t.Errorf("plaintext marker found in %s", p)
		}
		encCount++
		return nil
	})
	if encCount != 3*len(files) {
		t.Fatalf("%d files in storage, want %d", encCount, 3*len(files))
	}

	// List.
	st, b = alice.do("GET", "/api/files?category=document", nil)
	expect(t, "list documents", st, 200, b)
	if l := decode[struct{ Files []fileJSON }](t, b); len(l.Files) != 5 {
		t.Fatalf("%d documents, want 5", len(l.Files))
	}
	st, b = alice.do("GET", "/api/files", nil)
	if l := decode[struct{ Files []fileJSON }](t, b); len(l.Files) != len(files) {
		t.Fatalf("%d files, want %d", len(l.Files), len(files))
	}
	st, b = bob.do("GET", "/api/files", nil)
	if l := decode[struct{ Files []fileJSON }](t, b); len(l.Files) != 0 {
		t.Fatal("bob sees alice's files")
	}

	// Every file decrypts to the original under every algorithm.
	for _, f := range files {
		want := sha256.Sum256(f.content)
		for _, alg := range []string{"AES", "DES", "RC4"} {
			req, _ := http.NewRequest("GET", e.srv.URL+"/api/files/"+ids[f.name]+"/download?alg="+alg, nil)
			resp, err := alice.hc.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			if resp.StatusCode != 200 {
				t.Fatalf("download %s/%s: %d %s", f.name, alg, resp.StatusCode, body)
			}
			if sha256.Sum256(body) != want {
				t.Fatalf("download %s/%s: content mismatch", f.name, alg)
			}
			if ct := resp.Header.Get("Content-Type"); ct != f.mime {
				t.Errorf("download %s/%s: Content-Type %q", f.name, alg, ct)
			}
			if cd := resp.Header.Get("Content-Disposition"); !strings.Contains(cd, "attachment") {
				t.Errorf("download %s/%s: Content-Disposition %q", f.name, alg, cd)
			}
		}
	}

	pdfID := ids["laporan.pdf"]
	// IDOR: bob cannot touch alice's file.
	for _, req := range []struct{ method, path string }{
		{"GET", "/api/files/" + pdfID + "/download?alg=AES"},
		{"GET", "/api/files/" + pdfID + "/analysis"},
		{"POST", "/api/files/" + pdfID + "/benchmark"},
		{"DELETE", "/api/files/" + pdfID},
	} {
		var body any
		if req.method == "POST" {
			body = map[string]int{"runs": 1}
		}
		st, b := bob.do(req.method, req.path, body)
		expect(t, "bob "+req.method+" "+req.path, st, 404, b)
	}
	st, b = bob.do("POST", "/api/benchmarks", map[string]any{"file_id": pdfID, "algorithm": "AES", "durations_ns": []int64{1}})
	expect(t, "bob records benchmark on alice's file", st, 404, b)
	st, b = anon.do("GET", "/api/files/"+pdfID+"/download?alg=AES", nil)
	expect(t, "anonymous download", st, 401, b)
	st, b = alice.do("GET", "/api/files/not-a-uuid/download", nil)
	expect(t, "bad id", st, 404, b)

	// Analysis.
	st, b = alice.do("GET", "/api/files/"+pdfID+"/analysis", nil)
	expect(t, "analysis", st, 200, b)
	an := decode[struct {
		Plaintext *struct {
			Entropy    float64 `json:"entropy"`
			HexPreview string  `json:"hex_preview"`
		} `json:"plaintext"`
		Variants []variantAnalysis `json:"variants"`
	}](t, b)
	if an.Plaintext == nil || !strings.HasPrefix(an.Plaintext.HexPreview, "255044462d") || len(an.Variants) != 3 {
		t.Fatalf("analysis: %s", b)
	}
	for _, v := range an.Variants {
		if !v.MACValid || v.SizeCipher != int64(len(pdf)) || v.Entropy < 7.9 || len(v.HexPreview) != 2*previewBytes {
			t.Fatalf("analysis variant: %+v", v)
		}
	}
	if an.Variants[0].HexPreview == an.Variants[1].HexPreview {
		t.Fatal("AES and DES ciphertexts identical")
	}

	// Benchmark.
	st, b = alice.do("POST", "/api/files/"+pdfID+"/benchmark", map[string]int{"runs": 51})
	expect(t, "too many runs", st, 400, b)
	st, b = alice.do("POST", "/api/files/"+pdfID+"/benchmark", map[string]int{"runs": 3})
	expect(t, "benchmark", st, 200, b)
	br := decode[struct{ Results []benchResult }](t, b)
	if len(br.Results) != 3 {
		t.Fatalf("benchmark: %s", b)
	}
	for _, r := range br.Results {
		if len(r.CipherNs) != 3 || r.Cipher.Mean <= 0 || r.ThroughputMBps <= 0 {
			t.Fatalf("benchmark result: %+v", r)
		}
	}
	st, b = alice.do("POST", "/api/benchmarks", map[string]any{"file_id": pdfID, "algorithm": "RC4", "durations_ns": []int64{1000, 2000}})
	expect(t, "client benchmark", st, 201, b)
	st, b = alice.do("POST", "/api/benchmarks", map[string]any{"file_id": pdfID, "algorithm": "RC4", "durations_ns": []int64{-5}})
	expect(t, "negative duration", st, 400, b)
	st, b = alice.do("GET", "/api/benchmarks", nil)
	expect(t, "benchmark summary", st, 200, b)
	if s := decode[struct{ Summary []map[string]any }](t, b); len(s.Summary) == 0 {
		t.Fatal("empty summary")
	}
	st, b = alice.do("GET", "/api/benchmarks/raw", nil)
	expect(t, "benchmark raw", st, 200, b)

	// Tampering with one ciphertext file is caught before any byte is sent.
	mp4ID := ids["video.mp4"]
	var desPath string
	e.db.QueryRow(`SELECT storage_path FROM file_variants WHERE file_id = ? AND algorithm = 'DES'`, mp4ID).Scan(&desPath)
	full := filepath.Join(e.store.Root(), desPath)
	data, _ := os.ReadFile(full)
	data[len(data)/2] ^= 0x01
	os.WriteFile(full, data, 0o600)
	st, b = alice.do("GET", "/api/files/"+mp4ID+"/download?alg=DES", nil)
	expect(t, "tampered download", st, 422, b)
	st, b = alice.do("GET", "/api/files/"+mp4ID+"/download?alg=AES", nil)
	expect(t, "other variant still fine", st, 200, b)
	st, b = alice.do("GET", "/api/files/"+mp4ID+"/analysis", nil)
	expect(t, "analysis of tampered", st, 200, b)
	for _, v := range decode[struct{ Variants []variantAnalysis }](t, b).Variants {
		if v.MACValid == (v.Algorithm == "DES") {
			t.Fatalf("mac_valid wrong for %s", v.Algorithm)
		}
	}

	// Delete removes rows and all three files.
	var paths []string
	rows, _ = e.db.Query(`SELECT storage_path FROM file_variants WHERE file_id = ?`, pdfID)
	for rows.Next() {
		var p string
		rows.Scan(&p)
		paths = append(paths, p)
	}
	rows.Close()
	st, b = alice.do("DELETE", "/api/files/"+pdfID, nil)
	expect(t, "delete", st, 204, b)
	for _, p := range paths {
		if _, err := os.Stat(filepath.Join(e.store.Root(), p)); !os.IsNotExist(err) {
			t.Errorf("%s still on disk", p)
		}
	}
	st, b = alice.do("GET", "/api/files/"+pdfID+"/download?alg=AES", nil)
	expect(t, "download deleted", st, 404, b)
	st, b = alice.do("DELETE", "/api/files/"+pdfID, nil)
	expect(t, "delete twice", st, 404, b)

	st, b = alice.do("DELETE", "/api/benchmarks", nil)
	expect(t, "clear benchmarks", st, 204, b)

	// Clean up test users (cascades to sessions, profiles, files, benchmarks).
	e.db.Exec(`DELETE FROM users WHERE username IN (?, ?)`, aliceName, bobName)
}
