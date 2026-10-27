import { ShieldAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import type { UserRole } from '@/api/types'
import {
  getDefaultHomeRoute,
  needsPrivacyConsent,
  useAuthStore,
} from '@/stores/authStore'

export interface RouteNavigationState {
  from?: string
}

function SessionCheckingFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="session-loading"
      className="flex min-h-[40vh] items-center justify-center"
    >
      <div className="rounded-2xl border border-[#243049] bg-[#141d2e] px-6 py-4 text-sm text-slate-300 shadow-lg">
        Memeriksa sesi autentikasi...
      </div>
    </div>
  )
}

export function ProtectedRoute({ children }: { children?: ReactNode }) {
  const sessionChecked = useAuthStore((state) => state.sessionChecked)
  const isBootstrapping = useAuthStore((state) => state.isBootstrapping)
  const user = useAuthStore((state) => state.user)
  const location = useLocation()

  if (!sessionChecked || isBootstrapping) {
    return <SessionCheckingFallback />
  }

  if (!user) {
    const returnTo = `${location.pathname}${location.search}`
    return <Navigate to="/login" replace state={{ from: returnTo } satisfies RouteNavigationState} />
  }

  return children ? <>{children}</> : <Outlet />
}

export function ConsentGuard({ children }: { children?: ReactNode }) {
  const user = useAuthStore((state) => state.user)
  const location = useLocation()

  if (!user) {
    const returnTo = `${location.pathname}${location.search}`
    return <Navigate to="/login" replace state={{ from: returnTo } satisfies RouteNavigationState} />
  }

  if (needsPrivacyConsent(user) && location.pathname !== '/consent') {
    const returnTo = `${location.pathname}${location.search}`
    return (
      <Navigate to="/consent" replace state={{ from: returnTo } satisfies RouteNavigationState} />
    )
  }

  return children ? <>{children}</> : <Outlet />
}

interface RoleGuardProps {
  allowedRoles: readonly UserRole[]
  children?: ReactNode
}

export function RoleGuard({ allowedRoles, children }: RoleGuardProps) {
  const sessionChecked = useAuthStore((state) => state.sessionChecked)
  const isBootstrapping = useAuthStore((state) => state.isBootstrapping)
  const user = useAuthStore((state) => state.user)
  const location = useLocation()

  if (!sessionChecked || isBootstrapping) {
    return <SessionCheckingFallback />
  }

  if (!user) {
    const returnTo = `${location.pathname}${location.search}`
    return <Navigate to="/login" replace state={{ from: returnTo } satisfies RouteNavigationState} />
  }

  if (!allowedRoles.includes(user.role)) {
    const fallbackRoute = getDefaultHomeRoute(user)
    return (
      <section
        data-testid="role-forbidden"
        className="mx-auto max-w-lg rounded-2xl border border-rose-500/40 bg-[#141d2e] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
      >
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-rose-400" aria-hidden="true" />
          <div>
            <h1 className="text-lg font-semibold text-white">403 — Akses Ditolak</h1>
            <p className="mt-1 text-sm text-slate-400">
              Akun Anda masuk sebagai <span className="font-medium text-slate-200">{user.role}</span>{' '}
              dan tidak memiliki hak akses ke halaman ini.
            </p>
            <div className="mt-4">
              <Link
                to={fallbackRoute}
                className="inline-flex items-center rounded-md bg-[#ededed] px-4 py-2 text-sm font-medium text-black hover:bg-white"
              >
                Kembali ke Beranda Peran
              </Link>
            </div>
          </div>
        </div>
      </section>
    )
  }

  return children ? <>{children}</> : <Outlet />
}
