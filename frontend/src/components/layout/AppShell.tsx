import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  FileCheck2,
  Gauge,
  Gavel,
  Home,
  LogOut,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  User,
  Users,
} from 'lucide-react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { apiClient, type UserRole } from '@/api'
import { BORDER, FOCUS, SURFACE_CARD, SURFACE_PAGE, WELL } from '@/components/ui/tokens'
import { useAuthStore } from '@/stores/authStore'
import { useUiStore } from '@/stores/uiStore'

interface NavItem {
  to: string
  label: string
  Icon: typeof Home
  /** `end` keeps a parent route from matching its own children. */
  end?: boolean
}

const NAV_BY_ROLE: Record<UserRole, NavItem[]> = {
  peserta: [
    { to: '/dashboard', label: 'Home', Icon: Home },
    { to: '/profile', label: 'Profil Saya', Icon: User },
    { to: '/encryption-inspector', label: 'Encryption Inspector', Icon: ShieldCheck },
  ],
  juri: [
    { to: '/juri/teams', label: 'Home', Icon: Home, end: true },
    { to: '/encryption-inspector', label: 'Encryption Inspector', Icon: ShieldCheck },
  ],
  superadmin: [
    { to: '/admin/participants', label: 'Verifikasi Peserta', Icon: FileCheck2, end: true },
    { to: '/admin/teams', label: 'Daftar Tim', Icon: Users },
    { to: '/admin/juri', label: 'Akun Juri', Icon: Gavel },
    { to: '/admin/settings', label: 'Pengaturan', Icon: SlidersHorizontal },
    { to: '/admin/audit-logs', label: 'Audit Log', Icon: ScrollText },
    { to: '/admin/benchmarks', label: 'Benchmarks', Icon: Gauge },
    { to: '/encryption-inspector', label: 'Encryption Inspector', Icon: ShieldCheck },
  ],
}

const ROLE_LABELS: Record<UserRole, string> = {
  peserta: 'Peserta',
  juri: 'Juri',
  superadmin: 'Superadmin',
}

/** Two letters from the display name, or from the email when there is no name. */
function initialsOf(fullName: string | null, email: string): string {
  const source = fullName?.trim() || email
  const parts = source.split(/[\s.@_-]+/).filter(Boolean)
  const letters = parts.slice(0, 2).map((part) => part[0] ?? '')
  return (letters.join('') || source[0] || '?').toUpperCase()
}

function SidebarLink({ item }: { item: NavItem }) {
  const { to, label, Icon, end } = item

  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${FOCUS} ${
          isActive
            ? 'bg-gradient-to-r from-cyan-500/20 to-sky-500/10 text-cyan-100 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.35)]'
            : 'text-slate-300 hover:bg-white/5 hover:text-white'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className={`h-4 w-4 shrink-0 ${isActive ? 'text-cyan-300' : 'text-slate-400'}`}
            aria-hidden="true"
          />
          {label}
        </>
      )}
    </NavLink>
  )
}

export function AppShell() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((state) => state.user)
  const notices = useUiStore((state) => state.notices)

  const isFullBleedCanvasRoute =
    location.pathname === '/login' || location.pathname === '/register'

  const logoutMutation = useMutation({
    mutationFn: apiClient.auth.logout,
    onSettled: () => {
      useAuthStore.getState().clearSession()
      queryClient.clear()
      void navigate('/login', { replace: true })
    },
  })

  const navItems = user ? NAV_BY_ROLE[user.role] : []

  return (
    <div className={`min-h-screen ${SURFACE_PAGE} text-slate-100`}>
      <header
        className={`sticky top-0 z-20 border-b ${BORDER} bg-[#0c1424]/90 backdrop-blur-md`}
      >
        <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2.5">
          <NavLink
            to="/"
            className={`flex items-center gap-2.5 text-lg font-bold tracking-tight text-white ${FOCUS} rounded-lg`}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-sky-600">
              <ShieldCheck className="h-5 w-5 text-slate-950" aria-hidden="true" />
            </span>
            <span>
              Schematics <span className="text-cyan-300">NIC</span>
            </span>
          </NavLink>

          <div className="flex items-center gap-3">
            <div className="text-xs text-slate-400" data-testid="session-badge">
              {user ? `${user.email} (${user.role})` : 'Guest'}
            </div>
            {user ? (
              <button
                type="button"
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-2xl border ${BORDER} bg-[#0b1220] px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-cyan-400/60 hover:text-white disabled:opacity-50 ${FOCUS}`}
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                Keluar
              </button>
            ) : (
              <nav aria-label="Navigasi tamu" className="flex items-center gap-3 text-sm">
                <NavLink to="/login" className="text-slate-300 transition hover:text-white">
                  Login
                </NavLink>
                <NavLink to="/register" className="text-slate-300 transition hover:text-white">
                  Register
                </NavLink>
              </nav>
            )}
          </div>
        </div>
      </header>

      {notices.length > 0 ? (
        <div className="mx-auto max-w-7xl px-4 pt-4" role="status">
          {notices.map((notice) => (
            <div
              key={notice.id}
              className={`mb-2 rounded-2xl border ${BORDER} ${SURFACE_CARD} px-4 py-2.5 text-sm text-slate-200`}
            >
              {notice.message}
            </div>
          ))}
        </div>
      ) : null}

      {isFullBleedCanvasRoute ? (
        <main className="w-full">
          <Outlet />
        </main>
      ) : (
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 lg:flex-row">
          {user ? (
            <aside className="lg:w-64 lg:shrink-0">
              <div className={`${WELL} lg:sticky lg:top-24 p-4`}>
                <div className="flex flex-col items-center gap-3 text-center">
                  <span
                    aria-hidden="true"
                    className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-sky-600 text-2xl font-bold text-slate-950"
                  >
                    {initialsOf(user.full_name, user.email)}
                  </span>
                  <div>
                    <p className="text-base font-bold text-white">
                      {user.full_name ?? user.email}
                    </p>
                    <p className="mt-0.5 text-xs text-cyan-300">{ROLE_LABELS[user.role]}</p>
                  </div>
                </div>

                <nav aria-label="Navigasi utama" className="mt-5 flex flex-col gap-1">
                  {navItems.map((item) => (
                    <SidebarLink key={item.to} item={item} />
                  ))}
                </nav>
              </div>
            </aside>
          ) : null}

          <main className="min-w-0 flex-1">
            <Outlet />
          </main>
        </div>
      )}
    </div>
  )
}
