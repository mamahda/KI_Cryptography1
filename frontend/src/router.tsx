import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LogOut, ShieldCheck } from 'lucide-react'
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom'
import { apiClient, type PublicSettings } from './api'
import {
  ConsentGuard,
  ProtectedRoute,
  RoleGuard,
} from './components/guards/RouteGuards'
import { env } from './config/env'
import { BenchmarksPage } from './pages/admin/BenchmarksPage'
import { ConsentPage } from './pages/auth/ConsentPage'
import { LoginPage } from './pages/auth/LoginPage'
import { RegisterPage } from './pages/auth/RegisterPage'
import { useAuthStore } from './stores/authStore'
import { useUiStore } from './stores/uiStore'

function AppShellLayout() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const notices = useUiStore((state) => state.notices)

  const logoutMutation = useMutation({
    mutationFn: apiClient.auth.logout,
    onSettled: () => {
      useAuthStore.getState().clearSession()
      queryClient.clear()
      void navigate('/login', { replace: true })
    },
  })

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold text-slate-900">
            <ShieldCheck className="h-5 w-5 text-indigo-600" aria-hidden="true" />
            <span>Schematics NIC</span>
          </Link>

          <nav aria-label="Primary navigation" className="flex flex-wrap items-center gap-4 text-sm">
            {!user && (
              <>
                <Link to="/login" className="text-slate-600 hover:text-slate-900">
                  Login
                </Link>
                <Link to="/register" className="text-slate-600 hover:text-slate-900">
                  Register
                </Link>
              </>
            )}

            {user?.role === 'peserta' && (
              <>
                <Link to="/dashboard" className="text-slate-600 hover:text-slate-900">
                  Dashboard
                </Link>
                <Link to="/profile" className="text-slate-600 hover:text-slate-900">
                  Profile
                </Link>
                <Link to="/documents" className="text-slate-600 hover:text-slate-900">
                  Documents
                </Link>
                <Link to="/team" className="text-slate-600 hover:text-slate-900">
                  Team Workspace
                </Link>
                <Link to="/video" className="text-slate-600 hover:text-slate-900">
                  Video Upload
                </Link>
                <Link to="/encryption-inspector" className="text-slate-600 hover:text-slate-900">
                  Encryption Inspector
                </Link>
              </>
            )}

            {user?.role === 'juri' && (
              <>
                <Link to="/juri/teams" className="text-slate-600 hover:text-slate-900">
                  Juri
                </Link>
                <Link to="/encryption-inspector" className="text-slate-600 hover:text-slate-900">
                  Encryption Inspector
                </Link>
              </>
            )}

            {user?.role === 'superadmin' && (
              <>
                <Link to="/admin/participants" className="text-slate-600 hover:text-slate-900">
                  Superadmin
                </Link>
                <Link to="/admin/teams" className="text-slate-600 hover:text-slate-900">
                  Teams
                </Link>
                <Link to="/admin/juri" className="text-slate-600 hover:text-slate-900">
                  Juri Accounts
                </Link>
                <Link to="/admin/settings" className="text-slate-600 hover:text-slate-900">
                  Settings
                </Link>
                <Link to="/admin/audit-logs" className="text-slate-600 hover:text-slate-900">
                  Audit Logs
                </Link>
                <Link to="/admin/benchmarks" className="text-slate-600 hover:text-slate-900">
                  Benchmarks
                </Link>
                <Link to="/encryption-inspector" className="text-slate-600 hover:text-slate-900">
                  Encryption Inspector
                </Link>
              </>
            )}
          </nav>

          <div className="flex items-center gap-3">
            <div className="text-xs text-slate-500" data-testid="session-badge">
              {user ? `${user.email} (${user.role})` : 'Guest'}
            </div>
            {user && (
              <button
                type="button"
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                Keluar
              </button>
            )}
          </div>
        </div>
      </header>

      {notices.length > 0 && (
        <div className="mx-auto max-w-6xl px-4 pt-3" role="status">
          {notices.map((notice) => (
            <div
              key={notice.id}
              className="mb-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700"
            >
              {notice.message}
            </div>
          ))}
        </div>
      )}

      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}

function WorkspaceHome() {
  const user = useAuthStore((state) => state.user)
  const { data, isLoading, isError } = useQuery<PublicSettings>({
    queryKey: ['settings'],
    queryFn: ({ signal }) => apiClient.public.getSettings(signal),
  })

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-slate-900">
          Platform Pendaftaran Schematics NIC
        </h1>
        <span
          data-testid="api-mode-badge"
          className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700"
        >
          {env.enableMsw ? 'MSW Mock Mode' : 'API Proxy Mode'}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        Triple-cipher encrypted registration &amp; submission workspace (AES-CTR, DES-CTR, RC4 +
        HMAC-SHA256).
      </p>

      <div className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-700">
        {isLoading && <p>Loading competition settings...</p>}
        {isError && (
          <p className="text-amber-700">
            Backend API not yet reachable on <code>/api/settings</code> (start Flask or run with{' '}
            <code>VITE_ENABLE_MSW=true</code>).
          </p>
        )}
        {data && (
          <dl className="grid gap-2 sm:grid-cols-3" data-testid="settings-summary">
            <div>
              <dt className="text-xs text-slate-500">Team Size</dt>
              <dd className="font-medium">
                {data.min_team_size}–{data.max_team_size} members
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Max Document / Proposal</dt>
              <dd className="font-medium">
                {Math.round(data.limits.document_max_bytes / 1_048_576)} MB /{' '}
                {Math.round(data.limits.proposal_max_bytes / 1_048_576)} MB
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Max Demo Video</dt>
              <dd className="font-medium">
                {Math.round(data.limits.video_max_bytes / 1_048_576)} MB
              </dd>
            </div>
          </dl>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        {!user ? (
          <>
            <Link
              to="/login"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Masuk
            </Link>
            <Link
              to="/register"
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Daftar Peserta
            </Link>
          </>
        ) : (
          <Link
            to={
              user.role === 'juri'
                ? '/juri/teams'
                : user.role === 'superadmin'
                  ? '/admin/participants'
                  : '/dashboard'
            }
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Buka Dashboard
          </Link>
        )}
      </div>
    </section>
  )
}

function RoutePlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
      <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
    </section>
  )
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShellLayout />}>
        <Route index element={<WorkspaceHome />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* Authenticated routes */}
        <Route element={<ProtectedRoute />}>
          {/* Explicit Privacy Consent Gate (peserta only) */}
          <Route
            path="/consent"
            element={
              <RoleGuard allowedRoles={['peserta']}>
                <ConsentPage />
              </RoleGuard>
            }
          />

          {/* Participant routes (require peserta role + latest privacy consent) */}
          <Route element={<RoleGuard allowedRoles={['peserta']} />}>
            <Route element={<ConsentGuard />}>
              <Route
                path="/dashboard"
                element={
                  <RoutePlaceholder
                    title="Participant Dashboard"
                    description="Verification status, deadline countdown, and profile overview (Phase 2)."
                  />
                }
              />
              <Route
                path="/profile"
                element={
                  <RoutePlaceholder
                    title="Encrypted Personal Profile"
                    description="Participant 7-field personal data form (Phase 2)."
                  />
                }
              />
              <Route
                path="/documents"
                element={
                  <RoutePlaceholder
                    title="Document Manager"
                    description="KTP, KTM/KRSM, and Twibbon upload, preview, and download (Phase 2)."
                  />
                }
              />
              <Route
                path="/team"
                element={
                  <RoutePlaceholder
                    title="Team & Submission Workspace"
                    description="Create/join team, proposal PDF, GitHub repo, and 2-step finalize (Phase 3)."
                  />
                }
              />
              <Route
                path="/video"
                element={
                  <RoutePlaceholder
                    title="Demo Video Upload & Preview"
                    description="Streaming raw binary MP4 upload, full-blob preview, and download (Phase 3)."
                  />
                }
              />
            </Route>
          </Route>

          {/* Shared Encryption Inspector (all authenticated roles; peserta gated by ConsentGuard) */}
          <Route element={<RoleGuard allowedRoles={['peserta', 'juri', 'superadmin']} />}>
            <Route element={<ConsentGuard />}>
              <Route
                path="/encryption-inspector"
                element={
                  <RoutePlaceholder
                    title="Encryption & Integrity Inspector"
                    description="Triple-cipher metadata, live server verification, and SHA-256 checksum (Phase 4)."
                  />
                }
              />
            </Route>
          </Route>

          {/* Juri routes */}
          <Route element={<RoleGuard allowedRoles={['juri']} />}>
            <Route
              path="/juri/teams"
              element={
                <RoutePlaceholder
                  title="Juri — Finalized Teams"
                  description="Judge portal listing finalized hackathon teams (Phase 4)."
                />
              }
            />
            <Route
              path="/juri/teams/:teamId"
              element={
                <RoutePlaceholder
                  title="Juri — Team Submission Detail"
                  description="Judge artifact inspection for proposal, video, and GitHub link (Phase 4)."
                />
              }
            />
          </Route>

          {/* Superadmin routes */}
          <Route element={<RoleGuard allowedRoles={['superadmin']} />}>
            <Route
              path="/admin/participants"
              element={
                <RoutePlaceholder
                  title="Superadmin — Participant Verification"
                  description="Participant verification queue and minor review (Phase 4)."
                />
              }
            />
            <Route
              path="/admin/participants/:userId"
              element={
                <RoutePlaceholder
                  title="Superadmin — Participant Detail"
                  description="Inspect participant profile & documents and approve/reject (Phase 4)."
                />
              }
            />
            <Route
              path="/admin/teams"
              element={
                <RoutePlaceholder
                  title="Superadmin — Teams Overview"
                  description="Paginated overview of all registered teams (Phase 4)."
                />
              }
            />
            <Route
              path="/admin/juri"
              element={
                <RoutePlaceholder
                  title="Superadmin — Juri Accounts"
                  description="List and provision judge accounts (Phase 4)."
                />
              }
            />
            <Route
              path="/admin/settings"
              element={
                <RoutePlaceholder
                  title="Superadmin — Competition Settings"
                  description="Manage deadlines and team size limits (Phase 4)."
                />
              }
            />
            <Route
              path="/admin/audit-logs"
              element={
                <RoutePlaceholder
                  title="Superadmin — Security Audit Logs"
                  description="Filterable access, verification, and integrity_failure audit trail (Phase 4)."
                />
              }
            />
            <Route path="/admin/benchmarks" element={<BenchmarksPage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
