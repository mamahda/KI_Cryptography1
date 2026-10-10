import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { Spinner } from './ui'

const links = [
  { to: '/', label: 'Beranda', end: true },
  { to: '/profile', label: 'Data Pribadi', end: false },
  { to: '/files', label: 'File', end: false },
  { to: '/benchmark', label: 'Benchmark', end: false },
]

export function LockIcon() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <rect x="9" y="14" width="14" height="11" rx="2" fill="#fff" />
      <path d="M12 14v-3a4 4 0 0 1 8 0v3" fill="none" stroke="#fff" strokeWidth="2.5" />
      <circle cx="16" cy="19.5" r="1.8" fill="var(--accent)" />
    </svg>
  )
}

/** Renders the app shell for signed-in users, otherwise redirects to /login. */
export function ProtectedLayout() {
  const { user, loading, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  if (loading) {
    return (
      <div className="center-page">
        <Spinner />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand">
            <LockIcon />
            <span>Vault</span>
          </NavLink>
          <nav className="nav" aria-label="Navigasi utama">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="user-box">
            <span className="user-name" title="Username">
              {user.username}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                await logout()
                navigate('/login', { replace: true })
              }}
            >
              Keluar
            </button>
          </div>
        </div>
      </header>
      <main className="container">
        <Outlet />
      </main>
    </div>
  )
}
