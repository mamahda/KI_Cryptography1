import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Inbox, Lock, PenLine, Users } from 'lucide-react'
import { useState } from 'react'
import { apiClient, isApiClientError, type TeamStatus } from '@/api'
import { Pagination } from '@/components/ui/Pagination'
import { CARD, TD, TH, WELL } from '@/components/ui/tokens'
import { formatTimestamp } from '@/lib/datetime'

const TEAM_STATUS_COPY: Record<TeamStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'border-amber-500/30 bg-amber-950/30 text-amber-200' },
  final: {
    label: 'Final (terkunci)',
    className: 'border-emerald-500/30 bg-emerald-950/30 text-emerald-200',
  },
}

const PAGE_SIZE = 25

export function AdminTeamsPage() {
  const [page, setPage] = useState(1)

  const teamsQuery = useQuery({
    queryKey: ['admin', 'teams', page],
    queryFn: ({ signal }) =>
      apiClient.admin.listTeams({ page, page_size: PAGE_SIZE }, signal),
  })

  const rows = teamsQuery.data?.items ?? []

  return (
    <div data-testid="admin-teams-page" className="space-y-6">
      <header className={`${CARD} p-6`}>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#243049] bg-[#0e1626] px-3 py-1 text-xs font-medium text-slate-300">
          <Users className="h-3.5 w-3.5 text-slate-100" aria-hidden="true" />
          Superadmin
        </span>
        <h1 className="mt-2.5 text-2xl font-bold tracking-tight text-white">Daftar Tim</h1>
        <p className="mt-1.5 max-w-prose text-sm text-slate-400">
          Seluruh tim yang terbentuk, baik yang masih draft maupun yang sudah mengunci
          submission-nya.
        </p>
      </header>

      <section className={`${CARD} p-6`} aria-labelledby="admin-teams-heading">
        <h2 id="admin-teams-heading" className="text-lg font-semibold text-white">
          Tim terdaftar
        </h2>

        {teamsQuery.isPending ? (
          <p data-testid="admin-teams-loading" className="mt-3 text-sm text-slate-400">
            Memuat daftar tim...
          </p>
        ) : null}

        {teamsQuery.isError ? (
          <p
            data-testid="admin-teams-error"
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-950/30 px-3 py-2.5 text-sm text-red-200"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {isApiClientError(teamsQuery.error)
                ? teamsQuery.error.message
                : 'Gagal memuat daftar tim.'}
            </span>
          </p>
        ) : null}

        {teamsQuery.isSuccess && rows.length === 0 ? (
          <div
            data-testid="admin-teams-empty-state"
            className={`mt-3 ${WELL} flex flex-col items-center gap-2 px-4 py-10 text-center`}
          >
            <Inbox className="h-6 w-6 text-slate-400" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-200">Belum ada tim yang terbentuk</p>
          </div>
        ) : null}

        {rows.length > 0 ? (
          <>
            <div className={`mt-3 ${WELL} overflow-x-auto`}>
              <table data-testid="admin-teams-table" className="w-full border-collapse">
                <caption className="sr-only">
                  Tim beserta status, ketua, jumlah anggota, dan waktu finalisasi
                </caption>
                <thead>
                  <tr className="border-b border-[#243049]">
                    <th scope="col" className={TH}>
                      Nama tim
                    </th>
                    <th scope="col" className={TH}>
                      Status
                    </th>
                    <th scope="col" className={TH}>
                      Ketua
                    </th>
                    <th scope="col" className={TH}>
                      Anggota
                    </th>
                    <th scope="col" className={TH}>
                      Final pada
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((team) => {
                    const status = TEAM_STATUS_COPY[team.status]
                    const StatusIcon = team.status === 'final' ? Lock : PenLine
                    return (
                      <tr
                        key={team.id}
                        data-testid={`admin-team-row-${team.id}`}
                        className="border-b border-[#1e293f] last:border-b-0"
                      >
                        <td className={`${TD} font-medium text-slate-100`}>{team.name}</td>
                        <td className={TD}>
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${status.className}`}
                          >
                            <StatusIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
                            {status.label}
                          </span>
                        </td>
                        <td className={TD}>{team.leader_name ?? '—'}</td>
                        <td className={`${TD} tabular-nums`}>{team.member_count}</td>
                        <td className={TD}>
                          {team.finalized_at ? formatTimestamp(team.finalized_at) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <Pagination
              testId="admin-teams-pagination"
              page={teamsQuery.data?.page ?? page}
              pageSize={teamsQuery.data?.page_size ?? PAGE_SIZE}
              total={teamsQuery.data?.total ?? rows.length}
              onPageChange={setPage}
            />
          </>
        ) : null}
      </section>
    </div>
  )
}
