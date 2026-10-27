import { ShieldAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import type { UserRole } from '../../api/types'
import {
  getDefaultHomeRoute,
  needsPrivacyConsent,
  useAuthStore,
} from '../../stores/authStore'

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
      <div className="rounded-xl border border-slate-200 bg-white px-6 py-4 text-sm text-slate-600 shadow-xs">
        Memeriksa sesi autentikasi...
      </div>
    </div>
  )
}

/**
 * Enforces an active authenticated session.
 * Redirects unauthenticated visitors to `/login` while preserving their target path.
 */
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

/**
 * Enforces UU PDP Pasal 20 explicit privacy consent for `peserta`.
 * If `consent` is null or `consent.policy_version !== current_policy_version`,
 * redirects to `/consent` while preserving the intended destination.
 */
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

/**
 * Enforces role-based access control on frontend routes (`peserta`, `juri`, `superadmin`).
 */
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
        className="mx-auto max-w-lg rounded-xl border border-rose-200 bg-white p-6 shadow-xs"
      >
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-rose-600" aria-hidden="true" />
          <div>
            <h1 className="text-lg font-semibold text-slate-900">403 — Akses Ditolak</h1>
            <p className="mt-1 text-sm text-slate-600">
              Akun Anda masuk sebagai <span className="font-medium">{user.role}</span> dan tidak
              memiliki hak akses ke halaman ini.
            </p>
            <div className="mt-4">
              <Link
                to={fallbackRoute}
                className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
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
