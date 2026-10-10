package api

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"vault/internal/crypto"
	"vault/internal/db"
)

// Profile is the personal data stored per user. The general fields follow
// UU PDP art. 4(3) / GDPR art. 4(1); blood type, health notes and bank
// account are "specific" data under UU PDP art. 4(2) / GDPR art. 9.
type Profile struct {
	FullName      string `json:"full_name"`
	NIK           string `json:"nik"`
	BirthPlace    string `json:"birth_place"`
	BirthDate     string `json:"birth_date"`
	Gender        string `json:"gender"`
	Nationality   string `json:"nationality"`
	Religion      string `json:"religion"`
	MaritalStatus string `json:"marital_status"`
	Address       string `json:"address"`
	Phone         string `json:"phone"`
	Email         string `json:"email"`
	BloodType     string `json:"blood_type"`
	HealthNotes   string `json:"health_notes"`
	BankAccount   string `json:"bank_account"`
}

var (
	nikRe   = regexp.MustCompile(`^[0-9]{16}$`)
	phoneRe = regexp.MustCompile(`^\+?[0-9]{8,15}$`)
	bankRe  = regexp.MustCompile(`^[0-9]{5,20}$`)
	bloodRe = regexp.MustCompile(`^(A|B|AB|O)[+-]?$`)

	genders   = []string{"Laki-laki", "Perempuan"}
	religions = []string{"Islam", "Kristen", "Katolik", "Hindu", "Buddha", "Konghucu", "Lainnya"}
	maritals  = []string{"Belum Kawin", "Kawin", "Cerai Hidup", "Cerai Mati"}
)

func (p *Profile) normalize() {
	for _, f := range []*string{&p.FullName, &p.NIK, &p.BirthPlace, &p.BirthDate, &p.Gender, &p.Nationality,
		&p.Religion, &p.MaritalStatus, &p.Address, &p.Phone, &p.Email, &p.BloodType, &p.HealthNotes, &p.BankAccount} {
		*f = strings.TrimSpace(*f)
	}
	strip := strings.NewReplacer(" ", "", "-", "", ".", "")
	p.NIK = strip.Replace(p.NIK)
	p.Phone = strip.Replace(p.Phone)
	p.BankAccount = strip.Replace(p.BankAccount)
	p.BloodType = strings.ToUpper(p.BloodType)
}

func (p *Profile) validate() error {
	lengths := []struct {
		name string
		v    string
		max  int
	}{
		{"nama lengkap", p.FullName, 100}, {"tempat lahir", p.BirthPlace, 100},
		{"kewarganegaraan", p.Nationality, 50}, {"alamat", p.Address, 300},
		{"email", p.Email, 254}, {"catatan kesehatan", p.HealthNotes, 500},
	}
	for _, l := range lengths {
		if utf8.RuneCountInString(l.v) > l.max {
			return fmt.Errorf("%s maksimal %d karakter", l.name, l.max)
		}
	}
	if p.FullName == "" {
		return errors.New("nama lengkap wajib diisi")
	}
	if !nikRe.MatchString(p.NIK) {
		return errors.New("NIK wajib 16 digit angka")
	}
	if p.BirthDate != "" {
		d, err := time.Parse(time.DateOnly, p.BirthDate)
		if err != nil {
			return errors.New("tanggal lahir harus berformat YYYY-MM-DD")
		}
		if d.Year() < 1900 || d.After(time.Now()) {
			return errors.New("tanggal lahir tidak masuk akal")
		}
	}
	if err := oneOf("jenis kelamin", p.Gender, genders); err != nil {
		return err
	}
	if err := oneOf("agama", p.Religion, religions); err != nil {
		return err
	}
	if err := oneOf("status perkawinan", p.MaritalStatus, maritals); err != nil {
		return err
	}
	if p.Phone != "" && !phoneRe.MatchString(p.Phone) {
		return errors.New("nomor HP harus 8–15 digit (boleh diawali +)")
	}
	if p.Email != "" {
		a, err := mail.ParseAddress(p.Email)
		if err != nil || a.Address != p.Email {
			return errors.New("format email tidak valid")
		}
	}
	if p.BloodType != "" && !bloodRe.MatchString(p.BloodType) {
		return errors.New("golongan darah harus A, B, AB, atau O (opsional + / -)")
	}
	if p.BankAccount != "" && !bankRe.MatchString(p.BankAccount) {
		return errors.New("nomor rekening harus 5–20 digit angka")
	}
	return nil
}

func oneOf(name, v string, allowed []string) error {
	if v == "" {
		return nil
	}
	for _, a := range allowed {
		if v == a {
			return nil
		}
	}
	return fmt.Errorf("%s harus salah satu dari: %s", name, strings.Join(allowed, ", "))
}

// profileAAD binds a profile ciphertext to its owner, so one user's row
// cannot be copied over another's without failing the HMAC.
func profileAAD(userID int64) []byte { return fmt.Appendf(nil, "profile:%d", userID) }

func (s *Server) putProfile(w http.ResponseWriter, r *http.Request, u db.User) {
	var p Profile
	if err := decodeJSON(w, r, &p); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	p.normalize()
	if err := p.validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	plaintext, err := json.Marshal(p)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	keys, err := s.keys(u)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	recs := make([]db.ProfileRecord, 0, len(crypto.Algorithms))
	timings := make(map[crypto.Algorithm]timing, len(crypto.Algorithms))
	for _, alg := range crypto.Algorithms {
		sealed, ct, err := keys.Seal(alg, plaintext, profileAAD(u.ID))
		if err != nil {
			s.serverError(w, r, err)
			return
		}
		recs = append(recs, db.ProfileRecord{
			Algorithm: string(alg), IV: sealed.IV, Ciphertext: ct, MAC: sealed.MAC, EncryptNs: sealed.CipherNs,
		})
		timings[alg] = timing{CipherNs: sealed.CipherNs, TotalNs: sealed.TotalNs}
	}
	if err := s.db.SaveProfile(r.Context(), u.ID, recs); err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"data":    p,
		"size":    len(plaintext),
		"encrypt": timings,
	})
}

type profileResponse struct {
	Algorithm      crypto.Algorithm `json:"algorithm"`
	Data           *Profile         `json:"data"`
	DecryptNs      int64            `json:"decrypt_ns,omitempty"`
	DecryptTotalNs int64            `json:"decrypt_total_ns,omitempty"`
	EncryptNs      int64            `json:"encrypt_ns,omitempty"`
	Size           int              `json:"size,omitempty"`
	IV             string           `json:"iv_hex,omitempty"`
	MAC            string           `json:"mac_hex,omitempty"`
	Ciphertext     string           `json:"ciphertext_hex,omitempty"`
	Entropy        float64          `json:"ciphertext_entropy,omitempty"`
	UpdatedAt      *time.Time       `json:"updated_at,omitempty"`
}

func (s *Server) getProfile(w http.ResponseWriter, r *http.Request, u db.User) {
	alg, err := algParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	rec, err := s.db.Profile(r.Context(), u.ID, string(alg))
	if errors.Is(err, db.ErrNotFound) {
		writeJSON(w, http.StatusOK, profileResponse{Algorithm: alg})
		return
	}
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	keys, err := s.keys(u)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	pt, st, err := keys.Open(alg, rec.IV, rec.Ciphertext, rec.MAC, profileAAD(u.ID))
	if errors.Is(err, crypto.ErrAuth) {
		s.integrityError(w, r, "data profil")
		return
	}
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	var p Profile
	if err := json.Unmarshal(pt, &p); err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, profileResponse{
		Algorithm:      alg,
		Data:           &p,
		DecryptNs:      st.CipherNs,
		DecryptTotalNs: st.TotalNs,
		EncryptNs:      rec.EncryptNs,
		Size:           len(rec.Ciphertext),
		IV:             hex.EncodeToString(rec.IV),
		MAC:            hex.EncodeToString(rec.MAC),
		Ciphertext:     hex.EncodeToString(rec.Ciphertext),
		Entropy:        crypto.ShannonEntropy(rec.Ciphertext),
		UpdatedAt:      &rec.UpdatedAt,
	})
}
