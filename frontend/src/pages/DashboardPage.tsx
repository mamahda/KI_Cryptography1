import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, AlgDot, Spinner } from '../components/ui'
import { ALGORITHMS, api, errorText, type FileItem } from '../lib/api'
import { ALG_INFO } from '../lib/algorithms'
import { useAuth } from '../lib/auth-context'
import { formatBytes } from '../lib/format'

export function DashboardPage() {
  const { user } = useAuth()
  const [files, setFiles] = useState<FileItem[] | null>(null)
  const [hasProfile, setHasProfile] = useState<boolean | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([api.listFiles(), api.getProfile('AES')])
      .then(([f, p]) => {
        if (cancelled) return
        setFiles(f)
        setHasProfile(p.data !== null)
      })
      .catch((err) => !cancelled && setError(errorText(err)))
    return () => {
      cancelled = true
    }
  }, [])

  const count = (c: string) => files?.filter((f) => f.category === c).length ?? 0
  const total = files?.reduce((s, f) => s + f.size, 0) ?? 0

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Halo, {user?.username}</h1>
          <p className="muted">Ringkasan data yang tersimpan terenkripsi di brankas Anda.</p>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {!files && !error && <Spinner />}

      {files && (
        <div className="stat-grid">
          <Link to="/profile" className="stat-tile">
            <span className="stat-label">Data pribadi</span>
            <span className="stat-value">{hasProfile ? 'Tersimpan' : 'Belum diisi'}</span>
            <span className="stat-sub">{hasProfile ? '3 versi terenkripsi' : 'Isi sekarang →'}</span>
          </Link>
          <Link to="/files?c=id_card" className="stat-tile">
            <span className="stat-label">Foto KTP</span>
            <span className="stat-value">{count('id_card')}</span>
            <span className="stat-sub">file</span>
          </Link>
          <Link to="/files?c=document" className="stat-tile">
            <span className="stat-label">Dokumen</span>
            <span className="stat-value">{count('document')}</span>
            <span className="stat-sub">PDF / DOC / XLS</span>
          </Link>
          <Link to="/files?c=video" className="stat-tile">
            <span className="stat-label">Video</span>
            <span className="stat-value">{count('video')}</span>
            <span className="stat-sub">file</span>
          </Link>
          <div className="stat-tile">
            <span className="stat-label">Total ukuran asli</span>
            <span className="stat-value">{formatBytes(total)}</span>
            <span className="stat-sub">disimpan ×3 di server</span>
          </div>
        </div>
      )}

      <section className="card">
        <h2>Bagaimana data Anda dilindungi</h2>
        <p className="muted">
          Setiap data dienkripsi tiga kali secara terpisah. Saat mengunduh, Anda memilih versi mana yang didekripsi,
          sehingga waktu dan hasil ciphertext ketiga algoritma bisa dibandingkan langsung.
        </p>
        <div className="alg-grid">
          {ALGORITHMS.map((a) => (
            <div key={a} className="alg-card">
              <div className="alg-card-head">
                <AlgDot alg={a} />
                <strong>{ALG_INFO[a].name}</strong>
              </div>
              <dl className="kv">
                <dt>Mode</dt>
                <dd>{ALG_INFO[a].mode}</dd>
                <dt>Kunci</dt>
                <dd>{ALG_INFO[a].keyBits}</dd>
                <dt>Blok</dt>
                <dd>{ALG_INFO[a].blockBits}</dd>
              </dl>
              <p className="small muted">{ALG_INFO[a].note}</p>
            </div>
          ))}
        </div>
        <ul className="check-list">
          <li>Kunci tiap user &amp; tiap algoritma diturunkan dengan HKDF-SHA256 (secret server + username).</li>
          <li>HMAC-SHA256 (encrypt-then-MAC) diperiksa sebelum data dikirim; data yang diubah ditolak.</li>
          <li>Nama file asli juga dienkripsi; file plaintext tidak pernah disimpan.</li>
        </ul>
      </section>
    </>
  )
}
