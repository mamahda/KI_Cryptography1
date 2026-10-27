import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, Inbox, UserPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { apiClient, isApiClientError } from '@/api'
import {
  BTN_PRIMARY,
  CARD,
  INPUT,
  LABEL,
  PAGE_TITLE,
  RECESSED,
  SECTION_HEADING,
  WELL,
} from '@/components/ui/tokens'
import { formatTimestamp } from '@/lib/datetime'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The server rejects anything shorter; stop it here so the admin sees it sooner. */
const PASSWORD_MIN_LENGTH = 8

export function AdminJuriPage() {
  const queryClient = useQueryClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [successEmail, setSuccessEmail] = useState<string | null>(null)

  const juriQuery = useQuery({
    queryKey: ['admin', 'juri'],
    queryFn: ({ signal }) => apiClient.admin.listJuri(signal),
  })

  const createMutation = useMutation({
    mutationFn: () => apiClient.admin.createJuri({ email: email.trim(), password }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'juri'] })
      // Cleared only on success: a rejected submission keeps what was typed.
      setPassword('')
      setEmail('')
      setSuccessEmail(created.email)
    },
  })

  const accounts = juriQuery.data?.juri ?? []

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSuccessEmail(null)

    const trimmedEmail = email.trim()
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setFormError('Format email tidak valid.')
      return
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      setFormError(`Kata sandi minimal ${PASSWORD_MIN_LENGTH} karakter.`)
      return
    }

    setFormError(null)
    createMutation.mutate()
  }

  const requestError = createMutation.isError
    ? isApiClientError(createMutation.error)
      ? createMutation.error.message
      : 'Gagal membuat akun juri.'
    : null
  const shownError = formError ?? requestError

  return (
    <div data-testid="admin-juri-page" className="space-y-6">
      <header>
        <h1 className={PAGE_TITLE}>Akun Juri</h1>
      </header>

      <section className={`${CARD} p-6`} aria-labelledby="create-juri-heading">
        <h2 id="create-juri-heading" className={SECTION_HEADING}>
          Buat akun juri
        </h2>

        <form onSubmit={handleSubmit} className="mt-3 space-y-3" noValidate>
          <div>
            <label htmlFor="juri-email-input" className={LABEL}>
              Email juri
            </label>
            <input
              id="juri-email-input"
              data-testid="juri-email-input"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                setFormError(null)
              }}
              placeholder="juri2@panitia.id"
              aria-invalid={shownError ? true : undefined}
              className={`mt-1 ${INPUT}`}
            />
          </div>

          <div>
            <label htmlFor="juri-password-input" className={LABEL}>
              Kata sandi awal
              <span className="ml-1 font-normal text-ink-3">
                (minimal {PASSWORD_MIN_LENGTH} karakter)
              </span>
            </label>
            <input
              id="juri-password-input"
              data-testid="juri-password-input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                setFormError(null)
              }}
              className={`mt-1 ${INPUT}`}
            />
          </div>

          <button
            type="submit"
            data-testid="create-juri-btn"
            disabled={createMutation.isPending}
            className={BTN_PRIMARY}
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            {createMutation.isPending ? 'Membuat...' : 'Buat akun juri'}
          </button>
        </form>

        {successEmail ? (
          <p
            data-testid="create-juri-success"
            role="status"
            className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-3 py-2.5 text-sm text-emerald-200"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Akun juri {successEmail} berhasil dibuat.
          </p>
        ) : null}

        {shownError ? (
          <p
            data-testid="create-juri-error"
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-950/30 px-3 py-2.5 text-sm text-red-200"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{shownError}</span>
          </p>
        ) : null}
      </section>

      <section className={`${CARD} p-6`} aria-labelledby="juri-list-heading">
        <h2 id="juri-list-heading" className={SECTION_HEADING}>
          Akun juri terdaftar
        </h2>

        {juriQuery.isPending ? (
          <p data-testid="juri-accounts-loading" className="mt-3 text-sm text-ink-3">
            Memuat akun juri...
          </p>
        ) : null}

        {juriQuery.isError ? (
          <p
            data-testid="juri-accounts-error"
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-950/30 px-3 py-2.5 text-sm text-red-200"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {isApiClientError(juriQuery.error)
                ? juriQuery.error.message
                : 'Gagal memuat akun juri.'}
            </span>
          </p>
        ) : null}

        {juriQuery.isSuccess ? (
          accounts.length > 0 ? (
            <ul data-testid="juri-accounts-list" className="mt-3 space-y-2">
              {accounts.map((account) => (
                <li
                  key={account.user_id}
                  data-testid={`juri-account-${account.user_id}`}
                  className={`${WELL} flex flex-wrap items-center justify-between gap-2 px-3 py-2.5`}
                >
                  <span className="text-sm font-medium break-all text-ink">
                    {account.email}
                  </span>
                  <span className={`${RECESSED} px-2 py-1 text-xs text-ink-2`}>
                    Dibuat {formatTimestamp(account.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div
              data-testid="juri-accounts-list"
              className={`mt-3 ${WELL} flex flex-col items-center gap-2 px-4 py-10 text-center`}
            >
              <Inbox className="h-6 w-6 text-ink-3" aria-hidden="true" />
              <p className="text-sm font-medium text-ink-2">Belum ada akun juri</p>
            </div>
          )
        ) : null}
      </section>
    </div>
  )
}
