import { useQuery } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { buildApiUrl, env } from './config/env'
import { BenchmarksPage } from './pages/admin/BenchmarksPage'
import { useAuthStore } from './stores/authStore'
import { useUiStore } from './stores/uiStore'

interface PublicSettings {
  registration_deadline: string
  submission_deadline: string
  min_team_size: number
  max_team_size: number
  limits: {
    document_max_bytes: number
    proposal_max_bytes: number
    video_max_bytes: number
  }
}

function AppShellLayout() {
  const user = useAuthStore((state) => state.user)
  const notices = useUiStore((state) => state.notices)

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold text-slate-900">
            <ShieldCheck className="h-5 w-5 text-indigo-600" aria-hidden="true" />
            <span>Schematics NIC</span>
          </Link>
          <nav aria-label="Primary navigation" className="flex flex-wrap items-center gap-4 text-sm">
            <Link to="/login" className="text-slate-600 hover:text-slate-900">
              Login
            </Link>
            <Link to="/dashboard" className="text-slate-600 hover:text-slate-900">
              Dashboard
            </Link>
            <Link to="/team" className="text-slate-600 hover:text-slate-900">
              Team Workspace
            </Link>
            <Link to="/documents" className="text-slate-600 hover:text-slate-900">
              Documents
            </Link>
            <Link to="/video" className="text-slate-600 hover:text-slate-900">
              Video Upload
            </Link>
            <Link to="/encryption-inspector" className="text-slate-600 hover:text-slate-900">
              Encryption Inspector
            </Link>
            <Link to="/juri/teams" className="text-slate-600 hover:text-slate-900">
              Juri
            </Link>
            <Link to="/admin/participants" className="text-slate-600 hover:text-slate-900">
              Superadmin
            </Link>
          </nav>
          <div className="text-xs text-slate-500" data-testid="session-badge">
            {user ? `${user.email} (${user.role})` : 'Guest'}
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
  const { data, isLoading, isError } = useQuery<PublicSettings>({
    queryKey: ['settings'],
    queryFn: async () => {
      const response = await fetch(buildApiUrl('/api/settings'), {
        credentials: 'include',
      })
      if (!response.ok) {
        throw new Error(`Failed to load settings: ${response.status}`)
      }
      return response.json() as Promise<PublicSettings>
    },
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
        <Route
          path="/login"
          element={
            <RoutePlaceholder
              title="Login & Registration"
              description="Authentication & privacy consent entry point (Phase 1)."
            />
          }
        />
        <Route
          path="/consent"
          element={
            <RoutePlaceholder
              title="Privacy Notice & Consent"
              description="Explicit UU PDP Pasal 20 consent gate (Phase 1)."
            />
          }
        />
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
        <Route
          path="/encryption-inspector"
          element={
            <RoutePlaceholder
              title="Encryption & Integrity Inspector"
              description="Triple-cipher metadata, live server verification, and SHA-256 checksum (Phase 4)."
            />
          }
        />
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
