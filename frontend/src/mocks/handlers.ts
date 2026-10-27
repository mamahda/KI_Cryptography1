import { http, HttpResponse } from 'msw'
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '../api/csrf'
import {
  DOCUMENT_TYPES,
  type ConsentInfo,
  type DocumentType,
  type ItemMeta,
  type Me,
  type ParticipantDocumentsResponse,
  type ParticipantProfile,
  type Team,
} from '../api/types'

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
  profile: ParticipantProfile
  documents: ParticipantDocumentsResponse
  team: Team | null
}

function createEmptyProfile(): ParticipantProfile {
  return {
    full_name: null,
    nim: null,
    study_program: null,
    institution: null,
    birth_date: null,
    domicile: null,
    phone: null,
    age: null,
    is_minor: null,
    profile_complete: false,
    verification_status: 'belum_lengkap',
    verification_note: null,
  }
}

function createEmptyDocuments(): ParticipantDocumentsResponse {
  return {
    ktp: null,
    ktm: null,
    twibbon: null,
    documents_complete: false,
  }
}

function createInitialAccounts(policyVersion: string): Map<string, MockAccountRecord> {
  const map = new Map<string, MockAccountRecord>()

  const budiId = 'b1a7c2d4-5e6f-4a8b-9c0d-1e2f3a4b5c6d'
  const budiTeam: Team = {
    id: '9c8b7a6d-5e4f-4321-8765-0fedcba98765',
    name: 'Tim Garuda',
    code: 'K7M2Q9XA',
    status: 'draft',
    leader_id: budiId,
    created_at: '2026-10-27T08:00:00+07:00',
    finalized_at: null,
    members: [
      {
        user_id: budiId,
        full_name: 'Budi Santoso',
        is_leader: true,
        profile_complete: true,
        documents_complete: true,
      },
      {
        user_id: 'd4e5f6a7-1111-4222-8333-444455556666',
        full_name: 'Sari Dewi',
        is_leader: false,
        profile_complete: true,
        documents_complete: false,
      },
    ],
    submission: {
      proposal: null,
      video: null,
      repo_url: null,
    },
    finalize_missing: ['proposal', 'video', 'repo_url', 'members_incomplete'],
  }

  map.set('budi@mahasiswa.ac.id', {
    password: 'rahasia-panjang-123',
    user: {
      id: budiId,
      email: 'budi@mahasiswa.ac.id',
      role: 'peserta',
      full_name: 'Budi Santoso',
      verification_status: 'menunggu',
      verification_note: null,
      consent: {
        policy_version: policyVersion,
        agreed_at: '2026-10-26T09:00:00+07:00',
      },
      current_policy_version: policyVersion,
      team: {
        id: budiTeam.id,
        name: budiTeam.name,
        status: budiTeam.status,
        is_leader: true,
      },
    },
    profile: {
      full_name: 'Budi Santoso',
      nim: '5025231001',
      study_program: 'Teknik Informatika',
      institution: 'Institut Teknologi Sepuluh Nopember',
      birth_date: '2005-03-14',
      domicile: 'Surabaya',
      phone: '081234567890',
      age: 21,
      is_minor: false,
      profile_complete: true,
      verification_status: 'menunggu',
      verification_note: null,
    },
    documents: {
      ktp: {
        item_id: '3f6c1e2a-8b4d-4c1f-9e7a-2b5d8c0f1a93',
        field: 'ktp',
        content_type: 'image/jpeg',
        size_bytes: 482_113,
        original_filename: 'ktp-budi.jpg',
        uploaded_at: '2026-10-26T10:15:00+07:00',
      },
      ktm: {
        item_id: '4a7d2f3b-9c5e-4d2a-8f8b-3c6e9d1a2b04',
        field: 'ktm',
        content_type: 'application/pdf',
        size_bytes: 612_400,
        original_filename: 'ktm-budi.pdf',
        uploaded_at: '2026-10-26T10:17:00+07:00',
      },
      twibbon: {
        item_id: '5b8e3a4c-0d6f-4e3b-9a9c-4d7f0e2b3c15',
        field: 'twibbon',
        content_type: 'image/png',
        size_bytes: 924_110,
        original_filename: 'twibbon-budi.png',
        uploaded_at: '2026-10-26T10:20:00+07:00',
      },
      documents_complete: true,
    },
    team: budiTeam,
  })

  map.set('ditolak@mahasiswa.ac.id', {
    password: 'rahasia-panjang-123',
    user: {
      id: 'f1e2d3c4-b5a6-4789-8012-3456789abcde',
      email: 'ditolak@mahasiswa.ac.id',
      role: 'peserta',
      full_name: 'Rina Wijaya',
      verification_status: 'ditolak',
      verification_note: 'Scan KTM tidak terbaca, mohon unggah ulang dokumen yang jelas.',
      consent: {
        policy_version: policyVersion,
        agreed_at: '2026-10-26T09:30:00+07:00',
      },
      current_policy_version: policyVersion,
      team: null,
    },
    profile: {
      full_name: 'Rina Wijaya',
      nim: '5025231099',
      study_program: 'Sistem Informasi',
      institution: 'Universitas Contoh',
      birth_date: '2005-07-22',
      domicile: 'Malang',
      phone: '081298765432',
      age: 21,
      is_minor: false,
      profile_complete: true,
      verification_status: 'ditolak',
      verification_note: 'Scan KTM tidak terbaca, mohon unggah ulang dokumen yang jelas.',
    },
    documents: {
      ktp: {
        item_id: '6c9f4b5d-1e70-4f4c-8b0d-5e801f3c4d26',
        field: 'ktp',
        content_type: 'image/jpeg',
        size_bytes: 350_000,
        original_filename: 'ktp-rina.jpg',
        uploaded_at: '2026-10-26T11:00:00+07:00',
      },
      ktm: {
        item_id: '7d0a5c6e-2f81-405d-9c1e-6f912a4d5e37',
        field: 'ktm',
        content_type: 'image/jpeg',
        size_bytes: 280_000,
        original_filename: 'ktm-rina-blur.jpg',
        uploaded_at: '2026-10-26T11:02:00+07:00',
      },
      twibbon: {
        item_id: '8e1b6d7f-3092-416e-8d2f-70a23b5e6f48',
        field: 'twibbon',
        content_type: 'image/png',
        size_bytes: 510_000,
        original_filename: 'twibbon-rina.png',
        uploaded_at: '2026-10-26T11:05:00+07:00',
      },
      documents_complete: true,
    },
    team: null,
  })

  map.set('baru@mahasiswa.ac.id', {
    password: 'rahasia-panjang-123',
    user: {
      id: 'c2b8d3e5-6f70-4b9c-8d1e-2f3a4b5c6d7e',
      email: 'baru@mahasiswa.ac.id',
      role: 'peserta',
      full_name: null,
      verification_status: 'belum_lengkap',
      verification_note: null,
      consent: null,
      current_policy_version: policyVersion,
      team: null,
    },
    profile: createEmptyProfile(),
    documents: createEmptyDocuments(),
    team: null,
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
    profile: createEmptyProfile(),
    documents: createEmptyDocuments(),
    team: null,
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
    profile: createEmptyProfile(),
    documents: createEmptyDocuments(),
    team: null,
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

function requirePesertaWithConsent(
  record: MockAccountRecord | null,
): { ok: true; record: MockAccountRecord } | { ok: false; response: Response } {
  if (!record) {
    return {
      ok: false,
      response: HttpResponse.json(
        {
          error: {
            code: 'unauthenticated',
            message: 'Sesi belum aktif atau sudah kedaluwarsa',
            details: {},
          },
        },
        { status: 401 },
      ),
    }
  }

  if (record.user.role !== 'peserta') {
    return {
      ok: false,
      response: HttpResponse.json(
        {
          error: {
            code: 'forbidden',
            message: 'Endpoint khusus peserta',
            details: {},
          },
        },
        { status: 403 },
      ),
    }
  }

  if (
    !record.user.consent ||
    record.user.consent.policy_version !== mockState.policyVersion
  ) {
    return {
      ok: false,
      response: HttpResponse.json(
        {
          error: {
            code: 'consent_required',
            message: 'Peserta belum menyetujui kebijakan privasi terbaru',
            details: {},
          },
        },
        { status: 403 },
      ),
    }
  }

  return { ok: true, record }
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
      verification_note: null,
      consent: null,
      current_policy_version: mockState.policyVersion,
      team: null,
    }

    mockState.accounts.set(rawEmail, {
      password: rawPassword,
      user: newUser,
      profile: createEmptyProfile(),
      documents: createEmptyDocuments(),
      team: null,
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

  http.get('*/api/profile', () => {
    const guard = requirePesertaWithConsent(getAuthenticatedRecord())
    if (!guard.ok) {
      return guard.response
    }
    return HttpResponse.json(guard.record.profile, { status: 200 })
  }),

  http.get('*/api/documents', () => {
    const guard = requirePesertaWithConsent(getAuthenticatedRecord())
    if (!guard.ok) {
      return guard.response
    }
    return HttpResponse.json(guard.record.documents, { status: 200 })
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

    const guard = requirePesertaWithConsent(record)
    if (!guard.ok) {
      return guard.response
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

    const newItem: ItemMeta = {
      item_id: `11111111-2222-4333-8444-${String(++mockState.nextIdCounter).padStart(12, '0')}`,
      field: docType,
      content_type: 'application/pdf',
      size_bytes: rawBytes.byteLength,
      original_filename: originalFilename,
      uploaded_at: new Date().toISOString(),
    }

    record.documents = {
      ...record.documents,
      [docType]: newItem,
    }
    const docsComplete = Boolean(
      record.documents.ktp && record.documents.ktm && record.documents.twibbon,
    )
    record.documents.documents_complete = docsComplete

    if (docsComplete && record.profile.profile_complete) {
      record.profile.verification_status = 'menunggu'
      record.profile.verification_note = null
      record.user.verification_status = 'menunggu'
      record.user.verification_note = null
    }

    return HttpResponse.json(
      {
        ...newItem,
        verification_status: record.profile.verification_status,
      },
      { status: 201 },
    )
  }),

  http.get('*/api/teams/me', () => {
    const guard = requirePesertaWithConsent(getAuthenticatedRecord())
    if (!guard.ok) {
      return guard.response
    }
    return HttpResponse.json({ team: guard.record.team }, { status: 200 })
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
