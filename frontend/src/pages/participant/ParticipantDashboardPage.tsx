import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  FileCheck2,
  FileText,
  Minus,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  Users,
  Video,
  XCircle,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  apiClient,
  type FinalizeMissingItem,
  type VerificationStatus,
} from '@/api'
import {
  computeCountdown,
  formatDeadlineDisplay,
  useLiveNow,
} from '@/lib/countdown'
import { useAuthStore } from '@/stores/authStore'

/**
 * Dashboard surfaces use two depths only. Cards are *elevated* (`#121212`) and
 * advance toward the reader; inset rows and quick-nav tiles are *recessed*
 * (black) and fall back. Muted text bottoms out at `zinc-400` (7.31:1 on an
 * elevated card, 8.19:1 on a recessed one) — `zinc-500` is 3.88:1 and is never
 * used for text or glyphs.
 *
 * Monospaced, tabular figures mark a value the server computed or verified:
 * the countdown, the policy version, the invite code, readiness counts. Prose
 * stays in the sans face.
 */
const CARD =
  'rounded-xl border border-[#222] bg-[#121212] shadow-[0_10px_40px_rgba(0,0,0,0.8)]'
const WELL = 'rounded-lg border border-[#222] bg-black'
const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-100'
const BTN_PRIMARY = `inline-flex items-center gap-1.5 rounded-md bg-[#ededed] px-4 py-2 text-sm font-semibold text-black transition hover:bg-white ${FOCUS}`
const BTN_SECONDARY = `inline-flex items-center gap-1.5 rounded-md border border-[#333] bg-black px-3.5 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:text-white ${FOCUS}`
const SECTION_HEADING = 'px-1 text-sm font-semibold tracking-wide text-zinc-200 uppercase'

const VERIFICATION_BADGE_MAP: Record<
  VerificationStatus,
  { label: string; className: string }
> = {
  belum_lengkap: {
    label: 'Belum Lengkap',
    className: 'border-zinc-700 bg-zinc-900 text-zinc-300',
  },
  menunggu: {
    label: 'Menunggu Verifikasi',
    className: 'border-amber-500/40 bg-amber-950/50 text-amber-200',
  },
  terverifikasi: {
    label: 'Terverifikasi',
    className: 'border-emerald-500/40 bg-emerald-950/50 text-emerald-200',
  },
  ditolak: {
    label: 'Ditolak',
    className: 'border-rose-500/40 bg-rose-950/50 text-rose-200',
  },
}

const FINALIZE_MISSING_LABELS: Record<FinalizeMissingItem, string> = {
  proposal: 'Proposal PDF belum diunggah',
  video: 'Video Demo MP4 belum diunggah',
  repo_url: 'URL Repositori GitHub belum disimpan',
  min_members: 'Jumlah anggota tim belum mencapai batas minimum',
  members_incomplete: 'Masih ada anggota yang belum melengkapi profil/dokumen',
}

interface StatusChipProps {
  label: string
  ready: boolean
}

/**
 * Readiness chip. The state is carried by a glyph and a screen-reader word in
 * addition to color, so it survives color blindness and increased contrast.
 */
function StatusChip({ label, ready }: StatusChipProps) {
  return (
    <div
      className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-center text-sm ${
        ready
          ? 'border-emerald-500/30 bg-emerald-950/30 text-emerald-200'
          : 'border-[#2a2a2a] bg-[#0a0a0a] text-zinc-400'
      }`}
    >
      {ready ? (
        <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <Minus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      )}
      <span>{label}</span>
      <span className="sr-only">{ready ? '— sudah ada' : '— belum ada'}</span>
    </div>
  )
}

interface CountdownCardProps {
  testId: string
  title: string
  subtitle: string
  deadlineIso: string | null
  nowMs: number
}

function DeadlineCountdownCard({
  testId,
  title,
  subtitle,
  deadlineIso,
  nowMs,
}: CountdownCardProps) {
  const snapshot = deadlineIso ? computeCountdown(deadlineIso, nowMs) : null
  const formattedDate = deadlineIso ? formatDeadlineDisplay(deadlineIso) : 'Belum ditetapkan'

  return (
    <div
      data-testid={testId}
      className={`flex flex-col justify-between ${CARD} p-5`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-400">
            <Clock className="h-4 w-4 text-zinc-300" aria-hidden="true" />
            <span>{subtitle}</span>
          </div>
          <h3 className="mt-1 text-base font-semibold text-white">{title}</h3>
        </div>

        {snapshot && (
          <span
            className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
              snapshot.expired
                ? 'border-rose-500/40 bg-rose-950/50 text-rose-200'
                : 'border-emerald-500/40 bg-emerald-950/50 text-emerald-200'
            }`}
          >
            {snapshot.expired ? 'Tenggat Terlewat' : 'Aktif'}
          </span>
        )}
      </div>

      {snapshot ? (
        <div className="mt-4 grid grid-cols-4 gap-2 text-center">
          {[
            { value: snapshot.days, unit: 'Hari' },
            { value: snapshot.hours, unit: 'Jam' },
            { value: snapshot.minutes, unit: 'Menit' },
            { value: snapshot.seconds, unit: 'Detik' },
          ].map((segment) => (
            <div
              key={segment.unit}
              className="rounded-lg border border-[#2a2a2a] bg-black px-1.5 py-2.5"
            >
              <div className="font-mono text-2xl font-semibold text-white tabular-nums sm:text-3xl">
                {String(segment.value).padStart(2, '0')}
              </div>
              <div className="mt-1 text-xs tracking-wider text-zinc-400 uppercase">
                {segment.unit}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-zinc-400">Format waktu tenggat tidak valid.</p>
      )}

      <p className="mt-3 text-sm text-zinc-400">
        Batas akhir: <span className="text-zinc-200">{formattedDate}</span>
      </p>
    </div>
  )
}

export function ParticipantDashboardPage() {
  const user = useAuthStore((state) => state.user)
  const nowMs = useLiveNow(1000)

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: ({ signal }) => apiClient.public.getSettings(signal),
  })

  const profileQuery = useQuery({
    queryKey: ['profile'],
    queryFn: ({ signal }) => apiClient.profile.get(signal),
  })

  const documentsQuery = useQuery({
    queryKey: ['documents'],
    queryFn: ({ signal }) => apiClient.documents.list(signal),
  })

  const teamQuery = useQuery({
    queryKey: ['teams', 'me'],
    queryFn: ({ signal }) => apiClient.teams.getMine(signal),
  })

  const isInitialLoading =
    settingsQuery.isLoading ||
    profileQuery.isLoading ||
    documentsQuery.isLoading ||
    teamQuery.isLoading

  // A refetch of already-cached data leaves `isLoading` false, so the refresh
  // button needs `isFetching` to acknowledge the click at all.
  const isRefreshing =
    settingsQuery.isFetching ||
    profileQuery.isFetching ||
    documentsQuery.isFetching ||
    teamQuery.isFetching

  const hasQueryError =
    settingsQuery.isError ||
    profileQuery.isError ||
    documentsQuery.isError ||
    teamQuery.isError

  function handleRetryAll() {
    void settingsQuery.refetch()
    void profileQuery.refetch()
    void documentsQuery.refetch()
    void teamQuery.refetch()
  }

  const profile = profileQuery.data
  const documents = documentsQuery.data
  const team = teamQuery.data?.team ?? null
  const settings = settingsQuery.data

  const verificationStatus: VerificationStatus =
    profile?.verification_status ?? user?.verification_status ?? 'belum_lengkap'
  const verificationBadge = VERIFICATION_BADGE_MAP[verificationStatus]

  const rejectionNote =
    profile?.verification_note ?? user?.verification_note ?? null

  const uploadedDocsCount = [documents?.ktp, documents?.ktm, documents?.twibbon].filter(
    Boolean,
  ).length

  const isTeamLeader = Boolean(team && user && team.leader_id === user.id)
  const readyMembersCount = team
    ? team.members.filter((m) => m.profile_complete && m.documents_complete).length
    : 0

  const quickNavItems = [
    {
      to: '/profile',
      title: 'Profil Pribadi',
      description: 'Kelola 7 field identitas mahasiswa yang dienkripsi tiga cipher.',
      icon: UserCheck,
      meta: profile?.profile_complete ? 'Lengkap' : 'Perlu dilengkapi',
    },
    {
      to: '/documents',
      title: 'Document Manager',
      description: 'Unggah, ganti, pratinjau, dan unduh scan KTP, KTM/KRSM, & Twibbon.',
      icon: FileText,
      meta: `${uploadedDocsCount}/3 dokumen`,
    },
    {
      to: '/team',
      title: 'Team Workspace',
      description: 'Buat atau gabung tim, unggah proposal PDF, simpan link GitHub, & submit final.',
      icon: Users,
      meta: team ? `${team.name} (${team.status})` : 'Belum bertim',
    },
    {
      to: '/video',
      title: 'Video Demo Upload',
      description: 'Unggah streaming MP4 hingga 100 MB, pratinjau blob utuh, dan unduh.',
      icon: Video,
      meta: team?.submission.video ? 'Terunggah' : 'Belum diunggah',
    },
    {
      to: '/encryption-inspector',
      title: 'Encryption Inspector',
      description: 'Periksa status proteksi 3-cipher (AES-CTR, DES-CTR, RC4 + HMAC) & SHA-256.',
      icon: ShieldCheck,
      meta: 'Verifikasi integritas',
    },
  ]

  return (
    <div className="space-y-8">
      {/* Top Header */}
      <header
        className={`flex flex-wrap items-start justify-between gap-4 ${CARD} p-6`}
      >
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#333] bg-black px-3 py-1 text-xs font-medium text-zinc-300">
            <ShieldCheck className="h-3.5 w-3.5 text-zinc-100" aria-hidden="true" />
            Schematics NIC · Ruang Peserta
          </span>
          <h1 className="mt-2.5 text-2xl font-bold tracking-tight text-white">
            Participant Dashboard
          </h1>
          <p className="mt-1.5 max-w-prose text-sm text-zinc-400">
            Selamat datang,{' '}
            <span className="font-medium text-zinc-200">
              {profile?.full_name || user?.full_name || user?.email || 'Peserta'}
            </span>
            . Pantau tenggat waktu, status verifikasi identitas, dan kesiapan karya tim Anda.
          </p>
        </div>

        <button
          type="button"
          onClick={handleRetryAll}
          disabled={isInitialLoading}
          aria-busy={isRefreshing}
          className={`cursor-pointer ${BTN_SECONDARY} disabled:opacity-50`}
        >
          <RefreshCw
            className={`h-4 w-4 ${isRefreshing ? 'motion-safe:animate-spin' : ''}`}
            aria-hidden="true"
          />
          Segarkan Status
        </button>
      </header>

      {/* Rejection Reason Alert (ditolak) */}
      {verificationStatus === 'ditolak' && (
        <section
          role="alert"
          data-testid="rejection-alert"
          className="rounded-xl border border-rose-500/40 bg-rose-950/35 p-5 text-rose-100 shadow-[0_10px_30px_rgba(0,0,0,0.6)]"
        >
          <div className="flex items-start gap-3">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" aria-hidden="true" />
            <div className="flex-1">
              <h2 className="text-base font-semibold text-white">
                Verifikasi Peserta Ditolak — Perlu Perbaikan
              </h2>
              <p className="mt-1.5 text-sm text-rose-200">
                {rejectionNote
                  ? `Catatan Superadmin: "${rejectionNote}"`
                  : 'Panitia menolak dokumen atau data diri Anda. Silakan periksa kembali profil dan unggah ulang dokumen identitas yang jelas.'}
              </p>
              <p className="mt-1.5 text-sm text-rose-200/90">
                Selama tenggat pendaftaran belum terlewat, mengunggah ulang dokumen atau
                memperbaiki profil akan mengembalikan status Anda ke{' '}
                <strong className="font-semibold text-white">Menunggu Verifikasi</strong>.
              </p>
              <div className="mt-4 flex flex-wrap gap-2.5">
                <Link to="/documents" className={BTN_PRIMARY}>
                  Unggah Ulang Dokumen
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  to="/profile"
                  className={`inline-flex items-center gap-1.5 rounded-md border border-rose-400/40 bg-black/60 px-3.5 py-2 text-sm font-semibold text-white transition hover:border-rose-300 ${FOCUS}`}
                >
                  Periksa Data Diri
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Async Error Banner */}
      {hasQueryError && (
        <section
          role="alert"
          data-testid="dashboard-error-alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-950/40 px-5 py-4 text-sm text-amber-200"
        >
          <div className="flex items-center gap-2.5">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
            <span>Sebagian data dashboard gagal dimuat dari server.</span>
          </div>
          <button
            type="button"
            onClick={handleRetryAll}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-amber-400/40 bg-black px-3.5 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-950 ${FOCUS}`}
          >
            <RefreshCw
              className={`h-4 w-4 ${isRefreshing ? 'motion-safe:animate-spin' : ''}`}
              aria-hidden="true"
            />
            Coba Muat Ulang
          </button>
        </section>
      )}

      {/* Initial Loading State */}
      {isInitialLoading && (
        <div
          role="status"
          data-testid="dashboard-loading"
          className={`flex items-center justify-center gap-2.5 ${CARD} p-6 text-sm text-zinc-300`}
        >
          <RefreshCw
            className="h-4 w-4 shrink-0 text-zinc-400 motion-safe:animate-spin"
            aria-hidden="true"
          />
          Memuat ringkasan pendaftaran, tenggat waktu, dan status tim...
        </div>
      )}

      {/* Live Deadline Countdowns (GET /api/settings) */}
      {settings && (
        <section aria-labelledby="deadlines-heading" className="space-y-3">
          <h2 id="deadlines-heading" className={SECTION_HEADING}>
            Tenggat Waktu Kompetisi
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <DeadlineCountdownCard
              testId="registration-countdown-card"
              subtitle="Pendaftaran & Dokumen"
              title="Tenggat Pendaftaran Peserta"
              deadlineIso={settings.registration_deadline}
              nowMs={nowMs}
            />
            <DeadlineCountdownCard
              testId="submission-countdown-card"
              subtitle="Proposal, Video & Finalisasi"
              title="Tenggat Pengumpulan Karya"
              deadlineIso={settings.submission_deadline}
              nowMs={nowMs}
            />
          </div>
        </section>
      )}

      {/* Dual Status Cards (Verification + Team) */}
      <section aria-labelledby="readiness-heading" className="space-y-3">
        <div className="px-1">
          <h2 id="readiness-heading" className="text-sm font-semibold tracking-wide text-zinc-200 uppercase">
            Status Verifikasi &amp; Kesiapan Tim
          </h2>
          <p className="mt-1 max-w-prose text-sm text-zinc-400">
            Verifikasi peserta dan status tim berjalan independen — tim boleh submit final
            sebelum verifikasi superadmin selesai.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Card 1: Participant Verification Status */}
          <article
            data-testid="verification-status-card"
            className={`flex flex-col justify-between ${CARD} p-6`}
          >
            <div>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#222] pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#333] bg-black text-white">
                    <FileCheck2 className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-white">
                      Status Verifikasi Peserta
                    </h3>
                    <p className="text-sm text-zinc-400">
                      Kelengkapan data diri &amp; 3 dokumen identitas
                    </p>
                  </div>
                </div>

                <span
                  data-testid="verification-status-badge"
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${verificationBadge.className}`}
                >
                  {verificationBadge.label}
                </span>
              </div>

              <ul className="mt-4 space-y-3 text-sm">
                <li className={`flex items-center justify-between gap-3 ${WELL} px-3.5 py-2.5`}>
                  <span className="text-zinc-300">Persetujuan Privasi UU PDP</span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 font-medium text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    <span className="font-mono tabular-nums">
                      v
                      {user?.consent?.policy_version ??
                        user?.current_policy_version ??
                        '1.0'}
                    </span>
                  </span>
                </li>

                <li className={`flex items-center justify-between gap-3 ${WELL} px-3.5 py-2.5`}>
                  <div className="min-w-0">
                    <p className="text-zinc-300">Data Diri Peserta (7 Field)</p>
                    {profile?.institution && (
                      <p className="mt-0.5 text-zinc-400">
                        {profile.full_name} · {profile.institution}
                      </p>
                    )}
                  </div>
                  {profile?.profile_complete ? (
                    <span className="inline-flex shrink-0 items-center gap-1.5 font-medium text-emerald-300">
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      Lengkap
                    </span>
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1.5 font-medium text-amber-300">
                      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                      Belum Lengkap
                    </span>
                  )}
                </li>

                <li className={`${WELL} px-3.5 py-3`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-zinc-300">Dokumen Identitas Wajib</span>
                    <span className="shrink-0 font-medium text-zinc-300 tabular-nums">
                      {uploadedDocsCount}/3 terunggah
                    </span>
                  </div>
                  <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {[
                      { key: 'ktp', label: 'Scan KTP', item: documents?.ktp },
                      { key: 'ktm', label: 'KTM / KRSM', item: documents?.ktm },
                      { key: 'twibbon', label: 'Twibbon', item: documents?.twibbon },
                    ].map((doc) => (
                      <StatusChip
                        key={doc.key}
                        label={doc.label}
                        ready={Boolean(doc.item)}
                      />
                    ))}
                  </div>
                </li>
              </ul>
            </div>

            <div className="mt-5 flex flex-wrap gap-2.5 pt-2">
              {!profile?.profile_complete ? (
                <Link to="/profile" className={BTN_PRIMARY}>
                  Lengkapi Profil
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              ) : (
                <Link to="/documents" className={BTN_PRIMARY}>
                  {documents?.documents_complete ? 'Kelola Dokumen' : 'Unggah Dokumen'}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              )}

              <Link to="/profile" className={BTN_SECONDARY}>
                Buka Profil
              </Link>
            </div>
          </article>

          {/* Card 2: Team & Submission Status */}
          <article
            data-testid="team-status-card"
            className={`flex flex-col justify-between ${CARD} p-6`}
          >
            <div>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#222] pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#333] bg-black text-white">
                    <Users className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-white">
                      Status Tim &amp; Submission
                    </h3>
                    <p className="text-sm text-zinc-400">
                      Formasi tim ({settings?.min_team_size ?? 2}–{settings?.max_team_size ?? 4}{' '}
                      anggota) &amp; pengumpulan karya
                    </p>
                  </div>
                </div>

                {!team ? (
                  <span
                    data-testid="team-status-badge"
                    className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-semibold text-zinc-300"
                  >
                    Belum Bertim
                  </span>
                ) : team.status === 'final' ? (
                  <span
                    data-testid="team-status-badge"
                    className="rounded-full border border-emerald-500/40 bg-emerald-950/50 px-3 py-1 text-xs font-semibold text-emerald-200"
                  >
                    Final (Terkunci)
                  </span>
                ) : (
                  <span
                    data-testid="team-status-badge"
                    className="rounded-full border border-sky-500/40 bg-sky-950/50 px-3 py-1 text-xs font-semibold text-sky-200"
                  >
                    Draft
                  </span>
                )}
              </div>

              {!team ? (
                <div className={`mt-4 ${WELL} p-4 text-sm text-zinc-300`}>
                  <p className="font-medium text-white">Anda belum tergabung dalam tim mana pun.</p>
                  <p className="mt-1 leading-relaxed text-zinc-400">
                    Buat tim baru untuk menjadi Ketua Tim dan memperoleh kode undangan 8 karakter,
                    atau gabung ke tim rekan Anda menggunakan kode tim yang sudah ada.
                  </p>
                </div>
              ) : (
                <div className="mt-4 space-y-3 text-sm">
                  <div
                    className={`flex flex-wrap items-center justify-between gap-2 ${WELL} px-3.5 py-2.5`}
                  >
                    <div>
                      <p className="font-semibold text-white">{team.name}</p>
                      <p className="mt-0.5 text-zinc-400">
                        Peran: {isTeamLeader ? 'Ketua Tim' : 'Anggota'} · Kode:{' '}
                        <code className="rounded bg-[#18181b] px-1.5 py-0.5 font-mono tracking-wider text-zinc-200">
                          {team.code}
                        </code>
                      </p>
                    </div>
                    <span className="font-medium text-zinc-300 tabular-nums">
                      {readyMembersCount}/{team.members.length} anggota lengkap
                    </span>
                  </div>

                  <div className={`${WELL} px-3.5 py-3`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-zinc-300">Komponen Karya Hackathon</span>
                      <span className="shrink-0 text-zinc-400">
                        {team.status === 'final' ? 'Terkunci untuk penjurian' : 'Dapat diperbarui'}
                      </span>
                    </div>
                    <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {[
                        {
                          key: 'proposal',
                          label: 'Proposal PDF',
                          ready: Boolean(team.submission.proposal),
                        },
                        {
                          key: 'video',
                          label: 'Video MP4',
                          ready: Boolean(team.submission.video),
                        },
                        {
                          key: 'repo',
                          label: 'Repo GitHub',
                          ready: Boolean(team.submission.repo_url),
                        },
                      ].map((artifact) => (
                        <StatusChip
                          key={artifact.key}
                          label={artifact.label}
                          ready={artifact.ready}
                        />
                      ))}
                    </div>
                  </div>

                  {team.status === 'draft' && team.finalize_missing.length > 0 && (
                    <div
                      data-testid="finalize-missing-list"
                      className="rounded-lg border border-[#222] bg-black/70 px-3.5 py-3 text-zinc-400"
                    >
                      <p className="font-medium text-zinc-300">Syarat menuju Submit Final:</p>
                      <ul className="mt-1.5 space-y-1">
                        {team.finalize_missing.map((item) => (
                          <li key={item} className="flex items-start gap-2">
                            <Minus
                              className="mt-1 h-3.5 w-3.5 shrink-0 text-amber-300"
                              aria-hidden="true"
                            />
                            <span>{FINALIZE_MISSING_LABELS[item]}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-5 flex flex-wrap gap-2.5 pt-2">
              <Link to="/team" className={BTN_PRIMARY}>
                {!team ? 'Buat atau Gabung Tim' : 'Buka Team Workspace'}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>

              {team && (
                <Link to="/video" className={BTN_SECONDARY}>
                  Video Demo
                </Link>
              )}
            </div>
          </article>
        </div>
      </section>

      {/* Quick Navigation Grid */}
      <section aria-labelledby="quicknav-heading" className="space-y-3">
        <h2 id="quicknav-heading" className={SECTION_HEADING}>
          Navigasi Cepat
        </h2>

        <div
          data-testid="quick-navigation-grid"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {quickNavItems.map((nav) => {
            const Icon = nav.icon
            return (
              <Link
                key={nav.to}
                to={nav.to}
                className={`group flex flex-col gap-3 rounded-xl border border-[#1c1c1c] bg-black p-5 transition hover:border-zinc-600 hover:bg-[#0c0c0c] ${FOCUS}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#333] bg-[#121212] text-zinc-100">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <span className="rounded-full border border-[#2a2a2a] bg-[#121212] px-2.5 py-0.5 text-xs text-zinc-400 tabular-nums">
                    {nav.meta}
                  </span>
                </div>

                <div>
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold text-white">
                    {nav.title}
                    <ArrowRight
                      className="h-4 w-4 shrink-0 text-zinc-400 transition group-hover:text-zinc-100 motion-safe:group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                    {nav.description}
                  </p>
                </div>
              </Link>
            )
          })}
        </div>
      </section>
    </div>
  )
}
