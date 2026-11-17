import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Download, KeyRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { isApiClientError, sharingApi } from '@/api'
import { BTN_PRIMARY, BTN_SECONDARY, CARD, INPUT, LABEL, RECESSED, SECTION_HEADING } from '@/components/ui/tokens'
import { downloadJson } from './download'
import { generateKeyBackup } from './sharingCrypto'
import { ErrorNote } from './shared'

const PASSPHRASE_MIN_LENGTH = 10
const BACKUP_FILENAME = 'schematics-private-key-backup.json'

interface GeneratedKey {
  publicKeySpkiB64: string
  backupJson: string
}

export const SHARING_KEY_QUERY_KEY = ['sharing', 'key'] as const

/**
 * Creates the user's RSA key pair in the browser. The backup file is offered
 * for download before the public key is registered, because a lost backup means
 * every key wrapped for this account can never be opened.
 */
export function KeySetupPanel() {
  const queryClient = useQueryClient()

  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated] = useState<GeneratedKey | null>(null)
  const [backupSaved, setBackupSaved] = useState(false)

  const keyQuery = useQuery({
    queryKey: SHARING_KEY_QUERY_KEY,
    queryFn: ({ signal }) => sharingApi.getMyKey(signal),
  })

  const registerMutation = useMutation({
    mutationFn: (publicKeySpkiB64: string) =>
      sharingApi.registerKey({ public_key_spki_b64: publicKeySpkiB64 }),
    onSuccess: () => {
      setGenerated(null)
      setBackupSaved(false)
      void queryClient.invalidateQueries({ queryKey: SHARING_KEY_QUERY_KEY })
    },
  })

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (passphrase.length < PASSPHRASE_MIN_LENGTH) {
      setFormError(`Passphrase minimal ${PASSPHRASE_MIN_LENGTH} karakter.`)
      return
    }
    if (passphrase !== confirm) {
      setFormError('Konfirmasi passphrase tidak sama.')
      return
    }

    setFormError(null)
    setGenerating(true)
    try {
      setGenerated(await generateKeyBackup(passphrase))
      setBackupSaved(false)
      // The passphrase only protects the backup file; nothing keeps it afterwards.
      setPassphrase('')
      setConfirm('')
    } catch {
      setFormError('Gagal membuat pasangan kunci di browser ini.')
    } finally {
      setGenerating(false)
    }
  }

  const registerError = registerMutation.isError
    ? isApiClientError(registerMutation.error)
      ? registerMutation.error.message
      : 'Gagal mendaftarkan public key.'
    : null
  const registered = keyQuery.data?.key ?? null

  return (
    <section className={`${CARD} p-6`} aria-labelledby="sharing-key-heading" data-testid="sharing-key-panel">
      <h2 id="sharing-key-heading" className={SECTION_HEADING}>
        Kunci RSA saya
      </h2>

      {keyQuery.isPending ? <p className="mt-3 text-sm text-ink-3">Memuat status kunci...</p> : null}

      {keyQuery.isError ? (
        <ErrorNote
          message={isApiClientError(keyQuery.error) ? keyQuery.error.message : 'Gagal memuat status kunci.'}
        />
      ) : null}

      {registered ? (
        <div data-testid="sharing-key-registered" className="mt-3 space-y-2">
          <p className="flex items-start gap-2 text-sm text-emerald-200" role="status">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Public key sudah terdaftar. Anda dapat meminta dan menerima data.
          </p>
          <p className={`${RECESSED} px-3 py-2 text-xs text-ink-3`}>
            ID kunci <code className="font-mono text-ink-2">{registered.id}</code>
          </p>
          <p className="text-xs text-ink-3">
            Simpan file backup private key Anda dengan aman. Jika file atau passphrase hilang, data
            yang dibagikan kepada Anda tidak dapat dibuka lagi.
          </p>
        </div>
      ) : null}

      {keyQuery.isSuccess && !registered && !generated ? (
        <form onSubmit={(event) => void handleGenerate(event)} className="mt-3 space-y-3" noValidate>
          <p className="text-sm text-ink-3">
            Anda belum punya kunci. Pasangan kunci dibuat di browser ini; private key tidak pernah
            dikirim ke server dan disimpan dalam file yang dilindungi passphrase.
          </p>
          <div>
            <label htmlFor="sharing-passphrase" className={LABEL}>
              Passphrase backup
              <span className="ml-1 font-normal text-ink-3">(minimal {PASSPHRASE_MIN_LENGTH} karakter)</span>
            </label>
            <input
              id="sharing-passphrase"
              data-testid="sharing-passphrase-input"
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(event) => {
                setPassphrase(event.target.value)
                setFormError(null)
              }}
              className={`mt-1 ${INPUT}`}
            />
          </div>
          <div>
            <label htmlFor="sharing-passphrase-confirm" className={LABEL}>
              Ulangi passphrase
            </label>
            <input
              id="sharing-passphrase-confirm"
              data-testid="sharing-passphrase-confirm-input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => {
                setConfirm(event.target.value)
                setFormError(null)
              }}
              className={`mt-1 ${INPUT}`}
            />
          </div>
          <button type="submit" data-testid="sharing-generate-btn" disabled={generating} className={BTN_PRIMARY}>
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            {generating ? 'Membuat kunci...' : 'Buat pasangan kunci'}
          </button>
          {formError ? <ErrorNote message={formError} testId="sharing-key-error" /> : null}
        </form>
      ) : null}

      {generated ? (
        <div data-testid="sharing-key-generated" className="mt-3 space-y-3">
          <p className="text-sm text-ink-2">
            Pasangan kunci sudah dibuat. Unduh dan simpan file backup sebelum mendaftarkan public
            key. File ini satu-satunya salinan private key Anda.
          </p>
          <button
            type="button"
            data-testid="sharing-download-backup-btn"
            onClick={() => downloadJson(BACKUP_FILENAME, generated.backupJson)}
            className={BTN_SECONDARY}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Unduh file backup
          </button>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              data-testid="sharing-backup-saved-checkbox"
              checked={backupSaved}
              onChange={(event) => setBackupSaved(event.target.checked)}
              className="mt-0.5"
            />
            Saya sudah menyimpan file backup di tempat yang aman.
          </label>
          <button
            type="button"
            data-testid="sharing-register-btn"
            disabled={!backupSaved || registerMutation.isPending}
            onClick={() => registerMutation.mutate(generated.publicKeySpkiB64)}
            className={BTN_PRIMARY}
          >
            {registerMutation.isPending ? 'Mendaftarkan...' : 'Daftarkan public key'}
          </button>
          {registerError ? <ErrorNote message={registerError} testId="sharing-register-error" /> : null}
        </div>
      ) : null}
    </section>
  )
}
