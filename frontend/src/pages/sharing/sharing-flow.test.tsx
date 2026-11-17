import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMockState, seedMockActiveSession } from '../../mocks/handlers'
import { renderWithProviders } from '../../test/test-utils'
import { useAuthStore } from '../../stores/authStore'
import { SharingPage } from './SharingPage'

const downloads = vi.hoisted(() => ({ files: new Map<string, string>() }))

vi.mock('./download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./download')>()),
  downloadJson: (filename: string, json: string) => downloads.files.set(filename, json),
}))

const PASSPHRASE = 'frasa-rahasia-panjang'

function signInAs(email: string) {
  const user = seedMockActiveSession(email)
  if (!user) {
    throw new Error(`Seeded account missing: ${email}`)
  }
  useAuthStore.getState().setSessionUser(user)
  return user
}

function renderPage() {
  return renderWithProviders(<SharingPage />)
}

function savedFile(prefix: string): string {
  const entry = Array.from(downloads.files.entries()).find(([name]) => name.startsWith(prefix))
  if (!entry) {
    throw new Error(`No download starting with ${prefix}`)
  }
  return entry[1]
}

/** Requester registers a key; owner approves two items; returns what the recipient needs. */
async function shareTwoItems(user: ReturnType<typeof userEvent.setup>) {
  const requester = signInAs('sari@mahasiswa.ac.id')
  const owner = seedMockActiveSession('budi@mahasiswa.ac.id')
  if (!owner) {
    throw new Error('Owner account missing')
  }
  signInAs('sari@mahasiswa.ac.id')

  const first = renderPage()
  await user.type(await screen.findByTestId('sharing-passphrase-input'), PASSPHRASE)
  await user.type(screen.getByTestId('sharing-passphrase-confirm-input'), PASSPHRASE)
  await user.click(screen.getByTestId('sharing-generate-btn'))
  await user.click(await screen.findByTestId('sharing-download-backup-btn'))
  await user.click(screen.getByTestId('sharing-backup-saved-checkbox'))
  await user.click(screen.getByTestId('sharing-register-btn'))
  await screen.findByTestId('sharing-key-registered')

  await user.type(screen.getByTestId('sharing-owner-id-input'), owner.id)
  await user.click(screen.getByTestId('sharing-request-btn'))
  await screen.findByTestId('sharing-request-success')
  first.unmount()

  signInAs('budi@mahasiswa.ac.id')
  renderPage()
  const incoming = await screen.findByTestId('incoming-requests-list')
  await user.click(within(incoming).getByRole('button', { name: /Tinjau/ }))
  await user.click(await screen.findByTestId(`share-item-${owner.id}-full_name`))
  await user.click(screen.getByTestId(`share-item-${owner.id}-ktp`))
  await user.click(screen.getByRole('button', { name: /Setujui \(2\)/ }))
  await user.click(await within(incoming).findByRole('button', { name: /Unduh file kunci/ }))

  return { requester }
}

describe('Sharing flow', () => {
  beforeEach(() => {
    resetMockState()
    downloads.files.clear()
    useAuthStore.getState().clearSession()
    URL.createObjectURL = vi.fn(() => 'blob:mock-image')
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    useAuthStore.getState().clearSession()
  })

  it('shares data end to end and opens it in the recipient browser', async () => {
    const user = userEvent.setup()
    await shareTwoItems(user)

    signInAs('sari@mahasiswa.ac.id')
    renderPage()
    const outgoing = await screen.findByTestId('outgoing-requests-list')
    await user.click(await within(outgoing).findByRole('button', { name: /Buka data/ }))

    const requestId = JSON.parse(savedFile('schematics-share-keys-')).request_id as string
    await user.upload(
      screen.getByTestId(`open-keyfile-${requestId}`),
      new File([savedFile('schematics-share-keys-')], 'keys.json', { type: 'application/json' }),
    )
    await user.upload(
      screen.getByTestId(`open-backup-${requestId}`),
      new File([savedFile('schematics-private-key-backup')], 'backup.json', {
        type: 'application/json',
      }),
    )
    await user.type(screen.getByTestId(`open-passphrase-${requestId}`), PASSPHRASE)
    await user.click(screen.getByTestId(`open-btn-${requestId}`))

    expect(await screen.findByTestId('opened-item-full_name')).toHaveTextContent('Budi Santoso')
    expect(screen.getByRole('img', { name: 'Scan KTP' })).toBeInTheDocument()
    expect(screen.queryByTestId('opened-item-nim')).not.toBeInTheDocument()
  }, 60_000)

  it('refuses a key file addressed to a different recipient', async () => {
    const user = userEvent.setup()
    await shareTwoItems(user)

    signInAs('sari@mahasiswa.ac.id')
    renderPage()
    const outgoing = await screen.findByTestId('outgoing-requests-list')
    await user.click(await within(outgoing).findByRole('button', { name: /Buka data/ }))

    const keyFile = JSON.parse(savedFile('schematics-share-keys-'))
    const tampered = { ...keyFile, recipient_id: crypto.randomUUID() }
    await user.upload(
      screen.getByTestId(`open-keyfile-${keyFile.request_id}`),
      new File([JSON.stringify(tampered)], 'keys.json', { type: 'application/json' }),
    )
    await user.upload(
      screen.getByTestId(`open-backup-${keyFile.request_id}`),
      new File([savedFile('schematics-private-key-backup')], 'backup.json', {
        type: 'application/json',
      }),
    )
    await user.type(screen.getByTestId(`open-passphrase-${keyFile.request_id}`), PASSPHRASE)
    await user.click(screen.getByTestId(`open-btn-${keyFile.request_id}`))

    expect(await screen.findByTestId(`open-error-${keyFile.request_id}`)).toHaveTextContent(
      'akun lain',
    )
  }, 60_000)

  it('reports a wrong passphrase without opening anything', async () => {
    const user = userEvent.setup()
    await shareTwoItems(user)

    signInAs('sari@mahasiswa.ac.id')
    renderPage()
    const outgoing = await screen.findByTestId('outgoing-requests-list')
    await user.click(await within(outgoing).findByRole('button', { name: /Buka data/ }))

    const requestId = JSON.parse(savedFile('schematics-share-keys-')).request_id as string
    await user.upload(
      screen.getByTestId(`open-keyfile-${requestId}`),
      new File([savedFile('schematics-share-keys-')], 'keys.json', { type: 'application/json' }),
    )
    await user.upload(
      screen.getByTestId(`open-backup-${requestId}`),
      new File([savedFile('schematics-private-key-backup')], 'backup.json', {
        type: 'application/json',
      }),
    )
    await user.type(screen.getByTestId(`open-passphrase-${requestId}`), 'frasa-yang-salah')
    await user.click(screen.getByTestId(`open-btn-${requestId}`))

    expect(await screen.findByTestId(`open-error-${requestId}`)).toHaveTextContent('Passphrase salah')
    await waitFor(() =>
      expect(screen.queryByTestId(`opened-items-${requestId}`)).not.toBeInTheDocument(),
    )
  }, 60_000)
})
