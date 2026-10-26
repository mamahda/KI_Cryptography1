import { http, HttpResponse } from 'msw'

export const DEFAULT_MOCK_SETTINGS = {
  registration_deadline: '2026-11-20T23:59:00+07:00',
  submission_deadline: '2026-12-05T23:59:00+07:00',
  min_team_size: 2,
  max_team_size: 4,
  limits: {
    document_max_bytes: 5_242_880,
    proposal_max_bytes: 10_485_760,
    video_max_bytes: 104_857_600,
  },
}

export const handlers = [
  http.get('*/api/settings', () => {
    return HttpResponse.json(DEFAULT_MOCK_SETTINGS, { status: 200 })
  }),

  http.get('*/api/me', () => {
    return HttpResponse.json(
      {
        error: {
          code: 'unauthenticated',
          message: 'Sesi belum aktif atau sudah kedaluwarsa',
          details: {},
        },
      },
      { status: 401 },
    )
  }),

  http.get('*/api/admin/benchmarks', () => {
    return HttpResponse.json(
      {
        env: {
          cpu: 'Mock CPU (AES-NI Enabled)',
          aes_ni: true,
          python: '3.12.4',
          pycryptodome: '3.21.0',
        },
        rows: [],
      },
      { status: 200 },
    )
  }),
]
