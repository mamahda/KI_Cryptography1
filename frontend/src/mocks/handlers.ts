import { http, HttpResponse } from 'msw'
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '../api/csrf'
import {
  DOCUMENT_TYPES,
  type ConsentInfo,
  type DocumentType,
  type FinalizeMissingItem,
  type ItemMeta,
  type Me,
  type ParticipantDocumentsResponse,
  type ParticipantProfile,
  type PublicSettings,
  type Team,
  type TeamStatus,
  type UpdateProfileRequest,
} from '../api/types'
import {
  DOCUMENT_ALLOWED_MIMES,
  detectMagicMimeFromBytes,
  type AllowedDocumentMime,
} from '../lib/fileValidation'
import {
  computeAgeFromBirthDate,
  getChangedReverifyFields,
  normalizeProfileInput,
  validateProfileForm,
} from '../lib/profileValidation'
import {
  normalizeInviteCode,
  normalizeRepoUrl,
  validateRepoUrl,
  validateTeamName,
} from '../lib/teamValidation'

export const DEFAULT_MOCK_SETTINGS: PublicSettings = {
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

/** Minimal valid 1x1 dark PNG (68 bytes) */
const MOCK_PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0x60, 0x60, 0x60, 0x00,
  0x00, 0x00, 0x04, 0x00, 0x01, 0xf6, 0x17, 0x38, 0x55, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
])

/** Minimal valid 1x1 grayscale JPEG */
const MOCK_JPEG_BYTES = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
  0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x03, 0x02, 0x02, 0x02, 0x02, 0x02, 0x03,
  0x02, 0x02, 0x02, 0x03, 0x03, 0x03, 0x03, 0x04, 0x06, 0x04, 0x04, 0x04, 0x04, 0x04, 0x08, 0x06,
  0x06, 0x05, 0x06, 0x09, 0x08, 0x0a, 0x0a, 0x09, 0x08, 0x09, 0x09, 0x0a, 0x0c, 0x0f, 0x0c, 0x0a,
  0x0b, 0x0e, 0x0b, 0x09, 0x09, 0x0d, 0x11, 0x0d, 0x0e, 0x0f, 0x10, 0x10, 0x11, 0x10, 0x0a, 0x0c,
  0x12, 0x13, 0x12, 0x10, 0x13, 0x0f, 0x10, 0x10, 0x10, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x09, 0xff, 0xc4, 0x00, 0x14,
  0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xd2, 0xcf, 0x20, 0xff,
  0xd9,
])

/** Minimal valid single-page PDF */
const MOCK_PDF_BYTES = new TextEncoder().encode(
  `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 68 >>
stream
BT /F1 16 Tf 72 720 Td (Schematics NIC Encrypted Document) Tj ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000241 00000 n 
0000000359 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
429
%%EOF`,
)

function defaultBytesForContentType(contentType: string): Uint8Array {
  if (contentType === 'image/png') {
    return MOCK_PNG_BYTES
  }
  if (contentType === 'application/pdf') {
    return MOCK_PDF_BYTES
  }
  return MOCK_JPEG_BYTES
}

interface MockStoredItem {
  meta: ItemMeta
  bytes: Uint8Array
  ownerEmail: string
  tampered: boolean
}

interface MockAccountRecord {
  password: string
  user: Me
  profile: ParticipantProfile
  documents: ParticipantDocumentsResponse
  teamId: string | null
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

function computeFinalizeMissing(team: Team, minTeamSize: number): FinalizeMissingItem[] {
  const missing: FinalizeMissingItem[] = []
  if (!team.submission.proposal) {
    missing.push('proposal')
  }
  if (!team.submission.video) {
    missing.push('video')
  }
  if (!team.submission.repo_url) {
    missing.push('repo_url')
  }
  if (team.members.length < minTeamSize) {
    missing.push('min_members')
  }
  if (team.members.some((m) => !m.profile_complete || !m.documents_complete)) {
    missing.push('members_incomplete')
  }
  return missing
}

function createInitialStateData(policyVersion: string): {
  accounts: Map<string, MockAccountRecord>
  teams: Map<string, Team>
  items: Map<string, MockStoredItem>
} {
  const accounts = new Map<string, MockAccountRecord>()
  const teams = new Map<string, Team>()
  const items = new Map<string, MockStoredItem>()

  function registerDocItem(ownerEmail: string, meta: ItemMeta): ItemMeta {
    items.set(meta.item_id, {
      meta,
      bytes: defaultBytesForContentType(meta.content_type),
      ownerEmail,
      tampered: false,
    })
    return meta
  }

  const budiId = 'b1a7c2d4-5e6f-4a8b-9c0d-1e2f3a4b5c6d'
  const sariId = 'd4e5f6a7-1111-4222-8333-444455556666'
  const garudaTeamId = '9c8b7a6d-5e4f-4321-8765-0fedcba98765'

  const garudaTeam: Team = {
    id: garudaTeamId,
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
        user_id: sariId,
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

  teams.set(garudaTeam.id, garudaTeam)

  accounts.set('budi@mahasiswa.ac.id', {
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
        id: garudaTeam.id,
        name: garudaTeam.name,
        status: garudaTeam.status,
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
      ktp: registerDocItem('budi@mahasiswa.ac.id', {
        item_id: '3f6c1e2a-8b4d-4c1f-9e7a-2b5d8c0f1a93',
        field: 'ktp',
        content_type: 'image/jpeg',
        size_bytes: 482_113,
        original_filename: 'ktp-budi.jpg',
        uploaded_at: '2026-10-26T10:15:00+07:00',
      }),
      ktm: registerDocItem('budi@mahasiswa.ac.id', {
        item_id: '4a7d2f3b-9c5e-4d2a-8f8b-3c6e9d1a2b04',
        field: 'ktm',
        content_type: 'application/pdf',
        size_bytes: 612_400,
        original_filename: 'ktm-budi.pdf',
        uploaded_at: '2026-10-26T10:17:00+07:00',
      }),
      twibbon: registerDocItem('budi@mahasiswa.ac.id', {
        item_id: '5b8e3a4c-0d6f-4e3b-9a9c-4d7f0e2b3c15',
        field: 'twibbon',
        content_type: 'image/png',
        size_bytes: 924_110,
        original_filename: 'twibbon-budi.png',
        uploaded_at: '2026-10-26T10:20:00+07:00',
      }),
      documents_complete: true,
    },
    teamId: garudaTeam.id,
  })

  accounts.set('sari@mahasiswa.ac.id', {
    password: 'rahasia-panjang-123',
    user: {
      id: sariId,
      email: 'sari@mahasiswa.ac.id',
      role: 'peserta',
      full_name: 'Sari Dewi',
      verification_status: 'belum_lengkap',
      verification_note: null,
      consent: {
        policy_version: policyVersion,
        agreed_at: '2026-10-26T09:05:00+07:00',
      },
      current_policy_version: policyVersion,
      team: {
        id: garudaTeam.id,
        name: garudaTeam.name,
        status: garudaTeam.status,
        is_leader: false,
      },
    },
    profile: {
      full_name: 'Sari Dewi',
      nim: '5025231045',
      study_program: 'Teknik Informatika',
      institution: 'Institut Teknologi Sepuluh Nopember',
      birth_date: '2005-08-19',
      domicile: 'Surabaya',
      phone: '081234560011',
      age: 21,
      is_minor: false,
      profile_complete: true,
      verification_status: 'belum_lengkap',
      verification_note: null,
    },
    documents: {
      ktp: registerDocItem('sari@mahasiswa.ac.id', {
        item_id: '8a1b2c3d-1111-4222-8333-444455557701',
        field: 'ktp',
        content_type: 'image/jpeg',
        size_bytes: 390_100,
        original_filename: 'ktp-sari.jpg',
        uploaded_at: '2026-10-26T10:22:00+07:00',
      }),
      ktm: registerDocItem('sari@mahasiswa.ac.id', {
        item_id: '8a1b2c3d-1111-4222-8333-444455557702',
        field: 'ktm',
        content_type: 'application/pdf',
        size_bytes: 410_200,
        original_filename: 'ktm-sari.pdf',
        uploaded_at: '2026-10-26T10:25:00+07:00',
      }),
      twibbon: null,
      documents_complete: false,
    },
    teamId: garudaTeam.id,
  })

  accounts.set('terverifikasi@mahasiswa.ac.id', {
    password: 'rahasia-panjang-123',
    user: {
      id: 'a1b2c3d4-9999-4888-8777-666655554444',
      email: 'terverifikasi@mahasiswa.ac.id',
      role: 'peserta',
      full_name: 'Nadia Putri',
      verification_status: 'terverifikasi',
      verification_note: null,
      consent: {
        policy_version: policyVersion,
        agreed_at: '2026-10-26T09:10:00+07:00',
      },
      current_policy_version: policyVersion,
      team: null,
    },
    profile: {
      full_name: 'Nadia Putri',
      nim: '5025221088',
      study_program: 'Teknik Komputer',
      institution: 'Institut Teknologi Sepuluh Nopember',
      birth_date: '2004-11-05',
      domicile: 'Sidoarjo',
      phone: '+6281234567891',
      age: 21,
      is_minor: false,
      profile_complete: true,
      verification_status: 'terverifikasi',
      verification_note: null,
    },
    documents: {
      ktp: registerDocItem('terverifikasi@mahasiswa.ac.id', {
        item_id: '9a1b2c3d-1111-4222-8333-444455556601',
        field: 'ktp',
        content_type: 'image/jpeg',
        size_bytes: 310_200,
        original_filename: 'ktp-nadia.jpg',
        uploaded_at: '2026-10-26T10:30:00+07:00',
      }),
      ktm: registerDocItem('terverifikasi@mahasiswa.ac.id', {
        item_id: '9a1b2c3d-1111-4222-8333-444455556602',
        field: 'ktm',
        content_type: 'application/pdf',
        size_bytes: 420_500,
        original_filename: 'ktm-nadia.pdf',
        uploaded_at: '2026-10-26T10:32:00+07:00',
      }),
      twibbon: registerDocItem('terverifikasi@mahasiswa.ac.id', {
        item_id: '9a1b2c3d-1111-4222-8333-444455556603',
        field: 'twibbon',
        content_type: 'image/png',
        size_bytes: 512_000,
        original_filename: 'twibbon-nadia.png',
        uploaded_at: '2026-10-26T10:35:00+07:00',
      }),
      documents_complete: true,
    },
    teamId: null,
  })

  accounts.set('ditolak@mahasiswa.ac.id', {
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
      ktp: registerDocItem('ditolak@mahasiswa.ac.id', {
        item_id: '6c9f4b5d-1e70-4f4c-8b0d-5e801f3c4d26',
        field: 'ktp',
        content_type: 'image/jpeg',
        size_bytes: 350_000,
        original_filename: 'ktp-rina.jpg',
        uploaded_at: '2026-10-26T11:00:00+07:00',
      }),
      ktm: registerDocItem('ditolak@mahasiswa.ac.id', {
        item_id: '7d0a5c6e-2f81-405d-9c1e-6f912a4d5e37',
        field: 'ktm',
        content_type: 'image/jpeg',
        size_bytes: 280_000,
        original_filename: 'ktm-rina-blur.jpg',
        uploaded_at: '2026-10-26T11:02:00+07:00',
      }),
      twibbon: registerDocItem('ditolak@mahasiswa.ac.id', {
        item_id: '8e1b6d7f-3092-416e-8d2f-70a23b5e6f48',
        field: 'twibbon',
        content_type: 'image/png',
        size_bytes: 510_000,
        original_filename: 'twibbon-rina.png',
        uploaded_at: '2026-10-26T11:05:00+07:00',
      }),
      documents_complete: true,
    },
    teamId: null,
  })

  accounts.set('baru@mahasiswa.ac.id', {
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
    teamId: null,
  })

  accounts.set('juri1@panitia.id', {
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
    teamId: null,
  })

  accounts.set('admin@panitia.id', {
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
    teamId: null,
  })

  return { accounts, teams, items }
}

interface MockServerState {
  settings: PublicSettings
  policyVersion: string
  policyMarkdown: string
  accounts: Map<string, MockAccountRecord>
  teams: Map<string, Team>
  items: Map<string, MockStoredItem>
  activeEmail: string | null
  csrfToken: string | null
  nextIdCounter: number
}

const initialSeed = createInitialStateData(DEFAULT_POLICY_VERSION)

const mockState: MockServerState = {
  settings: structuredClone(DEFAULT_MOCK_SETTINGS),
  policyVersion: DEFAULT_POLICY_VERSION,
  policyMarkdown: DEFAULT_POLICY_MARKDOWN,
  accounts: initialSeed.accounts,
  teams: initialSeed.teams,
  items: initialSeed.items,
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

function findAccountByUserId(userId: string): MockAccountRecord | null {
  for (const account of mockState.accounts.values()) {
    if (account.user.id === userId) {
      return account
    }
  }
  return null
}

function syncTeamDerivedState(team: Team): Team {
  const updated: Team = {
    ...team,
    finalize_missing: computeFinalizeMissing(team, mockState.settings.min_team_size),
  }
  mockState.teams.set(updated.id, updated)

  for (const member of updated.members) {
    const account = findAccountByUserId(member.user_id)
    if (account) {
      account.teamId = updated.id
      account.user = {
        ...account.user,
        team: {
          id: updated.id,
          name: updated.name,
          status: updated.status,
          is_leader: updated.leader_id === account.user.id,
        },
      }
    }
  }

  return updated
}

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generateMockInviteCode(seed: number): string {
  let value = seed * 7919 + 104729
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += INVITE_ALPHABET[value % INVITE_ALPHABET.length]
    value = Math.floor(value / 7) + (i + 3) * 31
  }
  return code
}

export function resetMockState(): void {
  const fresh = createInitialStateData(DEFAULT_POLICY_VERSION)
  mockState.settings = structuredClone(DEFAULT_MOCK_SETTINGS)
  mockState.policyVersion = DEFAULT_POLICY_VERSION
  mockState.policyMarkdown = DEFAULT_POLICY_MARKDOWN
  mockState.accounts = fresh.accounts
  mockState.teams = fresh.teams
  mockState.items = fresh.items
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

export function setMockRegistrationDeadline(deadlineIso: string): void {
  mockState.settings = {
    ...mockState.settings,
    registration_deadline: deadlineIso,
  }
}

export function setMockMaxTeamSize(maxTeamSize: number): void {
  mockState.settings = {
    ...mockState.settings,
    max_team_size: maxTeamSize,
  }
}

export function setMockTeamStatus(teamId: string, status: TeamStatus): boolean {
  const existing = mockState.teams.get(teamId)
  if (!existing) {
    return false
  }
  const updated: Team = {
    ...existing,
    status,
    finalized_at: status === 'final' ? new Date().toISOString() : null,
  }
  syncTeamDerivedState(updated)
  return true
}

export function tamperMockItem(itemId: string, tampered = true): boolean {
  const stored = mockState.items.get(itemId)
  if (!stored) {
    return false
  }
  stored.tampered = tampered
  return true
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

function isRegistrationDeadlinePassed(): boolean {
  const targetMs = Date.parse(mockState.settings.registration_deadline)
  return !Number.isNaN(targetMs) && Date.now() > targetMs
}

function isSubmissionDeadlinePassed(): boolean {
  const targetMs = Date.parse(mockState.settings.submission_deadline)
  return !Number.isNaN(targetMs) && Date.now() > targetMs
}

/**
 * Shared gate for the three leader-only submission endpoints: an authenticated
 * `peserta` who leads a team that is still `draft`, before the submission deadline.
 */
function requireSubmissionLeader(request: Request):
  | { ok: true; record: MockAccountRecord; team: Team }
  | { ok: false; response: Response } {
  const rawRecord = getAuthenticatedRecord()
  if (!rawRecord) {
    return {
      ok: false,
      response: HttpResponse.json(
        { error: { code: 'unauthenticated', message: 'Sesi belum aktif', details: {} } },
        { status: 401 },
      ),
    }
  }

  const csrfError = verifyCsrf(request)
  if (csrfError) {
    return { ok: false, response: csrfError }
  }

  const guard = requirePesertaWithConsent(rawRecord)
  if (!guard.ok) {
    return { ok: false, response: guard.response }
  }
  const { record } = guard

  const team = record.teamId ? (mockState.teams.get(record.teamId) ?? null) : null
  if (!team || team.leader_id !== record.user.id) {
    return {
      ok: false,
      response: HttpResponse.json(
        {
          error: {
            code: 'not_leader',
            message: 'Hanya Ketua Tim yang dapat mengubah submission.',
            details: {},
          },
        },
        { status: 403 },
      ),
    }
  }

  if (team.status === 'final') {
    return {
      ok: false,
      response: HttpResponse.json(
        {
          error: {
            code: 'team_locked',
            message: 'Tim sudah difinalisasi sehingga submission tidak dapat diubah.',
            details: {},
          },
        },
        { status: 409 },
      ),
    }
  }

  if (isSubmissionDeadlinePassed()) {
    return {
      ok: false,
      response: HttpResponse.json(
        {
          error: {
            code: 'deadline_passed',
            message: 'Tenggat pengumpulan karya telah terlewat.',
            details: {},
          },
        },
        { status: 409 },
      ),
    }
  }

  return { ok: true, record, team }
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
    return HttpResponse.json(mockState.settings, { status: 200 })
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
      teamId: null,
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

  http.put('*/api/profile', async ({ request }) => {
    const rawRecord = getAuthenticatedRecord()
    if (!rawRecord) {
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

    const guard = requirePesertaWithConsent(rawRecord)
    if (!guard.ok) {
      return guard.response
    }
    const { record } = guard

    if (isRegistrationDeadlinePassed()) {
      return HttpResponse.json(
        {
          error: {
            code: 'deadline_passed',
            message: 'Tenggat pendaftaran telah terlewat.',
            details: {},
          },
        },
        { status: 409 },
      )
    }

    const body = (await request.json().catch(() => null)) as Partial<
      Record<keyof UpdateProfileRequest, unknown>
    > | null

    const candidate: UpdateProfileRequest = {
      full_name: typeof body?.full_name === 'string' ? body.full_name : '',
      nim: typeof body?.nim === 'string' ? body.nim : '',
      study_program: typeof body?.study_program === 'string' ? body.study_program : '',
      institution: typeof body?.institution === 'string' ? body.institution : '',
      birth_date: typeof body?.birth_date === 'string' ? body.birth_date : '',
      domicile: typeof body?.domicile === 'string' ? body.domicile : '',
      phone: typeof body?.phone === 'string' ? body.phone : '',
    }

    const fieldErrors = validateProfileForm(candidate)
    if (Object.keys(fieldErrors).length > 0) {
      return HttpResponse.json(
        {
          error: {
            code: 'validation_error',
            message: 'Data tidak valid',
            details: { fields: fieldErrors },
          },
        },
        { status: 400 },
      )
    }

    const normalized = normalizeProfileInput(candidate)
    const changedSensitive = getChangedReverifyFields(record.profile, normalized)
    const age = computeAgeFromBirthDate(normalized.birth_date)
    const isMinor = age !== null ? age < 18 : null

    let nextStatus = record.profile.verification_status
    let nextNote = record.profile.verification_note ?? null

    if (nextStatus === 'terverifikasi' && changedSensitive.length > 0) {
      nextStatus = 'menunggu'
      nextNote = null
    } else if (
      (nextStatus === 'belum_lengkap' || nextStatus === 'ditolak') &&
      record.documents.documents_complete
    ) {
      nextStatus = 'menunggu'
      nextNote = null
    }

    record.profile = {
      ...normalized,
      age,
      is_minor: isMinor,
      profile_complete: true,
      verification_status: nextStatus,
      verification_note: nextNote,
    }

    record.user = {
      ...record.user,
      full_name: normalized.full_name,
      verification_status: nextStatus,
      verification_note: nextNote,
    }

    if (record.teamId) {
      const existingTeam = mockState.teams.get(record.teamId)
      if (existingTeam) {
        syncTeamDerivedState({
          ...existingTeam,
          members: existingTeam.members.map((m) =>
            m.user_id === record.user.id
              ? { ...m, full_name: normalized.full_name, profile_complete: true }
              : m,
          ),
        })
      }
    }

    return HttpResponse.json(record.profile, { status: 200 })
  }),

  http.get('*/api/documents', () => {
    const guard = requirePesertaWithConsent(getAuthenticatedRecord())
    if (!guard.ok) {
      return guard.response
    }
    return HttpResponse.json(guard.record.documents, { status: 200 })
  }),

  http.post('*/api/documents/:type', async ({ request, params }) => {
    const rawRecord = getAuthenticatedRecord()
    if (!rawRecord) {
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

    const guard = requirePesertaWithConsent(rawRecord)
    if (!guard.ok) {
      return guard.response
    }
    const { record } = guard

    if (isRegistrationDeadlinePassed()) {
      return HttpResponse.json(
        {
          error: {
            code: 'deadline_passed',
            message: 'Tenggat pendaftaran telah terlewat.',
            details: {},
          },
        },
        { status: 409 },
      )
    }

    const rawBuffer = await request.arrayBuffer()
    const rawBytes = new Uint8Array(rawBuffer)

    if (rawBytes.byteLength > mockState.settings.limits.document_max_bytes) {
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

    const detectedMime = detectMagicMimeFromBytes(rawBytes)
    if (
      rawBytes.byteLength === 0 ||
      !detectedMime ||
      !(DOCUMENT_ALLOWED_MIMES as readonly string[]).includes(detectedMime)
    ) {
      return HttpResponse.json(
        {
          error: {
            code: 'unsupported_type',
            message: 'Tipe file (dari magic bytes) tidak diizinkan. Gunakan JPG, PNG, atau PDF.',
            details: {},
          },
        },
        { status: 415 },
      )
    }

    const validatedMime = detectedMime as AllowedDocumentMime

    const encodedFilename = request.headers.get('X-Filename') ?? `${docType}.pdf`
    let originalFilename = encodedFilename
    try {
      originalFilename = decodeURIComponent(encodedFilename)
    } catch {
      originalFilename = encodedFilename
    }

    const previousItem = record.documents[docType]
    if (previousItem) {
      mockState.items.delete(previousItem.item_id)
    }

    const newItem: ItemMeta = {
      item_id: `11111111-2222-4333-8444-${String(++mockState.nextIdCounter).padStart(12, '0')}`,
      field: docType,
      content_type: validatedMime,
      size_bytes: rawBytes.byteLength,
      original_filename: originalFilename,
      uploaded_at: new Date().toISOString(),
    }

    mockState.items.set(newItem.item_id, {
      meta: newItem,
      bytes: rawBytes,
      ownerEmail: record.user.email,
      tampered: false,
    })

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

    if (record.teamId) {
      const existingTeam = mockState.teams.get(record.teamId)
      if (existingTeam) {
        syncTeamDerivedState({
          ...existingTeam,
          members: existingTeam.members.map((m) =>
            m.user_id === record.user.id ? { ...m, documents_complete: docsComplete } : m,
          ),
        })
      }
    }

    return HttpResponse.json(
      {
        ...newItem,
        verification_status: record.profile.verification_status,
      },
      { status: 201 },
    )
  }),

  http.get('*/api/items/:itemId', ({ request, params }) => {
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

    const itemId = String(params.itemId)
    const stored = mockState.items.get(itemId)

    const canAccess =
      stored &&
      (record.user.role === 'superadmin' ||
        (record.user.role === 'peserta' && stored.ownerEmail === record.user.email))

    if (!stored || !canAccess) {
      return HttpResponse.json(
        {
          error: {
            code: 'not_found',
            message: 'File tidak ditemukan atau Anda tidak memiliki hak akses.',
            details: {},
          },
        },
        { status: 404 },
      )
    }

    if (stored.tampered) {
      return HttpResponse.json(
        {
          error: {
            code: 'integrity_error',
            message: 'HMAC atau pencocokan tiga cipher gagal; insiden dicatat.',
            details: {},
          },
        },
        { status: 500 },
      )
    }

    const url = new URL(request.url)
    const isDownload = url.searchParams.get('download') === '1'
    const dispositionType = isDownload ? 'attachment' : 'inline'
    const encodedName = encodeURIComponent(stored.meta.original_filename)

    const payloadBuffer = stored.bytes.buffer.slice(
      stored.bytes.byteOffset,
      stored.bytes.byteOffset + stored.bytes.byteLength,
    ) as ArrayBuffer

    return new HttpResponse(payloadBuffer, {
      status: 200,
      headers: {
        'Content-Type': stored.meta.content_type,
        'Content-Length': String(stored.bytes.byteLength),
        'Content-Disposition': `${dispositionType}; filename*=UTF-8''${encodedName}`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }),

  http.post('*/api/teams', async ({ request }) => {
    const rawRecord = getAuthenticatedRecord()
    if (!rawRecord) {
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

    const guard = requirePesertaWithConsent(rawRecord)
    if (!guard.ok) {
      return guard.response
    }
    const { record } = guard

    if (isRegistrationDeadlinePassed()) {
      return HttpResponse.json(
        {
          error: {
            code: 'deadline_passed',
            message: 'Tenggat pendaftaran telah terlewat.',
            details: {},
          },
        },
        { status: 409 },
      )
    }

    if (record.teamId !== null) {
      return HttpResponse.json(
        {
          error: {
            code: 'already_in_team',
            message: 'Anda sudah tergabung di dalam sebuah tim.',
            details: {},
          },
        },
        { status: 409 },
      )
    }

    const body = (await request.json().catch(() => null)) as { name?: unknown } | null
    const rawName = typeof body?.name === 'string' ? body.name : ''
    const nameError = validateTeamName(rawName)
    if (nameError) {
      return HttpResponse.json(
        {
          error: {
            code: 'validation_error',
            message: 'Nama tim tidak valid',
            details: { fields: { name: nameError } },
          },
        },
        { status: 400 },
      )
    }

    const counter = ++mockState.nextIdCounter
    const newTeamId = `22222222-3333-4444-8555-${String(counter).padStart(12, '0')}`
    const trimmedName = rawName.trim()

    let inviteCode = generateMockInviteCode(counter)
    const existingCodes = new Set(Array.from(mockState.teams.values(), (t) => t.code))
    let attempt = counter
    while (existingCodes.has(inviteCode)) {
      inviteCode = generateMockInviteCode(++attempt)
    }

    const createdTeam: Team = {
      id: newTeamId,
      name: trimmedName,
      code: inviteCode,
      status: 'draft',
      leader_id: record.user.id,
      created_at: new Date().toISOString(),
      finalized_at: null,
      members: [
        {
          user_id: record.user.id,
          full_name: record.profile.full_name,
          is_leader: true,
          profile_complete: record.profile.profile_complete,
          documents_complete: record.documents.documents_complete,
        },
      ],
      submission: {
        proposal: null,
        video: null,
        repo_url: null,
      },
      finalize_missing: [],
    }

    const synced = syncTeamDerivedState(createdTeam)
    return HttpResponse.json({ team: synced }, { status: 201 })
  }),

  http.post('*/api/teams/join', async ({ request }) => {
    const rawRecord = getAuthenticatedRecord()
    if (!rawRecord) {
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

    const guard = requirePesertaWithConsent(rawRecord)
    if (!guard.ok) {
      return guard.response
    }
    const { record } = guard

    if (record.teamId !== null) {
      return HttpResponse.json(
        {
          error: {
            code: 'already_in_team',
            message: 'Anda sudah tergabung di dalam sebuah tim.',
            details: {},
          },
        },
        { status: 409 },
      )
    }

    const body = (await request.json().catch(() => null)) as { code?: unknown } | null
    const rawCode = typeof body?.code === 'string' ? body.code : ''
    const normalizedCode = normalizeInviteCode(rawCode)

    if (!normalizedCode) {
      return HttpResponse.json(
        {
          error: {
            code: 'validation_error',
            message: 'Kode tim wajib diisi.',
            details: { fields: { code: 'Kode undangan wajib diisi.' } },
          },
        },
        { status: 400 },
      )
    }

    const targetTeam = Array.from(mockState.teams.values()).find(
      (t) => t.code.toUpperCase() === normalizedCode,
    )

    if (!targetTeam) {
      return HttpResponse.json(
        {
          error: {
            code: 'not_found',
            message: 'Kode tim tidak ditemukan. Periksa kembali kode undangan 8 karakter Anda.',
            details: {},
          },
        },
        { status: 404 },
      )
    }

    if (targetTeam.status === 'final') {
      return HttpResponse.json(
        {
          error: {
            code: 'team_locked',
            message: 'Tim sudah berstatus Final dan terkunci dari penambahan anggota baru.',
            details: {},
          },
        },
        { status: 409 },
      )
    }

    if (targetTeam.members.length >= mockState.settings.max_team_size) {
      return HttpResponse.json(
        {
          error: {
            code: 'team_full',
            message: `Tim sudah penuh (maksimal ${mockState.settings.max_team_size} anggota).`,
            details: {},
          },
        },
        { status: 409 },
      )
    }

    const updatedTeam = syncTeamDerivedState({
      ...targetTeam,
      members: [
        ...targetTeam.members,
        {
          user_id: record.user.id,
          full_name: record.profile.full_name,
          is_leader: false,
          profile_complete: record.profile.profile_complete,
          documents_complete: record.documents.documents_complete,
        },
      ],
    })

    return HttpResponse.json({ team: updatedTeam }, { status: 200 })
  }),

  http.get('*/api/teams/me', () => {
    const guard = requirePesertaWithConsent(getAuthenticatedRecord())
    if (!guard.ok) {
      return guard.response
    }
    const team = guard.record.teamId ? (mockState.teams.get(guard.record.teamId) ?? null) : null
    return HttpResponse.json({ team }, { status: 200 })
  }),

  http.post('*/api/teams/me/leave', ({ request }) => {
    const rawRecord = getAuthenticatedRecord()
    if (!rawRecord) {
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

    const guard = requirePesertaWithConsent(rawRecord)
    if (!guard.ok) {
      return guard.response
    }
    const { record } = guard

    if (!record.teamId) {
      return HttpResponse.json(
        {
          error: {
            code: 'no_team',
            message: 'Anda belum tergabung dalam tim mana pun.',
            details: {},
          },
        },
        { status: 409 },
      )
    }

    const team = mockState.teams.get(record.teamId)
    if (!team) {
      record.teamId = null
      record.user = { ...record.user, team: null }
      return HttpResponse.json(
        {
          error: {
            code: 'no_team',
            message: 'Tim tidak ditemukan.',
            details: {},
          },
        },
        { status: 409 },
      )
    }

    if (team.status === 'final') {
      return HttpResponse.json(
        {
          error: {
            code: 'team_locked',
            message: 'Tim sudah difinalisasi sehingga anggota tidak dapat keluar.',
            details: {},
          },
        },
        { status: 409 },
      )
    }

    if (team.leader_id === record.user.id) {
      return HttpResponse.json(
        {
          error: {
            code: 'leader_cannot_leave',
            message: 'Ketua tim tidak dapat keluar dari tim.',
            details: {},
          },
        },
        { status: 409 },
      )
    }

    record.teamId = null
    record.user = { ...record.user, team: null }

    syncTeamDerivedState({
      ...team,
      members: team.members.filter((m) => m.user_id !== record.user.id),
    })

    return new HttpResponse(null, { status: 204 })
  }),

  http.delete('*/api/teams/me/members/:userId', ({ request, params }) => {
    const rawRecord = getAuthenticatedRecord()
    if (!rawRecord) {
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

    const guard = requirePesertaWithConsent(rawRecord)
    if (!guard.ok) {
      return guard.response
    }
    const { record } = guard

    const team = record.teamId ? (mockState.teams.get(record.teamId) ?? null) : null
    if (!team) {
      return HttpResponse.json(
        {
          error: {
            code: 'not_found',
            message: 'Anda belum memiliki tim.',
            details: {},
          },
        },
        { status: 404 },
      )
    }

    if (team.leader_id !== record.user.id) {
      return HttpResponse.json(
        {
          error: {
            code: 'not_leader',
            message: 'Hanya Ketua Tim yang dapat mengeluarkan anggota.',
            details: {},
          },
        },
        { status: 403 },
      )
    }

    if (team.status === 'final') {
      return HttpResponse.json(
        {
          error: {
            code: 'team_locked',
            message: 'Tim sudah berstatus Final sehingga susunan anggota terkunci.',
            details: {},
          },
        },
        { status: 409 },
      )
    }

    const targetUserId = String(params.userId)
    const memberExists = team.members.some(
      (m) => m.user_id === targetUserId && !m.is_leader,
    )
    if (!memberExists) {
      return HttpResponse.json(
        {
          error: {
            code: 'not_found',
            message: 'Anggota tidak ditemukan pada tim ini.',
            details: {},
          },
        },
        { status: 404 },
      )
    }

    const kickedAccount = findAccountByUserId(targetUserId)
    if (kickedAccount) {
      kickedAccount.teamId = null
      kickedAccount.user = { ...kickedAccount.user, team: null }
    }

    syncTeamDerivedState({
      ...team,
      members: team.members.filter((m) => m.user_id !== targetUserId),
    })

    return new HttpResponse(null, { status: 204 })
  }),

  http.post('*/api/teams/me/proposal', async ({ request }) => {
    const gate = requireSubmissionLeader(request)
    if (!gate.ok) {
      return gate.response
    }
    const { record, team } = gate

    const rawBytes = new Uint8Array(await request.arrayBuffer())

    if (rawBytes.byteLength > mockState.settings.limits.proposal_max_bytes) {
      return HttpResponse.json(
        {
          error: { code: 'too_large', message: 'Ukuran proposal melebihi batas 10 MB', details: {} },
        },
        { status: 413 },
      )
    }

    if (rawBytes.byteLength === 0 || detectMagicMimeFromBytes(rawBytes) !== 'application/pdf') {
      return HttpResponse.json(
        {
          error: {
            code: 'unsupported_type',
            message: 'Proposal harus berupa file PDF.',
            details: {},
          },
        },
        { status: 415 },
      )
    }

    const encodedFilename = request.headers.get('X-Filename') ?? 'proposal.pdf'
    let originalFilename = encodedFilename
    try {
      originalFilename = decodeURIComponent(encodedFilename)
    } catch {
      originalFilename = encodedFilename
    }

    // Re-uploading replaces the previous version.
    const previous = team.submission.proposal
    if (previous) {
      mockState.items.delete(previous.item_id)
    }

    const newItem: ItemMeta = {
      item_id: `33333333-4444-4555-8666-${String(++mockState.nextIdCounter).padStart(12, '0')}`,
      field: 'proposal',
      content_type: 'application/pdf',
      size_bytes: rawBytes.byteLength,
      original_filename: originalFilename,
      uploaded_at: new Date().toISOString(),
    }

    mockState.items.set(newItem.item_id, {
      meta: newItem,
      bytes: rawBytes,
      ownerEmail: record.user.email,
      tampered: false,
    })

    syncTeamDerivedState({
      ...team,
      submission: { ...team.submission, proposal: newItem },
    })

    return HttpResponse.json(newItem, { status: 201 })
  }),

  http.put('*/api/teams/me/repo', async ({ request }) => {
    const gate = requireSubmissionLeader(request)
    if (!gate.ok) {
      return gate.response
    }
    const { team } = gate

    const body = (await request.json().catch(() => null)) as { repo_url?: unknown } | null
    const rawUrl = typeof body?.repo_url === 'string' ? body.repo_url : ''
    const urlError = validateRepoUrl(rawUrl)
    if (urlError) {
      return HttpResponse.json(
        {
          error: {
            code: 'validation_error',
            message: 'Data tidak valid',
            details: { fields: { repo_url: urlError } },
          },
        },
        { status: 400 },
      )
    }

    const normalizedUrl = normalizeRepoUrl(rawUrl)
    syncTeamDerivedState({
      ...team,
      submission: { ...team.submission, repo_url: normalizedUrl },
    })

    return HttpResponse.json({ repo_url: normalizedUrl }, { status: 200 })
  }),

  http.post('*/api/teams/me/finalize', async ({ request }) => {
    const gate = requireSubmissionLeader(request)
    if (!gate.ok) {
      return gate.response
    }
    const { team } = gate

    const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null
    if (body?.confirm !== true) {
      return HttpResponse.json(
        {
          error: {
            code: 'validation_error',
            message: 'Konfirmasi submit final wajib dikirim.',
            details: { fields: { confirm: 'Nilai confirm harus true.' } },
          },
        },
        { status: 400 },
      )
    }

    const missing = computeFinalizeMissing(team, mockState.settings.min_team_size)
    if (missing.length > 0) {
      return HttpResponse.json(
        {
          error: {
            code: 'finalize_requirements',
            message: 'Syarat submit final belum lengkap.',
            details: { missing },
          },
        },
        { status: 409 },
      )
    }

    const finalized = syncTeamDerivedState({
      ...team,
      status: 'final',
      finalized_at: new Date().toISOString(),
    })

    return HttpResponse.json({ team: finalized }, { status: 200 })
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
