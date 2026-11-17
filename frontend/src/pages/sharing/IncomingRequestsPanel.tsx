import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Download, Inbox } from 'lucide-react'
import { useState } from 'react'
import {
  isApiClientError,
  MAX_SHARED_ITEMS,
  sharingApi,
  type SharingRequest,
} from '@/api'
import { BTN_PRIMARY, BTN_SECONDARY, CARD, RECESSED, SECTION_HEADING, WELL } from '@/components/ui/tokens'
import { formatTimestamp } from '@/lib/datetime'
import { downloadJson } from './download'
import { ErrorNote, fieldLabel, formatBytes, RequestStatusBadge, shortId } from './shared'

export const SHARING_INCOMING_QUERY_KEY = ['sharing', 'incoming'] as const

function messageOf(error: unknown, fallback: string): string {
  return isApiClientError(error) ? error.message : fallback
}

/** The owner picks which items to share for one pending request, then approves or rejects it. */
function DecisionForm({ request }: { request: SharingRequest }) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string[]>([])

  const itemsQuery = useQuery({
    queryKey: ['sharing', 'available-items', request.id],
    queryFn: ({ signal }) => sharingApi.listAvailableItems(request.id, signal),
  })

  const decided = () =>
    queryClient.invalidateQueries({ queryKey: SHARING_INCOMING_QUERY_KEY })

  const approveMutation = useMutation({
    mutationFn: () => sharingApi.approve(request.id, { item_ids: selected }),
    onSuccess: decided,
  })
  const rejectMutation = useMutation({
    mutationFn: () => sharingApi.reject(request.id),
    onSuccess: decided,
  })

  const items = itemsQuery.data?.items ?? []
  const busy = approveMutation.isPending || rejectMutation.isPending
  const actionError = approveMutation.isError
    ? messageOf(approveMutation.error, 'Gagal menyetujui permintaan.')
    : rejectMutation.isError
      ? messageOf(rejectMutation.error, 'Gagal menolak permintaan.')
      : null

  function toggle(itemId: string) {
    setSelected((current) =>
      current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId],
    )
  }

  return (
    <div className={`mt-3 ${RECESSED} p-3`}>
      <p className="text-sm text-ink-2">
        Pilih data yang boleh dilihat peminta (maksimal {MAX_SHARED_ITEMS} item). Data yang tidak
        dipilih tetap tidak dapat dibuka.
      </p>

      {itemsQuery.isPending ? <p className="mt-2 text-sm text-ink-3">Memuat data Anda...</p> : null}
      {itemsQuery.isError ? (
        <ErrorNote message={messageOf(itemsQuery.error, 'Gagal memuat daftar data.')} />
      ) : null}

      {itemsQuery.isSuccess && items.length === 0 ? (
        <p className="mt-2 text-sm text-ink-3">Anda belum punya data yang dapat dibagikan.</p>
      ) : null}

      {items.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {items.map((item) => {
            const checked = selected.includes(item.item_id)
            const limitReached = !checked && selected.length >= MAX_SHARED_ITEMS
            return (
              <li key={item.item_id}>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
                  <input
                    type="checkbox"
                    data-testid={`share-item-${item.item_id}`}
                    checked={checked}
                    disabled={!item.aes_available || limitReached}
                    onChange={() => toggle(item.item_id)}
                  />
                  <span className="font-medium text-ink">{fieldLabel(item.field)}</span>
                  <span className="text-ink-3">
                    {formatBytes(item.size_bytes)}
                    {item.aes_available ? '' : ' · ciphertext AES tidak tersedia'}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          data-testid={`approve-btn-${request.id}`}
          disabled={selected.length === 0 || busy}
          onClick={() => approveMutation.mutate()}
          className={BTN_PRIMARY}
        >
          {approveMutation.isPending ? 'Menyetujui...' : `Setujui (${selected.length})`}
        </button>
        <button
          type="button"
          data-testid={`reject-btn-${request.id}`}
          disabled={busy}
          onClick={() => rejectMutation.mutate()}
          className={BTN_SECONDARY}
        >
          {rejectMutation.isPending ? 'Menolak...' : 'Tolak'}
        </button>
      </div>
      {actionError ? <ErrorNote message={actionError} testId={`decision-error-${request.id}`} /> : null}
    </div>
  )
}

/** For an approved request the owner downloads the key file and sends it to the recipient themselves. */
function KeyFileDownload({ request }: { request: SharingRequest }) {
  const downloadMutation = useMutation({
    mutationFn: async () => {
      const keyFile = await sharingApi.getKeyFile(request.id)
      downloadJson(`schematics-share-keys-${shortId(request.id)}.json`, JSON.stringify(keyFile, null, 2))
    },
  })

  return (
    <div className="mt-3 space-y-2">
      <button
        type="button"
        data-testid={`keyfile-btn-${request.id}`}
        disabled={downloadMutation.isPending}
        onClick={() => downloadMutation.mutate()}
        className={BTN_SECONDARY}
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        {downloadMutation.isPending ? 'Mengunduh...' : 'Unduh file kunci'}
      </button>
      <p className="text-xs text-ink-3">
        Kirim file ini sendiri kepada peminta lewat WhatsApp atau email; aplikasi tidak
        mengirimnya. Isinya kunci data yang dienkripsi dengan public key peminta, jadi hanya
        private key peminta yang dapat membukanya.
      </p>
      {downloadMutation.isError ? (
        <ErrorNote message={messageOf(downloadMutation.error, 'Gagal mengunduh file kunci.')} />
      ) : null}
    </div>
  )
}

function IncomingRequestRow({ request }: { request: SharingRequest }) {
  const [open, setOpen] = useState(false)

  return (
    <li data-testid={`incoming-request-${request.id}`} className={`${WELL} px-3 py-2.5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">
            Dari peserta <code className="font-mono text-ink-2">{shortId(request.requester_id)}</code>
          </p>
          <p className="text-xs text-ink-3">Diminta {formatTimestamp(request.created_at)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RequestStatusBadge status={request.status} />
          {request.status === 'pending' ? (
            <button
              type="button"
              data-testid={`review-btn-${request.id}`}
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
              className={BTN_SECONDARY}
            >
              Tinjau
              <ChevronDown
                className={`h-4 w-4 transition ${open ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
          ) : null}
        </div>
      </div>

      {request.status === 'pending' && open ? <DecisionForm request={request} /> : null}
      {request.status === 'approved' ? <KeyFileDownload request={request} /> : null}
    </li>
  )
}

export function IncomingRequestsPanel() {
  const incomingQuery = useQuery({
    queryKey: SHARING_INCOMING_QUERY_KEY,
    queryFn: ({ signal }) => sharingApi.listIncoming(signal),
  })
  const requests = incomingQuery.data?.requests ?? []

  return (
    <section
      className={`${CARD} p-6`}
      aria-labelledby="sharing-incoming-heading"
      data-testid="sharing-incoming-panel"
    >
      <h2 id="sharing-incoming-heading" className={SECTION_HEADING}>
        Permintaan masuk
      </h2>

      {incomingQuery.isPending ? <p className="mt-3 text-sm text-ink-3">Memuat permintaan...</p> : null}
      {incomingQuery.isError ? (
        <ErrorNote message={messageOf(incomingQuery.error, 'Gagal memuat permintaan masuk.')} />
      ) : null}

      {incomingQuery.isSuccess ? (
        requests.length > 0 ? (
          <ul data-testid="incoming-requests-list" className="mt-3 space-y-2">
            {requests.map((request) => (
              <IncomingRequestRow key={request.id} request={request} />
            ))}
          </ul>
        ) : (
          <div className={`mt-3 ${WELL} flex flex-col items-center gap-2 px-4 py-8 text-center`}>
            <Inbox className="h-6 w-6 text-ink-3" aria-hidden="true" />
            <p className="text-sm font-medium text-ink-2">Belum ada permintaan masuk</p>
          </div>
        )
      ) : null}
    </section>
  )
}
