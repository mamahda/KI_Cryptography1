import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Check,
  Copy,
  Crown,
  DoorOpen,
  FileCheck2,
  Lock,
  LogIn,
  RefreshCw,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { apiClient, isApiClientError, type Team, type TeamMember } from '@/api'
import { validateInviteCode, validateTeamName } from '@/lib/teamValidation'
import { useAuthStore } from '@/stores/authStore'

const TEAM_STATUS_COPY: Record<Team['status'], { label: string; className: string }> = {
  draft: {
    label: 'Draft',
    className: 'border-amber-500/30 bg-amber-950/30 text-amber-200',
  },
  final: {
    label: 'Final (Terkunci)',
    className: 'border-emerald-500/30 bg-emerald-950/30 text-emerald-200',
  },
}

/** Which destructive action is awaiting its second confirmation click. */
type PendingConfirm = { kind: 'leave' } | { kind: 'kick'; userId: string } | null

function describeError(error: unknown, fallback: string): string {
  return isApiClientError(error) ? error.message : fallback
}

function isMemberReady(member: TeamMember): boolean {
  return member.profile_complete && member.documents_complete
}

function ReadinessChip({ ready, label }: { ready: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
        ready
          ? 'border-emerald-500/30 bg-emerald-950/30 text-emerald-200'
          : 'border-[#2a2a2a] bg-[#121212] text-zinc-500'
      }`}
    >
      {ready ? (
        <Check className="h-3 w-3" aria-hidden="true" />
      ) : (
        <X className="h-3 w-3" aria-hidden="true" />
      )}
      {label}
    </span>
  )
}

export function TeamWorkspacePage() {
  const queryClient = useQueryClient()
  const currentUserId = useAuthStore((state) => state.user?.id ?? null)

  const [teamName, setTeamName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null)
  const [codeCopied, setCodeCopied] = useState(false)

  const teamQuery = useQuery({
    queryKey: ['team', 'me'],
    queryFn: ({ signal }) => apiClient.teams.getMine(signal),
  })

  const team = teamQuery.data?.team ?? null
  const isLeader = Boolean(team && currentUserId && team.leader_id === currentUserId)
  const isLocked = team?.status === 'final'
  const readyMembersCount = team ? team.members.filter(isMemberReady).length : 0

  function applyTeam(next: Team | null) {
    queryClient.setQueryData(['team', 'me'], { team: next })
    setPendingConfirm(null)
    setActionError(null)
  }

  const createMutation = useMutation({
    mutationFn: (name: string) => apiClient.teams.create({ name }),
    onSuccess: ({ team: created }) => {
      setTeamName('')
      applyTeam(created)
    },
    onError: (error) => setFormError(describeError(error, 'Tim gagal dibuat. Coba lagi.')),
  })

  const joinMutation = useMutation({
    mutationFn: (code: string) => apiClient.teams.join({ code }),
    onSuccess: ({ team: joined }) => {
      setInviteCode('')
      applyTeam(joined)
    },
    onError: (error) =>
      setFormError(describeError(error, 'Gagal bergabung ke tim. Periksa kode tim.')),
  })

  const leaveMutation = useMutation({
    mutationFn: () => apiClient.teams.leave(),
    onSuccess: () => applyTeam(null),
    onError: (error) => {
      setPendingConfirm(null)
      setActionError(describeError(error, 'Gagal keluar dari tim.'))
    },
  })

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => apiClient.teams.removeMember(userId),
    onSuccess: (_result, userId) => {
      if (team) {
        applyTeam({ ...team, members: team.members.filter((m) => m.user_id !== userId) })
      }
    },
    onError: (error) => {
      setPendingConfirm(null)
      setActionError(describeError(error, 'Gagal mengeluarkan anggota.'))
    },
  })

  const isBusy =
    createMutation.isPending ||
    joinMutation.isPending ||
    leaveMutation.isPending ||
    removeMemberMutation.isPending

  function handleCreate(event: FormEvent) {
    event.preventDefault()
    setActionError(null)
    const error = validateTeamName(teamName)
    if (error) {
      setFormError(error)
      return
    }
    setFormError(null)
    createMutation.mutate(teamName.trim())
  }

  function handleJoin(event: FormEvent) {
    event.preventDefault()
    setActionError(null)
    const error = validateInviteCode(inviteCode)
    if (error) {
      setFormError(error)
      return
    }
    setFormError(null)
    joinMutation.mutate(inviteCode.trim())
  }

  async function handleCopyCode() {
    if (!team) {
      return
    }
    try {
      await navigator.clipboard.writeText(team.code)
      setCodeCopied(true)
      window.setTimeout(() => setCodeCopied(false), 2000)
    } catch {
      setActionError('Kode tim gagal disalin. Salin manual dari kotak kode.')
    }
  }

  if (teamQuery.isLoading) {
    return (
      <section
        data-testid="team-workspace-page"
        className="rounded-xl border border-[#222] bg-[#121212] p-6 text-sm text-zinc-400"
      >
        Memuat data tim...
      </section>
    )
  }

  if (teamQuery.isError) {
    return (
      <section
        data-testid="team-workspace-page"
        className="rounded-xl border border-[#222] bg-[#121212] p-6"
      >
        <div
          data-testid="team-error-alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-200"
        >
          <span>{describeError(teamQuery.error, 'Data tim gagal dimuat.')}</span>
          <button
            type="button"
            onClick={() => void teamQuery.refetch()}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-red-500/40 px-2.5 py-1.5 text-xs font-medium text-red-100 transition hover:bg-red-950/50"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Coba Muat Ulang
          </button>
        </div>
      </section>
    )
  }

  return (
    <section data-testid="team-workspace-page" className="space-y-5">
      <header className="rounded-xl border border-[#222] bg-[#121212] p-6 shadow-[0_10px_40px_rgba(0,0,0,0.8)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Team &amp; Submission Workspace
            </h1>
            <p className="mt-1.5 text-sm text-zinc-400">
              Buat tim baru atau gabung dengan kode tim 8 karakter dari ketua tim Anda.
            </p>
          </div>
          <Users className="h-8 w-8 text-zinc-600" aria-hidden="true" />
        </div>
      </header>

      {actionError && (
        <div
          data-testid="team-error-alert"
          className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{actionError}</span>
        </div>
      )}

      {!team ? (
        <div data-testid="team-empty-state" className="grid gap-5 md:grid-cols-2">
          <form
            onSubmit={handleCreate}
            className="rounded-xl border border-[#222] bg-[#121212] p-6 shadow-[0_10px_40px_rgba(0,0,0,0.8)]"
          >
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
              <UserPlus className="h-4.5 w-4.5 text-zinc-400" aria-hidden="true" />
              Buat Tim Baru
            </h2>
            <p className="mt-1.5 text-sm text-zinc-400">
              Anda akan menjadi ketua tim dan menerima kode tim untuk dibagikan.
            </p>

            <label htmlFor="team-name" className="mt-4 block text-sm font-medium text-zinc-300">
              Nama Tim
            </label>
            <input
              id="team-name"
              name="name"
              type="text"
              value={teamName}
              maxLength={50}
              onChange={(event) => setTeamName(event.target.value)}
              placeholder="Tim Garuda"
              className="mt-1.5 w-full rounded-md border border-[#333] bg-black px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-zinc-500"
            />

            <button
              type="submit"
              disabled={isBusy}
              className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-[#ededed] px-4 py-2 text-sm font-medium text-black transition hover:bg-white disabled:opacity-50"
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              {createMutation.isPending ? 'Membuat Tim...' : 'Buat Tim'}
            </button>
          </form>

          <form
            onSubmit={handleJoin}
            className="rounded-xl border border-[#222] bg-[#121212] p-6 shadow-[0_10px_40px_rgba(0,0,0,0.8)]"
          >
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
              <LogIn className="h-4.5 w-4.5 text-zinc-400" aria-hidden="true" />
              Gabung Tim
            </h2>
            <p className="mt-1.5 text-sm text-zinc-400">
              Masukkan kode tim 8 karakter. Huruf besar-kecil tidak dibedakan.
            </p>

            <label
              htmlFor="invite-code-input"
              className="mt-4 block text-sm font-medium text-zinc-300"
            >
              Kode Tim
            </label>
            <input
              id="invite-code-input"
              name="code"
              type="text"
              value={inviteCode}
              maxLength={8}
              autoComplete="off"
              onChange={(event) => setInviteCode(event.target.value)}
              placeholder="K7M2Q9XA"
              className="mt-1.5 w-full rounded-md border border-[#333] bg-black px-3 py-2 font-mono text-sm tracking-widest text-zinc-100 uppercase outline-none transition focus:border-zinc-500"
            />

            <button
              type="submit"
              disabled={isBusy}
              className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#333] bg-black px-4 py-2 text-sm font-medium text-white transition hover:border-zinc-500 disabled:opacity-50"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              {joinMutation.isPending ? 'Menggabungkan...' : 'Gabung Tim'}
            </button>
          </form>

          {formError && (
            <p
              data-testid="team-form-error"
              className="rounded-lg border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-200 md:col-span-2"
            >
              {formError}
            </p>
          )}
        </div>
      ) : (
        <div
          data-testid="team-card"
          className="rounded-xl border border-[#222] bg-[#121212] p-6 shadow-[0_10px_40px_rgba(0,0,0,0.8)]"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-white">{team.name}</h2>
              <p className="mt-1 text-xs text-zinc-400">
                Peran Anda: {isLeader ? 'Ketua Tim' : 'Anggota'}
              </p>
            </div>
            <span
              data-testid="team-status-badge"
              className={`rounded-full border px-3 py-1 text-xs font-medium ${TEAM_STATUS_COPY[team.status].className}`}
            >
              {TEAM_STATUS_COPY[team.status].label}
            </span>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-[#222] bg-black px-3.5 py-3">
            <div>
              <p className="text-xs text-zinc-500">Kode Tim</p>
              <code
                data-testid="invite-code"
                className="mt-0.5 block rounded bg-[#18181b] px-2 py-1 font-mono text-base tracking-[0.3em] text-zinc-100"
              >
                {team.code}
              </code>
            </div>
            <button
              type="button"
              onClick={() => void handleCopyCode()}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#333] bg-[#121212] px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-zinc-500 hover:text-white"
            >
              {codeCopied ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {codeCopied ? 'Tersalin' : 'Salin Kode'}
            </button>
          </div>

          {isLocked && (
            <p
              data-testid="team-locked-notice"
              className="mt-4 flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-3.5 py-3 text-sm text-emerald-200"
            >
              <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              Tim sudah final dan terkunci untuk penjurian. Keanggotaan tidak dapat diubah lagi.
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-zinc-300">Kesiapan Anggota</h3>
            <span
              data-testid="member-readiness-summary"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-300"
            >
              <FileCheck2 className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
              {readyMembersCount}/{team.members.length} anggota lengkap
            </span>
          </div>

          <ul data-testid="member-list" className="mt-2 space-y-2">
            {team.members.map((member) => {
              const displayName = member.full_name ?? 'Peserta tanpa nama'
              const isSelf = member.user_id === currentUserId
              const confirmingKick =
                pendingConfirm?.kind === 'kick' && pendingConfirm.userId === member.user_id

              return (
                <li
                  key={member.user_id}
                  data-testid="member-row"
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#222] bg-black px-3.5 py-2.5 text-sm"
                >
                  <span className="flex flex-wrap items-center gap-2 text-zinc-200">
                    {displayName}
                    {member.is_leader && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-950/30 px-2 py-0.5 text-xs text-amber-200">
                        <Crown className="h-3 w-3" aria-hidden="true" />
                        Ketua
                      </span>
                    )}
                    {isSelf && <span className="text-xs text-zinc-500">(Anda)</span>}
                    <ReadinessChip ready={member.profile_complete} label="Profil" />
                    <ReadinessChip ready={member.documents_complete} label="Dokumen" />
                  </span>

                  {isLeader && !isLocked && !member.is_leader && (
                    <span className="flex items-center gap-2">
                      {confirmingKick ? (
                        <>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => removeMemberMutation.mutate(member.user_id)}
                            className="cursor-pointer rounded-md border border-red-500/40 bg-red-950/40 px-2.5 py-1 text-xs font-medium text-red-100 transition hover:bg-red-950/60 disabled:opacity-50"
                          >
                            Ya, Keluarkan
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingConfirm(null)}
                            className="cursor-pointer rounded-md border border-[#333] px-2.5 py-1 text-xs text-zinc-300 transition hover:border-zinc-500"
                          >
                            Batal
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          aria-label={`Keluarkan ${displayName}`}
                          onClick={() =>
                            setPendingConfirm({ kind: 'kick', userId: member.user_id })
                          }
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#333] px-2.5 py-1 text-xs text-zinc-300 transition hover:border-red-500/50 hover:text-red-200"
                        >
                          <UserMinus className="h-3.5 w-3.5" aria-hidden="true" />
                          Keluarkan
                        </button>
                      )}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>

          {!isLocked && (
            <div className="mt-6 border-t border-[#222] pt-4">
              {isLeader ? (
                // The contract has no leader exit: POST /api/teams/me/leave answers
                // 409 leader_cannot_leave, so offer no button that can only fail.
                <p data-testid="leader-cannot-leave-notice" className="text-xs text-zinc-400">
                  Sebagai ketua, Anda tidak dapat keluar dari tim. Keluarkan anggota lain lebih
                  dahulu bila tim perlu dibubarkan.
                </p>
              ) : pendingConfirm?.kind === 'leave' ? (
                <div className="flex flex-wrap items-center gap-2.5">
                  <p className="text-sm text-zinc-300">
                    Keluar dari tim ini? Anda bisa bergabung lagi dengan kode tim.
                  </p>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => leaveMutation.mutate()}
                    className="cursor-pointer rounded-md border border-red-500/40 bg-red-950/40 px-3 py-1.5 text-xs font-medium text-red-100 transition hover:bg-red-950/60 disabled:opacity-50"
                  >
                    Ya, Keluar
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingConfirm(null)}
                    className="cursor-pointer rounded-md border border-[#333] px-3 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-500"
                  >
                    Batal
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setPendingConfirm({ kind: 'leave' })}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#333] px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-red-500/50 hover:text-red-200"
                >
                  <DoorOpen className="h-3.5 w-3.5" aria-hidden="true" />
                  Keluar dari Tim
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
