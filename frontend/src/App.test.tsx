import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AppRoutes } from './router'
import { useAuthStore } from './stores/authStore'
import { useUiStore } from './stores/uiStore'
import { renderWithProviders } from './test/test-utils'

describe('Phase 0 Workspace Scaffolding', () => {
  it('fetches competition settings via TanStack Query + MSW and renders limits', async () => {
    renderWithProviders(<AppRoutes />, {
      routerProps: { initialEntries: ['/'] },
    })

    expect(
      screen.getByRole('heading', { name: /Platform Pendaftaran Schematics NIC/i }),
    ).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByTestId('settings-summary')).toBeInTheDocument()
    })

    expect(screen.getByText('2–4 members')).toBeInTheDocument()
    expect(screen.getByText('5 MB / 10 MB')).toBeInTheDocument()
    expect(screen.getByText('100 MB')).toBeInTheDocument()
  })

  it('navigates across core routes and renders Anggota D benchmark route boundary', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, {
      routerProps: { initialEntries: ['/admin/benchmarks'] },
    })

    expect(
      screen.getByRole('heading', { name: /Cipher Benchmark Dashboard/i }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /Encryption Inspector/i }))
    expect(
      screen.getByRole('heading', { name: /Encryption & Integrity Inspector/i }),
    ).toBeInTheDocument()
  })

  it('reflects Zustand auth and UI notice state in the application shell', () => {
    useAuthStore.getState().setSessionUser({
      id: 'b1a7c2d4-5e6f-4a8b-9c0d-1e2f3a4b5c6d',
      email: 'budi@mahasiswa.ac.id',
      role: 'peserta',
      full_name: 'Budi Santoso',
      verification_status: 'menunggu',
    })
    useUiStore.getState().pushNotice({
      variant: 'info',
      message: 'Session hydrated',
    })

    renderWithProviders(<AppRoutes />, {
      routerProps: { initialEntries: ['/dashboard'] },
    })

    expect(screen.getByTestId('session-badge')).toHaveTextContent(
      'budi@mahasiswa.ac.id (peserta)',
    )
    expect(screen.getByRole('status')).toHaveTextContent('Session hydrated')
  })
})
