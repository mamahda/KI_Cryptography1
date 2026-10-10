import { useCallback, useEffect, useState, type SubmitEvent } from 'react'
import { Alert, AlgDot, AlgTabs, EntropyMeter, HexView, Spinner } from '../components/ui'
import {
  ALGORITHMS,
  api,
  errorText,
  type Algorithm,
  type Profile,
  type ProfileResponse,
  type SaveProfileResponse,
} from '../lib/api'
import { formatBytes, formatDate, formatNs } from '../lib/format'

const EMPTY: Profile = {
  full_name: '',
  nik: '',
  birth_place: '',
  birth_date: '',
  gender: '',
  nationality: 'Indonesia',
  religion: '',
  marital_status: '',
  address: '',
  phone: '',
  email: '',
  blood_type: '',
  health_notes: '',
  bank_account: '',
}

const GENDERS = ['Laki-laki', 'Perempuan']
const RELIGIONS = ['Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha', 'Konghucu', 'Lainnya']
const MARITALS = ['Belum Kawin', 'Kawin', 'Cerai Hidup', 'Cerai Mati']
const BLOOD = ['A', 'B', 'AB', 'O', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

const LABELS: Record<keyof Profile, string> = {
  full_name: 'Nama lengkap',
  nik: 'NIK',
  birth_place: 'Tempat lahir',
  birth_date: 'Tanggal lahir',
  gender: 'Jenis kelamin',
  nationality: 'Kewarganegaraan',
  religion: 'Agama',
  marital_status: 'Status perkawinan',
  address: 'Alamat',
  phone: 'No. HP',
  email: 'Email',
  blood_type: 'Golongan darah',
  health_notes: 'Catatan kesehatan',
  bank_account: 'No. rekening',
}

export function ProfilePage() {
  const [form, setForm] = useState<Profile>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<SaveProfileResponse | null>(null)

  const [alg, setAlg] = useState<Algorithm>('AES')
  const [view, setView] = useState<ProfileResponse | null>(null)
  const [viewError, setViewError] = useState('')
  const [viewLoading, setViewLoading] = useState(true)

  const loadView = useCallback(async (a: Algorithm) => {
    setViewLoading(true)
    setViewError('')
    try {
      const r = await api.getProfile(a)
      setView(r)
      return r
    } catch (err) {
      setView(null)
      setViewError(errorText(err))
      return null
    } finally {
      setViewLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    api
      .getProfile('AES')
      .then((r) => {
        if (cancelled) return
        setView(r)
        if (r.data) setForm({ ...EMPTY, ...r.data })
      })
      .catch((err) => !cancelled && setViewError(errorText(err)))
      .finally(() => {
        if (cancelled) return
        setLoaded(true)
        setViewLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function set<K extends keyof Profile>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault()
    setError('')
    setSaved(null)
    if (!/^\d{16}$/.test(form.nik.replace(/[\s.-]/g, ''))) {
      setError('NIK wajib 16 digit angka.')
      return
    }
    setSaving(true)
    try {
      const r = await api.saveProfile(form)
      setSaved(r)
      setForm({ ...EMPTY, ...r.data })
      await loadView(alg)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  function pickAlg(a: Algorithm) {
    setAlg(a)
    loadView(a)
  }

  const text = (key: keyof Profile, props: { type?: string; placeholder?: string; inputMode?: 'numeric' | 'tel' | 'email' } = {}) => (
    <label className="field">
      <span>{LABELS[key]}</span>
      <input
        type={props.type ?? 'text'}
        value={form[key]}
        placeholder={props.placeholder}
        inputMode={props.inputMode}
        onChange={(e) => set(key, e.target.value)}
      />
    </label>
  )
  const select = (key: keyof Profile, options: string[]) => (
    <label className="field">
      <span>{LABELS[key]}</span>
      <select value={form[key]} onChange={(e) => set(key, e.target.value)}>
        <option value="">— pilih —</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Data Pribadi</h1>
          <p className="muted">
            Kategori data mengacu pada UU PDP No. 27/2022 Pasal 4 dan GDPR Art. 4 &amp; 9. Seluruh isian disimpan
            sebagai satu JSON yang dienkripsi tiga kali (AES, DES, RC4).
          </p>
        </div>
      </div>

      <div className="two-col">
        <section className="card">
          <h2>Isi / ubah data</h2>
          {!loaded ? (
            <Spinner />
          ) : (
            <form className="form" onSubmit={submit}>
              <fieldset>
                <legend>Data pribadi umum</legend>
                <div className="grid-2">
                  <label className="field span-2">
                    <span>
                      {LABELS.full_name} <em className="req">*</em>
                    </span>
                    <input value={form.full_name} onChange={(e) => set('full_name', e.target.value)} required />
                  </label>
                  <label className="field span-2">
                    <span>
                      {LABELS.nik} <em className="req">*</em>
                    </span>
                    <input
                      value={form.nik}
                      onChange={(e) => set('nik', e.target.value)}
                      inputMode="numeric"
                      placeholder="16 digit"
                      required
                    />
                  </label>
                  {text('birth_place')}
                  {text('birth_date', { type: 'date' })}
                  {select('gender', GENDERS)}
                  {text('nationality')}
                  {select('religion', RELIGIONS)}
                  {select('marital_status', MARITALS)}
                  {text('phone', { inputMode: 'tel', placeholder: '+62…' })}
                  {text('email', { type: 'email', inputMode: 'email' })}
                  <label className="field span-2">
                    <span>{LABELS.address}</span>
                    <textarea rows={2} value={form.address} onChange={(e) => set('address', e.target.value)} />
                  </label>
                </div>
              </fieldset>
              <fieldset>
                <legend>Data pribadi spesifik (kesehatan &amp; keuangan)</legend>
                <div className="grid-2">
                  {select('blood_type', BLOOD)}
                  {text('bank_account', { inputMode: 'numeric' })}
                  <label className="field span-2">
                    <span>{LABELS.health_notes}</span>
                    <textarea
                      rows={2}
                      value={form.health_notes}
                      onChange={(e) => set('health_notes', e.target.value)}
                    />
                  </label>
                </div>
              </fieldset>
              {error && <Alert kind="error">{error}</Alert>}
              {saved && (
                <Alert kind="success">
                  Tersimpan ({formatBytes(saved.size)} plaintext JSON) dan dienkripsi dengan ketiga algoritma.
                  <table className="table table-compact">
                    <thead>
                      <tr>
                        <th>Algoritma</th>
                        <th className="num">Waktu cipher</th>
                        <th className="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ALGORITHMS.map((a) => (
                        <tr key={a}>
                          <td>
                            <AlgDot alg={a} /> {a}
                          </td>
                          <td className="num">{formatNs(saved.encrypt[a].cipher_ns)}</td>
                          <td className="num">{formatNs(saved.encrypt[a].total_ns)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Alert>
              )}
              <button className="btn btn-primary" disabled={saving}>
                {saving ? 'Mengenkripsi…' : 'Simpan & enkripsi'}
              </button>
            </form>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Data terdekripsi</h2>
            <AlgTabs value={alg} onChange={pickAlg} label="Dekripsi dengan" />
          </div>
          {viewLoading && <Spinner label="Mendekripsi…" />}
          {viewError && <Alert kind="error">{viewError}</Alert>}
          {!viewLoading && view && !view.data && <p className="muted">Belum ada data pribadi yang disimpan.</p>}
          {!viewLoading && view?.data && (
            <>
              <div className="metrics">
                <div>
                  <span className="metric-label">Waktu dekripsi ({view.algorithm})</span>
                  <span className="metric-value">{formatNs(view.decrypt_ns ?? 0)}</span>
                </div>
                <div>
                  <span className="metric-label">Ukuran ciphertext</span>
                  <span className="metric-value">{formatBytes(view.size ?? 0)}</span>
                </div>
                <div>
                  <span className="metric-label">Diperbarui</span>
                  <span className="metric-value metric-small">
                    {view.updated_at ? formatDate(view.updated_at) : '–'}
                  </span>
                </div>
              </div>
              <dl className="kv kv-wide">
                {(Object.keys(LABELS) as (keyof Profile)[]).map((k) => (
                  <div key={k} className="kv-row">
                    <dt>{LABELS[k]}</dt>
                    <dd>{view.data?.[k] || <span className="muted">–</span>}</dd>
                  </div>
                ))}
              </dl>
              <details className="details">
                <summary>Lihat ciphertext yang tersimpan di database</summary>
                <dl className="kv">
                  <dt>IV / nonce</dt>
                  <dd className="mono break">{view.iv_hex}</dd>
                  <dt>HMAC</dt>
                  <dd className="mono break">{view.mac_hex}</dd>
                  <dt>Entropi</dt>
                  <dd>
                    <EntropyMeter value={view.ciphertext_entropy ?? 0} />
                  </dd>
                </dl>
                <HexView hex={view.ciphertext_hex ?? ''} />
              </details>
            </>
          )}
        </section>
      </div>
    </>
  )
}
