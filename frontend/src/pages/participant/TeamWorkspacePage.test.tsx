import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { seedMockActiveSession, setMockTeamStatus } from '../../mocks/handlers'
import { server } from '../../mocks/server'
import { AppRoutes } from '../../router'
import { useAuthStore } from '../../stores/authStore'
import { renderWithProviders } from '../../test/test-utils'

const GARUDA_TEAM_ID = '9c8b7a6d-5e4f-4321-8765-0fedcba98765'

function signInAs(email: string) {
  const sessionUser = seedMockActiveSession(email)
  if (!sessionUser) {
    throw new Error(`Seeded account missing: ${email}`)
  }
  useAuthStore.getState().setSessionUser(sessionUser)
  return sessionUser
}

function renderWorkspace() {
  return renderWithProviders(<AppRoutes />, { routerProps: { initialEntries: ['/team'] } })
}

describe('Team & Submission Workspace', () => {
  beforeEach(() => {
    useAuthStore.getState().clearSession()
  })

  it('offers create and join forms when the participant has no team', async () => {
    signInAs('terverifikasi@mahasiswa.ac.id')
    renderWorkspace()

    expect(await screen.findByTestId('team-empty-state')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Buat Tim/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Gabung Tim/i })).toBeInTheDocument()
    expect(screen.queryByTestId('team-card')).not.toBeInTheDocument()
  })

  it('creates a team and shows its 8-character invite code', async () => {
    const user = userEvent.setup()
    signInAs('terverifikasi@mahasiswa.ac.id')
    renderWorkspace()

    await user.type(await screen.findByLabelText(/Nama Tim/i), 'Tim Rajawali')
    await user.click(screen.getByRole('button', { name: /Buat Tim/i }))

    const card = await screen.findByTestId('team-card')
    expect(within(card).getByText('Tim Rajawali')).toBeInTheDocument()
    expect(within(card).getByTestId('invite-code').textContent).toMatch(/^[A-Z0-9]{8}$/)
  })

  it('rejects an invite code that is not 8 characters without calling the API', async () => {
    const user = userEvent.setup()
    signInAs('terverifikasi@mahasiswa.ac.id')

    let joinCalls = 0
    server.use(
      http.post('*/api/teams/join', () => {
        joinCalls += 1
        return HttpResponse.json({ team: null }, { status: 200 })
      }),
    )

    renderWorkspace()

    await user.type(await screen.findByLabelText(/Kode Tim/i), 'ABC12')
    await user.click(screen.getByRole('button', { name: /Gabung Tim/i }))

    expect(await screen.findByTestId('team-form-error')).toHaveTextContent(/8 karakter/i)
    expect(joinCalls).toBe(0)
  })

  it('joins an existing team using a lowercase invite code', async () => {
    const user = userEvent.setup()
    signInAs('terverifikasi@mahasiswa.ac.id')
    renderWorkspace()

    await user.type(await screen.findByLabelText(/Kode Tim/i), 'k7m2q9xa')
    await user.click(screen.getByRole('button', { name: /Gabung Tim/i }))

    const card = await screen.findByTestId('team-card')
    expect(within(card).getByText('Tim Garuda')).toBeInTheDocument()
  })

  it('copies the invite code to the clipboard', async () => {
    const user = userEvent.setup()
    signInAs('budi@mahasiswa.ac.id')
    renderWorkspace()

    await screen.findByTestId('team-card')
    await user.click(screen.getByRole('button', { name: /Salin Kode/i }))

    await waitFor(async () => {
      expect(await navigator.clipboard.readText()).toBe('K7M2Q9XA')
    })
  })

  it('lists members with their profile and document readiness', async () => {
    signInAs('budi@mahasiswa.ac.id')
    renderWorkspace()

    const rows = await screen.findAllByTestId('member-row')
    expect(rows).toHaveLength(2)

    const leaderRow = rows[0]!
    expect(within(leaderRow).getByText('Budi Santoso')).toBeInTheDocument()
    expect(within(leaderRow).getByText(/Ketua/i)).toBeInTheDocument()

    // Sari has a complete profile but incomplete documents in the seeded team.
    const memberRow = rows[1]!
    expect(within(memberRow).getByText('Sari Dewi')).toBeInTheDocument()
    expect(within(memberRow).getByText('Profil')).toBeInTheDocument()
    expect(within(memberRow).getByText('Dokumen')).toBeInTheDocument()

    expect(screen.getByTestId('member-readiness-summary')).toHaveTextContent(
      '1/2 anggota lengkap',
    )
  })

  it('lets a non-leader member leave the team after confirming', async () => {
    const user = userEvent.setup()
    signInAs('sari@mahasiswa.ac.id')
    renderWorkspace()

    await screen.findByTestId('team-card')
    await user.click(screen.getByRole('button', { name: /Keluar dari Tim/i }))
    await user.click(screen.getByRole('button', { name: /Ya, Keluar/i }))

    expect(await screen.findByTestId('team-empty-state')).toBeInTheDocument()
  })

  it('offers no leave action to the leader, since the contract forbids it', async () => {
    signInAs('budi@mahasiswa.ac.id')
    renderWorkspace()

    expect(await screen.findByTestId('leader-cannot-leave-notice')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Keluar dari Tim/i })).not.toBeInTheDocument()
  })

  it('lets the leader remove a member after confirming', async () => {
    const user = userEvent.setup()
    signInAs('budi@mahasiswa.ac.id')
    renderWorkspace()

    await screen.findByTestId('team-card')
    await user.click(screen.getByRole('button', { name: /Keluarkan Sari Dewi/i }))
    await user.click(screen.getByRole('button', { name: /Ya, Keluarkan/i }))

    await waitFor(() => {
      expect(screen.getAllByTestId('member-row')).toHaveLength(1)
    })
  })

  it('surfaces the API error message when removing a member fails', async () => {
    const user = userEvent.setup()
    signInAs('budi@mahasiswa.ac.id')

    server.use(
      http.delete('*/api/teams/me/members/:userId', () =>
        HttpResponse.json(
          {
            error: {
              code: 'team_locked',
              message: 'Tim sudah difinalisasi sehingga anggota tidak dapat diubah.',
              details: {},
            },
          },
          { status: 409 },
        ),
      ),
    )

    renderWorkspace()

    await screen.findByTestId('team-card')
    await user.click(screen.getByRole('button', { name: /Keluarkan Sari Dewi/i }))
    await user.click(screen.getByRole('button', { name: /Ya, Keluarkan/i }))

    const alert = await screen.findByTestId('team-error-alert')
    expect(alert).toHaveTextContent(/tidak dapat diubah/i)
    expect(screen.getAllByTestId('member-row')).toHaveLength(2)
  })

  it('locks membership actions once the team is final', async () => {
    signInAs('budi@mahasiswa.ac.id')
    setMockTeamStatus(GARUDA_TEAM_ID, 'final')
    renderWorkspace()

    expect(await screen.findByTestId('team-locked-notice')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Keluarkan Sari Dewi/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Keluar dari Tim/i })).not.toBeInTheDocument()
  })
})
