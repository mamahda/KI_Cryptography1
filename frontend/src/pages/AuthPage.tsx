import { useId, useState, type SubmitEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { LockIcon } from '../components/Layout'
import { Alert, Spinner } from '../components/ui'
import { errorText } from '../lib/api'
import { useAuth } from '../lib/auth-context'

type Mode = 'login' | 'register'

const USERNAME_RE = /^[a-z0-9_]{3,32}$/

export function AuthPage() {
  const { user, loading, login, register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const uid = useId()

  if (loading) {
    return (
      <div className="center-page">
        <Spinner />
      </div>
    )
  }
  if (user) return <Navigate to={from} replace />

  function switchMode(m: Mode) {
    setMode(m)
    setError('')
    setConfirm('')
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault()
    setError('')
    const u = username.trim().toLowerCase()
    if (mode === 'register') {
      if (!USERNAME_RE.test(u)) {
        setError('Username harus 3–32 karakter: huruf kecil, angka, atau underscore.')
        return
      }
      if (new TextEncoder().encode(password).length < 8) {
        setError('Password minimal 8 karakter.')
        return
      }
      if (new TextEncoder().encode(password).length > 72) {
        setError('Password maksimal 72 byte.')
        return
      }
      if (password !== confirm) {
        setError('Konfirmasi password tidak sama.')
        return
      }
    }
    setBusy(true)
    try {
      if (mode === 'login') await login(u, password)
      else await register(u, password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-intro">
        <div className="brand brand-lg">
          <LockIcon />
          <span>Vault</span>
        </div>
        <h1>Brankas data pribadi terenkripsi</h1>
        <p>
          Simpan data pribadi, foto KTP, dokumen, dan video. Setiap data dienkripsi tiga kali secara terpisah
          dengan <strong>AES-256</strong>, <strong>DES</strong>, dan <strong>RC4</strong>, lalu dilindungi HMAC-SHA256
          dari perubahan.
        </p>
        <ul className="check-list">
          <li>Mode CTR untuk AES &amp; DES (bukan ECB), IV acak per data</li>
          <li>RC4 dengan nonce per file dan drop 3072 byte keystream</li>
          <li>Password di-hash dengan bcrypt</li>
        </ul>
      </section>

      <section className="card auth-card">
        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={mode === 'login' ? 'active' : ''}
            onClick={() => switchMode('login')}
          >
            Masuk
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={mode === 'register' ? 'active' : ''}
            onClick={() => switchMode('register')}
          >
            Daftar
          </button>
        </div>

        <form onSubmit={submit} className="form" noValidate>
          <div className="field">
            <label htmlFor={`${uid}-u`}>Username</label>
            <input
              id={`${uid}-u`}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby={mode === 'register' ? `${uid}-uh` : undefined}
              required
            />
            {mode === 'register' && <small id={`${uid}-uh`}>3–32 karakter: huruf kecil, angka, underscore.</small>}
          </div>
          <div className="field">
            <label htmlFor={`${uid}-p`}>Password</label>
            <input
              id={`${uid}-p`}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              aria-describedby={mode === 'register' ? `${uid}-ph` : undefined}
              required
            />
            {mode === 'register' && <small id={`${uid}-ph`}>Minimal 8 karakter.</small>}
          </div>
          {mode === 'register' && (
            <div className="field">
              <label htmlFor={`${uid}-c`}>Konfirmasi password</label>
              <input
                id={`${uid}-c`}
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
          )}
          {error && <Alert kind="error">{error}</Alert>}
          <button className="btn btn-primary btn-block" disabled={busy || !username || !password}>
            {busy ? 'Memproses…' : mode === 'login' ? 'Masuk' : 'Buat akun'}
          </button>
        </form>
      </section>
    </div>
  )
}
