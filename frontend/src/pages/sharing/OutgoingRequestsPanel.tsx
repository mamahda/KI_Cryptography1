import { useMutation, useQuery } from '@tanstack/react-query'
import { ChevronDown, Download, FileUp, Inbox, LockOpen } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { isApiClientError, sharingApi, type SharingRequest } from '@/api'
import { BTN_PRIMARY, BTN_SECONDARY, CARD, INPUT, LABEL, RECESSED, SECTION_HEADING, WELL } from '@/components/ui/tokens'
import { formatTimestamp } from '@/lib/datetime'
import { useAuthStore } from '@/stores/authStore'
import { downloadBlob, readTextFile } from './download'
import { fieldLabel, shortId } from './format'
import { SHARING_KEY_QUERY_KEY, SHARING_OUTGOING_QUERY_KEY } from './queryKeys'
import {
  MAX_BACKUP_FILE_BYTES,
  MAX_KEY_FILE_BYTES,
  openSharedItems,
  type OpenedItem,
} from './openShared'
import { ErrorNote, RequestStatusBadge } from './shared'

const FILE_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function OpenedItemView({ item, imageUrl }: { item: OpenedItem; imageUrl: string | null }) {
  return (
    <li data-testid={`opened-item-${item.field}`} className={`${RECESSED} px-3 py-2.5`}>
      <p className="text-xs font-medium text-ink-3">{fieldLabel(item.field)}</p>
      {item.kind === 'text' ? <p className="mt-1 text-sm break-words text-ink">{item.text}</p> : null}
      {item.kind === 'image' && imageUrl ? (
        <img src={imageUrl} alt={fieldLabel(item.field)} className="mt-2 max-h-72 rounded-lg" />
      ) : null}
      {item.kind === 'file' ? (
        <button
          type="button"
          onClick={() =>
            downloadBlob(
              `${item.field}-${shortId(item.itemId)}.${FILE_EXTENSIONS[item.contentType] ?? 'bin'}`,
              item.blob,
            )
          }
          className={`mt-2 ${BTN_SECONDARY}`}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Unduh file
        </button>
      ) : null}
      {item.kind === 'error' ? (
        <p role="alert" className="mt-1 text-sm text-red-200" data-testid={`opened-error-${item.field}`}>
          {item.message}
        </p>
      ) : null}
    </li>
  )
}

/** Decrypts an approved request in the browser; neither file nor passphrase leaves this page. */
function OpenSharedForm({ request }: { request: SharingRequest }) {
  const user = useAuthStore((state) => state.user)
  const keyQuery = useQuery({
    queryKey: SHARING_KEY_QUERY_KEY,
    queryFn: ({ signal }) => sharingApi.getMyKey(signal),
  })

  const [keyFile, setKeyFile] = useState<File | null>(null)
  const [backupFile, setBackupFile] = useState<File | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const openMutation = useMutation({
    mutationFn: async () => {
      const registeredKey = keyQuery.data?.key
      if (!user || !registeredKey || !keyFile || !backupFile) {
        throw new Error('Lengkapi file kunci, file backup, dan passphrase.')
      }
      return openSharedItems({
        request,
        userId: user.id,
        registeredKey,
        keyFileText: await readTextFile(keyFile, MAX_KEY_FILE_BYTES),
        backupText: await readTextFile(backupFile, MAX_BACKUP_FILE_BYTES),
        passphrase,
      })
    },
    onSettled: () => setPassphrase(''),
  })

  const opened = openMutation.data ?? null
  const imageUrls = useMemo(
    () =>
      new Map(
        (opened ?? []).flatMap((item) =>
          item.kind === 'image' ? [[item.itemId, URL.createObjectURL(item.blob)] as const] : [],
        ),
      ),
    [opened],
  )
  useEffect(() => () => imageUrls.forEach((url) => URL.revokeObjectURL(url)), [imageUrls])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!keyFile || !backupFile || passphrase.length === 0) {
      setFormError('Pilih file kunci dan file backup, lalu isi passphrase.')
      return
    }
    setFormError(null)
    openMutation.mutate()
  }

  const shownError = formError ?? (openMutation.isError ? messageOf(openMutation.error, 'Data tidak dapat dibuka.') : null)

  return (
    <div className={`mt-3 ${RECESSED} p-3`}>
      {keyQuery.isSuccess && !keyQuery.data.key ? (
        <p className="text-sm text-amber-200">Akun Anda belum memiliki public key terdaftar.</p>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-3" noValidate>
        <div>
          <label htmlFor={`keyfile-${request.id}`} className={LABEL}>
            File kunci dari pemilik data
          </label>
          <input
            id={`keyfile-${request.id}`}
            data-testid={`open-keyfile-${request.id}`}
            type="file"
            accept="application/json,.json"
            onChange={(event) => setKeyFile(event.target.files?.[0] ?? null)}
            className={`mt-1 ${INPUT}`}
          />
        </div>
        <div>
          <label htmlFor={`backup-${request.id}`} className={LABEL}>
            File backup private key Anda
          </label>
          <input
            id={`backup-${request.id}`}
            data-testid={`open-backup-${request.id}`}
            type="file"
            accept="application/json,.json"
            onChange={(event) => setBackupFile(event.target.files?.[0] ?? null)}
            className={`mt-1 ${INPUT}`}
          />
        </div>
        <div>
          <label htmlFor={`pass-${request.id}`} className={LABEL}>
            Passphrase backup
          </label>
          <input
            id={`pass-${request.id}`}
            data-testid={`open-passphrase-${request.id}`}
            type="password"
            autoComplete="off"
            value={passphrase}
            onChange={(event) => {
              setPassphrase(event.target.value)
              setFormError(null)
            }}
            className={`mt-1 ${INPUT}`}
          />
        </div>
        <p className="text-xs text-ink-3">
          Private key dan passphrase hanya diproses di browser ini dan tidak dikirim ke server.
        </p>
        <button
          type="submit"
          data-testid={`open-btn-${request.id}`}
          disabled={openMutation.isPending || !keyQuery.data?.key}
          className={BTN_PRIMARY}
        >
          <LockOpen className="h-4 w-4" aria-hidden="true" />
          {openMutation.isPending ? 'Membuka...' : 'Buka data'}
        </button>
      </form>

      {shownError ? <ErrorNote message={shownError} testId={`open-error-${request.id}`} /> : null}

      {opened ? (
        <ul data-testid={`opened-items-${request.id}`} className="mt-3 space-y-2">
          {opened.map((item) => (
            <OpenedItemView key={item.itemId} item={item} imageUrl={imageUrls.get(item.itemId) ?? null} />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function OutgoingRequestRow({ request }: { request: SharingRequest }) {
  const [open, setOpen] = useState(false)

  return (
    <li data-testid={`outgoing-request-${request.id}`} className={`${WELL} px-3 py-2.5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">
            Ke pemilik <code className="font-mono text-ink-2">{shortId(request.owner_id)}</code>
          </p>
          <p className="text-xs text-ink-3">Dikirim {formatTimestamp(request.created_at)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RequestStatusBadge status={request.status} />
          {request.status === 'approved' ? (
            <button
              type="button"
              data-testid={`open-toggle-${request.id}`}
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
              className={BTN_SECONDARY}
            >
              <FileUp className="h-4 w-4" aria-hidden="true" />
              Buka data
              <ChevronDown
                className={`h-4 w-4 transition ${open ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
          ) : null}
        </div>
      </div>
      {request.status === 'pending' ? (
        <p className="mt-2 text-xs text-ink-3">Menunggu persetujuan pemilik data.</p>
      ) : null}
      {request.status === 'approved' && open ? <OpenSharedForm request={request} /> : null}
    </li>
  )
}

export function OutgoingRequestsPanel() {
  const outgoingQuery = useQuery({
    queryKey: SHARING_OUTGOING_QUERY_KEY,
    queryFn: ({ signal }) => sharingApi.listOutgoing(signal),
  })
  const requests = outgoingQuery.data?.requests ?? []

  return (
    <section
      className={`${CARD} p-6`}
      aria-labelledby="sharing-outgoing-heading"
      data-testid="sharing-outgoing-panel"
    >
      <h2 id="sharing-outgoing-heading" className={SECTION_HEADING}>
        Permintaan saya
      </h2>
      <p className="mt-1 text-xs text-ink-3">
        Setelah pemilik menyetujui dan mengirim file kunci kepada Anda, buka datanya di sini.
      </p>

      {outgoingQuery.isPending ? <p className="mt-3 text-sm text-ink-3">Memuat permintaan...</p> : null}
      {outgoingQuery.isError ? (
        <ErrorNote
          message={isApiClientError(outgoingQuery.error) ? outgoingQuery.error.message : 'Gagal memuat permintaan.'}
        />
      ) : null}

      {outgoingQuery.isSuccess ? (
        requests.length > 0 ? (
          <ul data-testid="outgoing-requests-list" className="mt-3 space-y-2">
            {requests.map((request) => (
              <OutgoingRequestRow key={request.id} request={request} />
            ))}
          </ul>
        ) : (
          <div className={`mt-3 ${WELL} flex flex-col items-center gap-2 px-4 py-8 text-center`}>
            <Inbox className="h-6 w-6 text-ink-3" aria-hidden="true" />
            <p className="text-sm font-medium text-ink-2">Belum ada permintaan keluar</p>
          </div>
        )
      ) : null}
    </section>
  )
}
