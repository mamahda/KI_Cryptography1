import { http, HttpResponse } from 'msw'
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '../api/csrf'
import { DOCUMENT_TYPES, type ConsentInfo, type DocumentType, type Me } from '../api/types'

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

const DEFAULT_POLICY_VERSION = '1.0'
const DEFAULT_POLICY_MARKDOWN = `## Pemberitahuan Privasi Schematics NIC
Panitia Schematics NIC mengumpulkan dan melindungi data pendaftaran peserta sesuai UU Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi (UU PDP).

### Data yang Dikumpulkan
- Data pribadi umum: email, nama lengkap, NIM, program studi, institusi, domisili, dan nomor HP.
- Tanggal lahir untuk penandaan peserta berusia di bawah 18 tahun oleh superadmin.
- Dokumen verifikasi identitas: scan KTP, scan KTM/KRSM, dan bukti twibbon.
- Karya tim: proposal PDF, video demo MP4, dan tautan repositori GitHub.

### Keamanan & Hak Akses
- Seluruh data dan file dienkripsi tiga cipher (AES-CTR, DES-CTR, dan RC4) disertai HMAC-SHA256 dan pembungkusan kunci AES-256-GCM.
- Dokumen identitas hanya dapat dibuka oleh peserta pemilik dan superadmin (tercatat pada audit log).
- Juri hanya dapat melihat karya tim yang telah berstatus final.`

interface MockAccountRecord {
  password: string
  user: Me
}

function createInitialAccounts(policyVersion: string): Map<string, MockAccountRecord> {
  const map = new Map<string, MockAccountRecord>()

  map.set('budi@mahasiswa.ac.id', {
    password: 'rahasia-panjang-123',
    user: {
      id: 'b1a7c2d4-5e6f-4a8b-9c0d-1e2f3a4b5c6d',
      email: 'budi@mahasiswa.ac.id',
      role: 'peserta',
      full_name: 'Budi Santoso',
      verification_status: 'menunggu',
      consent: {
        policy_version: policyVersion,
        agreed_at: '2026-10-26T09:00:00+07:00',
      },
      current_policy_version: policyVersion,
      team: null,
    },
  })

  map.set('baru@mahasiswa.ac.id', {
    password: 'rahasia-panjang-123',
    user: {
      id: 'c2b8d3e5-6f70-4b9c-8d1e-2f3a4b5c6d7e',
      email: 'baru@mahasiswa.ac.id',
      role: 'peserta',
      full_name: null,
      verification_status: 'belum_lengkap',
      consent: null,
      current_policy_version: policyVersion,
      team: null,
    },
  })

  map.set('juri1@panitia.id', {
    password: 'sementara-12345',
    user: {
      id: 'e4d3c2b1-a098-4765-8432-10fedcba9876',
      email: 'juri1@panitia.id',
      role: 'juri',
      full_name: null,
      verification_status: null,
      consent: null,
      current_policy_version: policyVersion,
      team: null,
    },
  })

  map.set('admin@panitia.id', {
    password: 'superadmin-12345',
    user: {
      id: 'a0000000-0000-4000-8000-000000000001',
      email: 'admin@panitia.id',
      role: 'superadmin',
      full_name: null,
      verification_status: null,
      consent: null,
      current_policy_version: policyVersion,
      team: null,
    },
  })

  return map
}

interface MockServerState {
  policyVersion: string
  policyMarkdown: string
  accounts: Map<string, MockAccountRecord>
  activeEmail: string | null
  csrfToken: string | null
  nextIdCounter: number
}

const mockState: MockServerState = {
  policyVersion: DEFAULT_POLICY_VERSION,
  policyMarkdown: DEFAULT_POLICY_MARKDOWN,
  accounts: createInitialAccounts(DEFAULT_POLICY_VERSION),
  activeEmail: null,
  csrfToken: null,
  nextIdCounter: 100,
}

function setBrowserCsrfCookie(token: string | null): void {
  if (typeof document === 'undefined') {
    return
  }
  if (token) {
    document.cookie = `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; SameSite=Lax`
  } else {
    document.cookie = `${CSRF_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`
  }
}

export function resetMockState(): void {
  mockState.policyVersion = DEFAULT_POLICY_VERSION
  mockState.policyMarkdown = DEFAULT_POLICY_MARKDOWN
  mockState.accounts = createInitialAccounts(DEFAULT_POLICY_VERSION)
  mockState.activeEmail = null
  mockState.csrfToken = null
  mockState.nextIdCounter = 100
  setBrowserCsrfCookie(null)
}

export function setMockPolicyVersion(version: string, markdown?: string): void {
  mockState.policyVersion = version
  if (markdown) {
    mockState.policyMarkdown = markdown
  }
  for (const record of mockState.accounts.values()) {
    record.user = {
      ...record.user,
      current_policy_version: version,
    }
  }
}

export function seedMockActiveSession(email: string, csrfToken = 'mock-csrf-token-001'): Me | null {
  const account = mockState.accounts.get(email.toLowerCase())
  if (!account) {
    return null
  }
  mockState.activeEmail = account.user.email
  mockState.csrfToken = csrfToken
  setBrowserCsrfCookie(csrfToken)
  return { ...account.user, current_policy_version: mockState.policyVersion }
}

function getAuthenticatedRecord(): MockAccountRecord | null {
  if (!mockState.activeEmail) {
    return null
  }
  return mockState.accounts.get(mockState.activeEmail) ?? null
}

function verifyCsrf(request: Request): Response | null {
  const headerToken = request.headers.get(CSRF_HEADER_NAME)
  if (!mockState.csrfToken || !headerToken || headerToken !== mockState.csrfToken) {
    return HttpResponse.json(
      {
        error: {
          code: 'csrf_failed',
          message: 'Header X-CSRF-TOKEN hilang atau tidak cocok.',
          details: {},
        },
      },
      { status: 403 },
    )
  }
  return null
}

function issueSessionForEmail(email: string): { user: Me; csrfCookieHeader: string } {
  const record = mockState.accounts.get(email)!
  record.user = {
    ...record.user,
    current_policy_version: mockState.policyVersion,
  }
  const token = `csrf-${++mockState.nextIdCounter}-token`
  mockState.activeEmail = email
  mockState.csrfToken = token
  setBrowserCsrfCookie(token)

  return {
    user: { ...record.user },
    csrfCookieHeader: `${CSRF_COOKIE_NAME}=${token}; Path=/; SameSite=Lax`,
  }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const handlers = [
  http.get('*/api/settings', () => {
    return HttpResponse.json(DEFAULT_MOCK_SETTINGS, { status: 200 })
  }),

  http.get('*/api/policy', () => {
    return HttpResponse.json(
      {
        version: mockState.policyVersion,
        text_markdown: mockState.policyMarkdown,
      },
      { status: 200 },
    )
  }),

  http.post('*/api/auth/register', async ({ request }) => {
    const body = (await request.json().catch(() => null)) as {
      email?: unknown
      password?: unknown
    } | null

    const rawEmail = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const rawPassword = typeof body?.password === 'string' ? body.password : ''

    const fields: Record<string, string> = {}
    if (!rawEmail || !EMAIL_REGEX.test(rawEmail)) {
      fields.email = 'Format email tidak valid'
    }
    if (rawPassword.length < 10) {
      fields.password = 'Password minimal 10 karakter'
    }

    if (Object.keys(fields).length > 0) {
      return HttpResponse.json(
        {
          error: {
            code: 'validation_error',
            message: 'Data pendaftaran tidak valid',
            details: { fields },
          },
        },
        { status: 400 },
      )
    }

    if (mockState.accounts.has(rawEmail)) {
      return HttpResponse.json(
        {
          error: {
            code: 'email_taken',
            message: 'Email sudah terdaftar',
            details: {},
          },
        },
        { status: 409 },
      )
    }

    const newUserId = `00000000-0000-4000-8000-${String(++mockState.nextIdCounter).padStart(12, '0')}`
    const newUser: Me = {
      id: newUserId,
      email: rawEmail,
      role: 'peserta',
      full_name: null,
      verification_status: 'belum_lengkap',
      consent: null,
      current_policy_version: mockState.policyVersion,
      team: null,
    }

    mockState.accounts.set(rawEmail, {
      password: rawPassword,
      user: newUser,
    })

    const { user, csrfCookieHeader } = issueSessionForEmail(rawEmail)
    return HttpResponse.json(
      { user },
      {
        status: 201,
        headers: {
          'Set-Cookie': csrfCookieHeader,
        },
      },
    )
  }),

  http.post('*/api/auth/login', async ({ request }) => {
    const body = (await request.json().catch(() => null)) as {
      email?: unknown
      password?: unknown
    } | null

    const rawEmail = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const rawPassword = typeof body?.password === 'string' ? body.password : ''

    const record = mockState.accounts.get(rawEmail)
    if (!record || record.password !== rawPassword) {
      return HttpResponse.json(
        {
          error: {
            code: 'invalid_credentials',
            message: 'Email atau password salah',
            details: {},
          },
        },
        { status: 401 },
      )
    }

    const { user, csrfCookieHeader } = issueSessionForEmail(rawEmail)
    return HttpResponse.json(
      { user },
      {
        status: 200,
        headers: {
          'Set-Cookie': csrfCookieHeader,
        },
      },
    )
  }),

  http.post('*/api/auth/logout', ({ request }) => {
    const csrfError = verifyCsrf(request)
    if (csrfError) {
      return csrfError
    }

    mockState.activeEmail = null
    mockState.csrfToken = null
    setBrowserCsrfCookie(null)

    return new HttpResponse(null, {
      status: 204,
      headers: {
        'Set-Cookie': `${CSRF_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`,
      },
    })
  }),

  http.get('*/api/me', () => {
    const record = getAuthenticatedRecord()
    if (!record) {
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
    }

    return HttpResponse.json(
      {
        ...record.user,
        current_policy_version: mockState.policyVersion,
      },
      { status: 200 },
    )
  }),

  http.post('*/api/consent', async ({ request }) => {
    const record = getAuthenticatedRecord()
    if (!record) {
      return HttpResponse.json(
        {
          error: {
            code: 'unauthenticated',
            message: 'Sesi belum aktif',
            details: {},
          },
        },
        { status: 401 },
      )
    }

    const csrfError = verifyCsrf(request)
    if (csrfError) {
      return csrfError
    }

    if (record.user.role !== 'peserta') {
      return HttpResponse.json(
        {
          error: {
            code: 'forbidden',
            message: 'Hanya peserta yang dapat menyetujui kebijakan privasi peserta',
            details: {},
          },
        },
        { status: 403 },
      )
    }

    const body = (await request.json().catch(() => null)) as {
      policy_version?: unknown
    } | null

    if (body?.policy_version !== mockState.policyVersion) {
      return HttpResponse.json(
        {
          error: {
            code: 'policy_outdated',
            message: 'Versi kebijakan privasi sudah usang, silakan muat ulang versi terbaru',
            details: {},
          },
        },
        { status: 409 },
      )
    }

    const consent: ConsentInfo = {
      policy_version: mockState.policyVersion,
      agreed_at: new Date().toISOString(),
    }

    record.user = {
      ...record.user,
      consent,
      current_policy_version: mockState.policyVersion,
    }

    return HttpResponse.json(consent, { status: 201 })
  }),

  http.post('*/api/documents/:type', async ({ request, params }) => {
    const record = getAuthenticatedRecord()
    if (!record) {
      return HttpResponse.json(
        {
          error: {
            code: 'unauthenticated',
            message: 'Sesi belum aktif',
            details: {},
          },
        },
        { status: 401 },
      )
    }

    const csrfError = verifyCsrf(request)
    if (csrfError) {
      return csrfError
    }

    const docType = String(params.type) as DocumentType
    if (!DOCUMENT_TYPES.includes(docType)) {
      return HttpResponse.json(
        {
          error: {
            code: 'not_found',
            message: 'Tipe dokumen tidak dikenal',
            details: {},
          },
        },
        { status: 404 },
      )
    }

    if (
      !record.user.consent ||
      record.user.consent.policy_version !== mockState.policyVersion
    ) {
      return HttpResponse.json(
        {
          error: {
            code: 'consent_required',
            message: 'Peserta belum menyetujui kebijakan privasi terbaru',
            details: {},
          },
        },
        { status: 403 },
      )
    }

    const rawBytes = await request.arrayBuffer()
    if (rawBytes.byteLength > DEFAULT_MOCK_SETTINGS.limits.document_max_bytes) {
      return HttpResponse.json(
        {
          error: {
            code: 'too_large',
            message: 'Ukuran dokumen melebihi batas 5 MB',
            details: {},
          },
        },
        { status: 413 },
      )
    }

    const encodedFilename = request.headers.get('X-Filename') ?? 'document.pdf'
    let originalFilename = encodedFilename
    try {
      originalFilename = decodeURIComponent(encodedFilename)
    } catch {
      originalFilename = encodedFilename
    }

    return HttpResponse.json(
      {
        item_id: `11111111-2222-4333-8444-${String(++mockState.nextIdCounter).padStart(12, '0')}`,
        field: docType,
        content_type: 'application/pdf',
        size_bytes: rawBytes.byteLength,
        original_filename: originalFilename,
        uploaded_at: new Date().toISOString(),
        verification_status: record.user.verification_status ?? 'belum_lengkap',
      },
      { status: 201 },
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
