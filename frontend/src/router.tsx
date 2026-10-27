import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LogOut, ShieldCheck } from 'lucide-react'
import {
  BrowserRouter,
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
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
import { DocumentManagerPage } from './pages/participant/DocumentManagerPage'
import { ParticipantDashboardPage } from './pages/participant/ParticipantDashboardPage'
import { ProfilePage } from './pages/participant/ProfilePage'
import { TeamWorkspacePage } from './pages/participant/TeamWorkspacePage'
import { VideoUploadPage } from './pages/participant/VideoUploadPage'
import { useAuthStore } from './stores/authStore'
import { useUiStore } from './stores/uiStore'

function AppShellLayout() {
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

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <header className="sticky top-0 z-20 border-b border-[#222] bg-black/85 backdrop-blur-md">
        <div className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2.5">
          <Link to="/" className="flex items-center gap-2 font-semibold text-white">
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[#333] bg-[#111]">
              <ShieldCheck className="h-4 w-4 text-zinc-100" aria-hidden="true" />
            </span>
            <span className="tracking-tight">Schematics NIC</span>
          </Link>

          <nav aria-label="Primary navigation" className="flex flex-wrap items-center gap-4 text-sm">
            {!user && (
              <>
                <Link to="/login" className="text-zinc-400 transition hover:text-white">
                  Login
                </Link>
                <Link to="/register" className="text-zinc-400 transition hover:text-white">
                  Register
                </Link>
              </>
            )}

            {user?.role === 'peserta' && (
              <>
                <Link to="/dashboard" className="text-zinc-400 transition hover:text-white">
                  Dashboard
                </Link>
                <Link to="/profile" className="text-zinc-400 transition hover:text-white">
                  Profile
                </Link>
                <Link to="/documents" className="text-zinc-400 transition hover:text-white">
                  Documents
                </Link>
                <Link to="/team" className="text-zinc-400 transition hover:text-white">
                  Team Workspace
                </Link>
                <Link to="/video" className="text-zinc-400 transition hover:text-white">
                  Video Upload
                </Link>
                <Link
                  to="/encryption-inspector"
                  className="text-zinc-400 transition hover:text-white"
                >
                  Encryption Inspector
                </Link>
              </>
            )}

            {user?.role === 'juri' && (
              <>
                <Link to="/juri/teams" className="text-zinc-400 transition hover:text-white">
                  Juri
                </Link>
                <Link
                  to="/encryption-inspector"
                  className="text-zinc-400 transition hover:text-white"
                >
                  Encryption Inspector
                </Link>
              </>
            )}

            {user?.role === 'superadmin' && (
              <>
                <Link
                  to="/admin/participants"
                  className="text-zinc-400 transition hover:text-white"
                >
                  Superadmin
                </Link>
                <Link to="/admin/teams" className="text-zinc-400 transition hover:text-white">
                  Teams
                </Link>
                <Link to="/admin/juri" className="text-zinc-400 transition hover:text-white">
                  Juri Accounts
                </Link>
                <Link to="/admin/settings" className="text-zinc-400 transition hover:text-white">
                  Settings
                </Link>
                <Link to="/admin/audit-logs" className="text-zinc-400 transition hover:text-white">
                  Audit Logs
                </Link>
                <Link to="/admin/benchmarks" className="text-zinc-400 transition hover:text-white">
                  Benchmarks
                </Link>
                <Link
                  to="/encryption-inspector"
                  className="text-zinc-400 transition hover:text-white"
                >
                  Encryption Inspector
                </Link>
              </>
            )}
          </nav>

          <div className="flex items-center gap-3">
            <div className="text-xs text-zinc-400" data-testid="session-badge">
              {user ? `${user.email} (${user.role})` : 'Guest'}
            </div>
            {user && (
              <button
                type="button"
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#333] bg-[#121212] px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-zinc-500 hover:text-white disabled:opacity-50"
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
              className="mb-2 rounded-lg border border-[#333] bg-[#121212] px-4 py-2 text-sm text-zinc-200"
            >
              {notice.message}
            </div>
          ))}
        </div>
      )}

      {isFullBleedCanvasRoute ? (
        <main className="w-full">
          <Outlet />
        </main>
      ) : (
        <main className="mx-auto max-w-6xl px-4 py-8">
          <Outlet />
        </main>
      )}
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
    <section className="rounded-xl border border-[#222] bg-[#121212] p-6 shadow-[0_10px_40px_rgba(0,0,0,0.8)] sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Platform Pendaftaran Schematics NIC
        </h1>
        <span
          data-testid="api-mode-badge"
          className="rounded-full border border-[#333] bg-black px-3 py-1 text-xs font-medium text-zinc-200"
        >
          {env.enableMsw ? 'MSW Mock Mode' : 'API Proxy Mode'}
        </span>
      </div>
      <p className="mt-2 text-sm text-zinc-400">
        Triple-cipher encrypted registration &amp; submission workspace (AES-CTR, DES-CTR, RC4 +
        HMAC-SHA256).
      </p>

      <div className="mt-5 rounded-lg border border-[#222] bg-black p-4 text-sm text-zinc-300">
        {isLoading && <p className="text-zinc-400">Loading competition settings...</p>}
        {isError && (
          <p className="text-amber-300">
            Backend API not yet reachable on <code>/api/settings</code> (start Flask or run with{' '}
            <code>VITE_ENABLE_MSW=true</code>).
          </p>
        )}
        {data && (
          <dl className="grid gap-3 sm:grid-cols-3" data-testid="settings-summary">
            <div>
              <dt className="text-xs text-zinc-500">Team Size</dt>
              <dd className="mt-0.5 font-medium text-white">
                {data.min_team_size}–{data.max_team_size} members
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Max Document / Proposal</dt>
              <dd className="mt-0.5 font-medium text-white">
                {Math.round(data.limits.document_max_bytes / 1_048_576)} MB /{' '}
                {Math.round(data.limits.proposal_max_bytes / 1_048_576)} MB
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Max Demo Video</dt>
              <dd className="mt-0.5 font-medium text-white">
                {Math.round(data.limits.video_max_bytes / 1_048_576)} MB
              </dd>
            </div>
          </dl>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        {!user ? (
          <>
            <Link
              to="/login"
              className="rounded-md bg-[#ededed] px-4 py-2 text-sm font-medium text-black transition hover:bg-white"
            >
              Masuk
            </Link>
            <Link
              to="/register"
              className="rounded-md border border-[#333] bg-black px-4 py-2 text-sm font-medium text-white transition hover:border-zinc-500"
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
            className="rounded-md bg-[#ededed] px-4 py-2 text-sm font-medium text-black transition hover:bg-white"
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
    <section className="rounded-xl border border-[#222] bg-[#121212] p-6 shadow-[0_10px_40px_rgba(0,0,0,0.8)]">
      <h1 className="text-xl font-semibold text-white">{title}</h1>
      <p className="mt-2 text-sm text-zinc-400">{description}</p>
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
              <Route path="/dashboard" element={<ParticipantDashboardPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/documents" element={<DocumentManagerPage />} />
              <Route path="/team" element={<TeamWorkspacePage />} />
              <Route path="/video" element={<VideoUploadPage />} />
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
