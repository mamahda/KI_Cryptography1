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
const ADMIN_ID = 'a0000000-0000-4000-8000-000000000001'

function signInAsAdmin() {
  const sessionUser = seedMockActiveSession('admin@panitia.id')
  if (!sessionUser) {
    throw new Error('Seeded superadmin account missing')
  }
  useAuthStore.getState().setSessionUser(sessionUser)
  return sessionUser
}

function renderAt(path: string) {
  return renderWithProviders(<AppRoutes />, { routerProps: { initialEntries: [path] } })
}

describe('Superadmin teams overview', () => {
  beforeEach(() => {
    useAuthStore.getState().clearSession()
  })

  it('lists every team with status, leader, and member count', async () => {
    signInAsAdmin()
    renderAt('/admin/teams')

    const table = await screen.findByTestId('admin-teams-table')
    const row = within(table).getByTestId(`admin-team-row-${GARUDA_TEAM_ID}`)
    expect(row).toHaveTextContent('Tim Garuda')
    expect(row).toHaveTextContent('Budi Santoso')
    expect(row).toHaveTextContent(/Draft/i)
    expect(row).toHaveTextContent('2')
  })

  it('shows the finalize time once a team has locked its submission', async () => {
    signInAsAdmin()
    setMockTeamStatus(GARUDA_TEAM_ID, 'final')

    renderAt('/admin/teams')

    const row = within(await screen.findByTestId('admin-teams-table')).getByTestId(
      `admin-team-row-${GARUDA_TEAM_ID}`,
    )
    expect(row).toHaveTextContent(/Final/i)
    expect(row).not.toHaveTextContent('—')
  })
})

describe('Superadmin juri accounts', () => {
  beforeEach(() => {
    useAuthStore.getState().clearSession()
  })

  it('lists the existing juri accounts', async () => {
    signInAsAdmin()
    renderAt('/admin/juri')

    const list = await screen.findByTestId('juri-accounts-list')
    expect(list).toHaveTextContent('juri1@panitia.id')
  })

  it('creates a juri account and shows it in the list', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    renderAt('/admin/juri')

    await screen.findByTestId('juri-accounts-list')
    await user.type(screen.getByTestId('juri-email-input'), 'juri2@panitia.id')
    await user.type(screen.getByTestId('juri-password-input'), 'rahasia-panjang-456')
    await user.click(screen.getByTestId('create-juri-btn'))

    expect(await screen.findByTestId('create-juri-success')).toHaveTextContent('juri2@panitia.id')
    expect(screen.getByTestId('juri-accounts-list')).toHaveTextContent('juri2@panitia.id')
  })

  it('reports 409 email_taken without clearing what the admin typed', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    renderAt('/admin/juri')

    await screen.findByTestId('juri-accounts-list')
    await user.type(screen.getByTestId('juri-email-input'), 'juri1@panitia.id')
    await user.type(screen.getByTestId('juri-password-input'), 'rahasia-panjang-456')
    await user.click(screen.getByTestId('create-juri-btn'))

    expect(await screen.findByTestId('create-juri-error')).toHaveTextContent(/email/i)
    expect(screen.getByTestId('juri-email-input')).toHaveValue('juri1@panitia.id')
  })

  it('blocks an obviously invalid email before any request is sent', async () => {
    const user = userEvent.setup()
    signInAsAdmin()

    let postCount = 0
    server.use(
      http.post('*/api/admin/juri', () => {
        postCount += 1
        return HttpResponse.json(
          { user_id: 'x', email: 'x@y.z', role: 'juri' },
          { status: 201 },
        )
      }),
    )

    renderAt('/admin/juri')

    await screen.findByTestId('juri-accounts-list')
    await user.type(screen.getByTestId('juri-email-input'), 'bukan-email')
    await user.type(screen.getByTestId('juri-password-input'), 'rahasia-panjang-456')
    await user.click(screen.getByTestId('create-juri-btn'))

    expect(await screen.findByTestId('create-juri-error')).toHaveTextContent(/email/i)
    expect(postCount).toBe(0)
  })
})

describe('Superadmin competition settings', () => {
  beforeEach(() => {
    useAuthStore.getState().clearSession()
  })

  it('prefills the form from the current settings', async () => {
    signInAsAdmin()
    renderAt('/admin/settings')

    expect(await screen.findByTestId('registration-deadline-input')).toHaveValue(
      '2026-11-20T23:59:00+07:00',
    )
    expect(screen.getByTestId('submission-deadline-input')).toHaveValue(
      '2026-12-05T23:59:00+07:00',
    )
    expect(screen.getByTestId('min-team-size-input')).toHaveValue(2)
    expect(screen.getByTestId('max-team-size-input')).toHaveValue(4)
  })

  it('saves new settings and confirms the update', async () => {
    const user = userEvent.setup()
    signInAsAdmin()

    const bodies: unknown[] = []
    server.use(
      http.put('*/api/admin/settings', async ({ request }) => {
        const body = await request.json()
        bodies.push(body)
        return HttpResponse.json(
          {
            registration_deadline: '2026-11-25T23:59:00+07:00',
            submission_deadline: '2026-12-05T23:59:00+07:00',
            min_team_size: 3,
            max_team_size: 4,
            limits: {
              document_max_bytes: 5_242_880,
              proposal_max_bytes: 10_485_760,
              video_max_bytes: 104_857_600,
            },
          },
          { status: 200 },
        )
      }),
    )

    renderAt('/admin/settings')

    const registration = await screen.findByTestId('registration-deadline-input')
    await user.clear(registration)
    await user.type(registration, '2026-11-25T23:59:00+07:00')
    const minSize = screen.getByTestId('min-team-size-input')
    await user.clear(minSize)
    await user.type(minSize, '3')
    await user.click(screen.getByTestId('save-settings-btn'))

    expect(await screen.findByTestId('settings-success')).toBeInTheDocument()
    expect(bodies).toEqual([
      {
        registration_deadline: '2026-11-25T23:59:00+07:00',
        submission_deadline: '2026-12-05T23:59:00+07:00',
        min_team_size: 3,
        max_team_size: 4,
      },
    ])
  })

  it('refuses a minimum team size above the maximum before sending it', async () => {
    const user = userEvent.setup()
    signInAsAdmin()

    let putCount = 0
    server.use(
      http.put('*/api/admin/settings', () => {
        putCount += 1
        return HttpResponse.json({}, { status: 200 })
      }),
    )

    renderAt('/admin/settings')

    const minSize = await screen.findByTestId('min-team-size-input')
    await user.clear(minSize)
    await user.type(minSize, '9')
    await user.click(screen.getByTestId('save-settings-btn'))

    expect(await screen.findByTestId('settings-error')).toHaveTextContent(/maksimum/i)
    expect(putCount).toBe(0)
  })

  it('rejects a deadline that is not a parseable timestamp before sending it', async () => {
    const user = userEvent.setup()
    signInAsAdmin()

    let putCount = 0
    server.use(
      http.put('*/api/admin/settings', () => {
        putCount += 1
        return HttpResponse.json({}, { status: 200 })
      }),
    )

    renderAt('/admin/settings')

    const registration = await screen.findByTestId('registration-deadline-input')
    await user.clear(registration)
    await user.type(registration, 'besok sore')
    await user.click(screen.getByTestId('save-settings-btn'))

    expect(await screen.findByTestId('settings-error')).toHaveTextContent(/tenggat/i)
    expect(putCount).toBe(0)
  })
})

describe('Superadmin audit logs', () => {
  beforeEach(() => {
    useAuthStore.getState().clearSession()
  })

  it('lists the audit trail newest first with actor and action', async () => {
    signInAsAdmin()
    renderAt('/admin/audit-logs')

    const table = await screen.findByTestId('audit-logs-table')
    expect(table).toHaveTextContent('juri1@panitia.id')
    expect(table).toHaveTextContent(/view_item/i)
    expect(table).toHaveTextContent(/integrity_failure/i)
  })

  it('labels an entry with no actor as a system event', async () => {
    signInAsAdmin()
    renderAt('/admin/audit-logs')

    const table = await screen.findByTestId('audit-logs-table')
    expect(within(table).getByTestId('audit-row-500')).toHaveTextContent(/Sistem/i)
  })

  it('filters by action through the API', async () => {
    const user = userEvent.setup()
    signInAsAdmin()

    const requestedUrls: string[] = []
    server.use(
      http.get('*/api/admin/audit-logs', ({ request }) => {
        requestedUrls.push(request.url)
        return HttpResponse.json(
          { items: [], page: 1, page_size: 25, total: 0 },
          { status: 200 },
        )
      }),
    )

    renderAt('/admin/audit-logs')
    await screen.findByTestId('audit-logs-empty-state')

    await user.selectOptions(screen.getByTestId('audit-action-filter'), 'verify_participant')

    await waitFor(() => {
      expect(requestedUrls.at(-1)).toContain('action=verify_participant')
    })
  })

  it('filters by actor and date window through the API', async () => {
    const user = userEvent.setup()
    signInAsAdmin()

    const requestedUrls: string[] = []
    server.use(
      http.get('*/api/admin/audit-logs', ({ request }) => {
        requestedUrls.push(request.url)
        return HttpResponse.json(
          { items: [], page: 1, page_size: 25, total: 0 },
          { status: 200 },
        )
      }),
    )

    renderAt('/admin/audit-logs')
    await screen.findByTestId('audit-logs-empty-state')

    await user.type(screen.getByTestId('audit-actor-filter'), ADMIN_ID)
    await user.type(screen.getByTestId('audit-from-filter'), '2026-10-24')
    await user.type(screen.getByTestId('audit-to-filter'), '2026-10-26')
    await user.click(screen.getByTestId('audit-apply-btn'))

    await waitFor(() => {
      const lastUrl = requestedUrls.at(-1) ?? ''
      expect(lastUrl).toContain(`actor_id=${ADMIN_ID}`)
      expect(lastUrl).toContain('from=2026-10-24')
      expect(lastUrl).toContain('to=2026-10-26')
    })
  })
})

describe('Superadmin benchmark dashboard', () => {
  beforeEach(() => {
    useAuthStore.getState().clearSession()
  })

  it('shows the measurement environment', async () => {
    signInAsAdmin()
    renderAt('/admin/benchmarks')

    const env = await screen.findByTestId('benchmark-env')
    expect(env).toHaveTextContent('Mock CPU (AES-NI Enabled)')
    expect(env).toHaveTextContent('3.12.4')
    expect(env).toHaveTextContent(/AES-NI/i)
  })

  it('reports throughput, median and IQR per cipher', async () => {
    signInAsAdmin()
    renderAt('/admin/benchmarks')

    const table = await screen.findByTestId('benchmark-table')
    const aes = within(table).getByTestId('benchmark-row-aes-enc-5242880')
    expect(aes).toHaveTextContent('826.4')
    // median 6_050_000 ns -> 6.05 ms, IQR 5.90-6.40 ms
    expect(aes).toHaveTextContent('6.05')
    expect(aes).toHaveTextContent('5.90')
    expect(aes).toHaveTextContent('6.40')

    expect(within(table).getByTestId('benchmark-row-des-enc-5242880')).toHaveTextContent('54.1')
    expect(within(table).getByTestId('benchmark-row-rc4-enc-5242880')).toHaveTextContent('267.4')
  })

  it('filters the rows by operation through the API', async () => {
    const user = userEvent.setup()
    signInAsAdmin()

    const requestedUrls: string[] = []
    server.use(
      http.get('*/api/admin/benchmarks', ({ request }) => {
        requestedUrls.push(request.url)
        return HttpResponse.json(
          {
            env: { cpu: 'CPU', aes_ni: false, python: '3.12.4', pycryptodome: '3.21.0' },
            rows: [],
          },
          { status: 200 },
        )
      }),
    )

    renderAt('/admin/benchmarks')
    await screen.findByTestId('benchmark-empty-state')

    await user.selectOptions(screen.getByTestId('benchmark-operation-filter'), 'dec')

    await waitFor(() => {
      expect(requestedUrls.at(-1)).toContain('operation=dec')
    })
  })

  /* ---------------------------------------------------------------------- */
  /* T_CPU scenario calculator                                              */
  /* ---------------------------------------------------------------------- */

  it('computes T_CPU from the measured throughputs for the default scenario', async () => {
    signInAsAdmin()
    renderAt('/admin/benchmarks')

    // N=100 items of S=5 MB, with v_AES=826.4, v_DES=54.1, v_RC4=267.4,
    // v_HMAC=438.6 MB/s:
    //   T = 100 * 5 * (1/826.4 + 1/54.1 + 1/267.4 + 3/438.6) = 15.14 s
    const result = await screen.findByTestId('tcpu-result')
    expect(result).toHaveTextContent('15.14')
  })

  it('recomputes T_CPU when the scenario changes', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    renderAt('/admin/benchmarks')

    await screen.findByTestId('tcpu-result')

    const itemCount = screen.getByTestId('tcpu-items-input')
    await user.clear(itemCount)
    await user.type(itemCount, '200')

    // Twice the items is twice the CPU time: 30.27 s.
    expect(await screen.findByTestId('tcpu-result')).toHaveTextContent('30.27')
  })

  it('states the formula and its per-ciphertext HMAC term', async () => {
    signInAsAdmin()
    renderAt('/admin/benchmarks')

    const formula = await screen.findByTestId('tcpu-formula')
    expect(formula).toHaveTextContent(/v_AES/i)
    expect(formula).toHaveTextContent(/v_DES/i)
    expect(formula).toHaveTextContent(/v_RC4/i)
    expect(formula).toHaveTextContent(/3/)
    expect(formula).toHaveTextContent(/v_HMAC/i)
  })

  it('explains that T_CPU cannot be computed when a cipher has no measurement', async () => {
    signInAsAdmin()
    server.use(
      http.get('*/api/admin/benchmarks', () =>
        HttpResponse.json(
          {
            env: { cpu: 'CPU', aes_ni: false, python: '3.12.4', pycryptodome: '3.21.0' },
            rows: [
              {
                cipher: 'aes',
                operation: 'enc',
                size_bytes: 5_242_880,
                n: 30,
                median_ns: 6_050_000,
                q1_ns: 5_900_000,
                q3_ns: 6_400_000,
                median_mb_s: 826.4,
              },
            ],
          },
          { status: 200 },
        ),
      ),
    )

    renderAt('/admin/benchmarks')

    expect(await screen.findByTestId('tcpu-incomplete')).toHaveTextContent(/DES/i)
    expect(screen.queryByTestId('tcpu-result')).not.toBeInTheDocument()
  })
})
