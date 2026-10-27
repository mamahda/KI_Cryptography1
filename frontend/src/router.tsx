import { useQuery } from '@tanstack/react-query'
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom'
import { apiClient, type PublicSettings } from './api'
import {
  ConsentGuard,
  ProtectedRoute,
  RoleGuard,
} from './components/guards/RouteGuards'
import { AppShell } from './components/layout/AppShell'
import { env } from './config/env'
import { AdminAuditLogsPage } from './pages/admin/AdminAuditLogsPage'
import { AdminJuriPage } from './pages/admin/AdminJuriPage'
import { AdminParticipantDetailPage } from './pages/admin/AdminParticipantDetailPage'
import { AdminParticipantsPage } from './pages/admin/AdminParticipantsPage'
import { AdminSettingsPage } from './pages/admin/AdminSettingsPage'
import { AdminTeamsPage } from './pages/admin/AdminTeamsPage'
import { BenchmarksPage } from './pages/admin/BenchmarksPage'
import { JuriTeamDetailPage } from './pages/juri/JuriTeamDetailPage'
import { JuriTeamsPage } from './pages/juri/JuriTeamsPage'
import { ConsentPage } from './pages/auth/ConsentPage'
import { LoginPage } from './pages/auth/LoginPage'
import { RegisterPage } from './pages/auth/RegisterPage'
import { ParticipantDashboardPage } from './pages/participant/ParticipantDashboardPage'
import { ProfilePage } from './pages/participant/ProfilePage'
import { EncryptionInspectorPage } from './pages/participant/EncryptionInspectorPage'
import { useAuthStore } from './stores/authStore'

function WorkspaceHome() {
  const user = useAuthStore((state) => state.user)
  const { data, isLoading, isError } = useQuery<PublicSettings>({
    queryKey: ['settings'],
    queryFn: ({ signal }) => apiClient.public.getSettings(signal),
  })

  return (
    <section className="rounded-2xl border border-[#243049] bg-[#141d2e] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.45)] sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Platform Pendaftaran Schematics NIC
        </h1>
        <span
          data-testid="api-mode-badge"
          className="rounded-full border border-[#243049] bg-[#0e1626] px-3 py-1 text-xs font-medium text-slate-200"
        >
          {env.enableMsw ? 'MSW Mock Mode' : 'API Proxy Mode'}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-400">
        Triple-cipher encrypted registration &amp; submission workspace (AES-CTR, DES-CTR, RC4 +
        HMAC-SHA256).
      </p>

      <div className="mt-5 rounded-xl border border-[#243049] bg-[#0e1626] p-4 text-sm text-slate-300">
        {isLoading && <p className="text-slate-400">Loading competition settings...</p>}
        {isError && (
          <p className="text-amber-300">
            Backend API not yet reachable on <code>/api/settings</code> (start Flask or run with{' '}
            <code>VITE_ENABLE_MSW=true</code>).
          </p>
        )}
        {data && (
          <dl className="grid gap-3 sm:grid-cols-3" data-testid="settings-summary">
            <div>
              <dt className="text-xs text-slate-400">Team Size</dt>
              <dd className="mt-0.5 font-medium text-white">
                {data.min_team_size}–{data.max_team_size} members
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Max Document / Proposal</dt>
              <dd className="mt-0.5 font-medium text-white">
                {Math.round(data.limits.document_max_bytes / 1_048_576)} MB /{' '}
                {Math.round(data.limits.proposal_max_bytes / 1_048_576)} MB
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Max Demo Video</dt>
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
              className="rounded-xl bg-gradient-to-r from-cyan-400 to-sky-500 px-4 py-2.5 text-sm font-medium text-slate-950 transition hover:from-cyan-300 hover:to-sky-400"
            >
              Masuk
            </Link>
            <Link
              to="/register"
              className="rounded-xl border border-[#243049] bg-[#0e1626] px-4 py-2 text-sm font-medium text-white transition hover:border-cyan-400/60"
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
            className="rounded-xl bg-gradient-to-r from-cyan-400 to-sky-500 px-4 py-2.5 text-sm font-medium text-slate-950 transition hover:from-cyan-300 hover:to-sky-400"
          >
            Buka Dashboard
          </Link>
        )}
      </div>
    </section>
  )
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
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
              {/* Documents, team and video now live on the dashboard itself.
                  The old routes stay as redirects so saved links keep working. */}
              <Route path="/documents" element={<Navigate to="/dashboard" replace />} />
              <Route path="/team" element={<Navigate to="/dashboard" replace />} />
              <Route path="/video" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Route>

          {/* Shared Encryption Inspector (all authenticated roles; peserta gated by ConsentGuard) */}
          <Route element={<RoleGuard allowedRoles={['peserta', 'juri', 'superadmin']} />}>
            <Route element={<ConsentGuard />}>
              <Route path="/encryption-inspector" element={<EncryptionInspectorPage />} />
            </Route>
          </Route>

          {/* Juri routes */}
          <Route element={<RoleGuard allowedRoles={['juri']} />}>
            <Route path="/juri/teams" element={<JuriTeamsPage />} />
            <Route path="/juri/teams/:teamId" element={<JuriTeamDetailPage />} />
          </Route>

          {/* Superadmin routes */}
          <Route element={<RoleGuard allowedRoles={['superadmin']} />}>
            <Route path="/admin/participants" element={<AdminParticipantsPage />} />
            <Route
              path="/admin/participants/:userId"
              element={<AdminParticipantDetailPage />}
            />
            <Route path="/admin/teams" element={<AdminTeamsPage />} />
            <Route path="/admin/juri" element={<AdminJuriPage />} />
            <Route path="/admin/settings" element={<AdminSettingsPage />} />
            <Route path="/admin/audit-logs" element={<AdminAuditLogsPage />} />
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
