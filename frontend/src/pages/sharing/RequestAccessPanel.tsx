import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, Copy, Send } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { isApiClientError, sharingApi } from '@/api'
import { BTN_PRIMARY, BTN_SECONDARY, CARD, INPUT, LABEL, RECESSED, SECTION_HEADING } from '@/components/ui/tokens'
import { useAuthStore } from '@/stores/authStore'
import { SHARING_KEY_QUERY_KEY, SHARING_OUTGOING_QUERY_KEY } from './queryKeys'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Shows the user's own ID for sharing, and sends an access request to an owner's ID. */
export function RequestAccessPanel() {
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)

  const [ownerId, setOwnerId] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const keyQuery = useQuery({
    queryKey: SHARING_KEY_QUERY_KEY,
    queryFn: ({ signal }) => sharingApi.getMyKey(signal),
  })
  const hasKey = Boolean(keyQuery.data?.key)

  const createMutation = useMutation({
    mutationFn: (id: string) => sharingApi.createRequest({ owner_id: id }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: SHARING_OUTGOING_QUERY_KEY })
      setSentTo(created.owner_id)
      setOwnerId('')
    },
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSentTo(null)
    const trimmed = ownerId.trim()
    if (!UUID_PATTERN.test(trimmed)) {
      setFormError('ID pemilik harus berupa UUID, misalnya 3f2b8c1e-....')
      return
    }
    if (trimmed === user?.id) {
      setFormError('Anda tidak dapat meminta data milik sendiri.')
      return
    }
    setFormError(null)
    createMutation.mutate(trimmed)
  }

  async function copyOwnId() {
    if (!user) {
      return
    }
    try {
      await navigator.clipboard.writeText(user.id)
      setCopied(true)
    } catch {
      // Clipboard access can be blocked; the ID stays selectable on screen.
      setCopied(false)
    }
  }

  const requestError = createMutation.isError
    ? isApiClientError(createMutation.error)
      ? createMutation.error.message
      : 'Gagal mengirim permintaan.'
    : null
  const shownError = formError ?? requestError

  return (
    <section className={`${CARD} p-6`} aria-labelledby="sharing-request-heading" data-testid="sharing-request-panel">
      <h2 id="sharing-request-heading" className={SECTION_HEADING}>
        Minta akses data
      </h2>

      {user ? (
        <div className={`mt-3 ${RECESSED} flex flex-wrap items-center justify-between gap-2 px-3 py-2.5`}>
          <div className="min-w-0">
            <p className="text-xs text-ink-3">ID akun saya (berikan kepada orang yang ingin meminta data Anda)</p>
            <code data-testid="sharing-own-id" className="font-mono text-sm break-all text-ink-2">
              {user.id}
            </code>
          </div>
          <button type="button" onClick={() => void copyOwnId()} className={BTN_SECONDARY}>
            <Copy className="h-4 w-4" aria-hidden="true" />
            {copied ? 'Tersalin' : 'Salin'}
          </button>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-4 space-y-3" noValidate>
        <div>
          <label htmlFor="sharing-owner-id" className={LABEL}>
            ID pemilik data
          </label>
          <input
            id="sharing-owner-id"
            data-testid="sharing-owner-id-input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={ownerId}
            onChange={(event) => {
              setOwnerId(event.target.value)
              setFormError(null)
            }}
            placeholder="UUID dari pemilik data"
            aria-invalid={shownError ? true : undefined}
            className={`mt-1 font-mono ${INPUT}`}
          />
        </div>

        {keyQuery.isSuccess && !hasKey ? (
          <p className="text-sm text-amber-200" data-testid="sharing-needs-key">
            Buat dan daftarkan kunci RSA terlebih dahulu sebelum meminta data.
          </p>
        ) : null}

        <button
          type="submit"
          data-testid="sharing-request-btn"
          disabled={!hasKey || createMutation.isPending}
          className={BTN_PRIMARY}
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          {createMutation.isPending ? 'Mengirim...' : 'Kirim permintaan'}
        </button>
      </form>

      {sentTo ? (
        <p
          data-testid="sharing-request-success"
          role="status"
          className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-3 py-2.5 text-sm text-emerald-200"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Permintaan terkirim. Pemilik data perlu menyetujuinya di halaman ini.
        </p>
      ) : null}

      {shownError ? (
        <p
          data-testid="sharing-request-error"
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-950/30 px-3 py-2.5 text-sm text-red-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{shownError}</span>
        </p>
      ) : null}
    </section>
  )
}
