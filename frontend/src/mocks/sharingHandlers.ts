/**
 * Development-only mock of the sharing endpoints (KONTRAK_SHARING_ASSIGNMENT_2.md
 * section 4) so the sharing UI works before the real backend is wired in. It
 * produces genuine ciphertexts and RSA-wrapped keys, so the browser decryption
 * path is exercised for real. Remove together with the other mocks once the
 * backend routers are registered.
 */
import { http, HttpResponse } from 'msw'
import {
  MAX_SHARED_ITEMS,
  SHARE_KEYS_FORMAT,
  type SharingAvailableItem,
  type SharingItemMetadata,
  type SharingKeyFile,
  type SharingPublicKey,
  type SharingRequest,
} from '../api'

interface MockSession {
  id: string
}

interface Gate {
  requireRole: (role: 'peserta') => { ok: true; record: { user: MockSession } } | { ok: false; response: Response }
  verifyCsrf: (request: Request) => Response | null
}

interface SampleItem {
  field: string
  content_type: string | null
  bytes: Uint8Array<ArrayBuffer>
}

interface StoredShare {
  request: SharingRequest
  keyFile: SharingKeyFile | null
  items: SharingItemMetadata[]
  ciphertexts: Map<string, ArrayBuffer>
}

/** A 1x1 transparent PNG, standing in for a KTP scan. */
const TINY_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (char) => char.charCodeAt(0),
)

const encoder = new TextEncoder()

const SAMPLE_ITEMS: SampleItem[] = [
  { field: 'full_name', content_type: null, bytes: encoder.encode('Budi Santoso') },
  { field: 'nim', content_type: null, bytes: encoder.encode('5025211001') },
  { field: 'institution', content_type: null, bytes: encoder.encode('Institut Teknologi Sepuluh Nopember') },
  { field: 'ktp', content_type: 'image/png', bytes: TINY_PNG },
]

const keys = new Map<string, SharingPublicKey>()
const shares = new Map<string, StoredShare>()

export function resetMockSharing(): void {
  keys.clear()
  shares.clear()
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function error(status: number, code: string, message: string): Response {
  return HttpResponse.json({ error: { code, message, details: {} } }, { status })
}

function json(body: object, status = 200): Response {
  return HttpResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function sampleItemId(ownerId: string, field: string): string {
  return `${ownerId}-${field}`
}

function availableItems(ownerId: string): SharingAvailableItem[] {
  return SAMPLE_ITEMS.map((item) => ({
    item_id: sampleItemId(ownerId, item.field),
    field: item.field,
    content_type: item.content_type,
    size_bytes: item.bytes.length,
    aes_available: true,
  }))
}

function uint64BigEndian(value: number): Uint8Array {
  const out = new Uint8Array(8)
  new DataView(out.buffer).setBigUint64(0, BigInt(value))
  return out
}

/** Seals one item with a fresh AES+HMAC key bundle wrapped for the recipient's RSA key. */
async function sealForRecipient(
  itemId: string,
  sample: SampleItem,
  recipientKey: SharingPublicKey,
): Promise<{ metadata: SharingItemMetadata; ciphertext: ArrayBuffer; encryptedKeyB64: string }> {
  const bundle = crypto.getRandomValues(new Uint8Array(64))
  const nonce = crypto.getRandomValues(new Uint8Array(8))
  const keyVersion = 1

  const counter = new Uint8Array(16)
  counter.set(nonce, 0)
  const aesKey = await crypto.subtle.importKey('raw', bundle.slice(0, 32), { name: 'AES-CTR' }, false, ['encrypt'])
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-CTR', counter, length: 64 },
    aesKey,
    sample.bytes,
  )

  const aad = encoder.encode(`${itemId}|aes|${keyVersion}`)
  const signed = new Uint8Array(8 + aad.length + nonce.length + ciphertext.byteLength)
  signed.set(uint64BigEndian(aad.length), 0)
  signed.set(aad, 8)
  signed.set(nonce, 8 + aad.length)
  signed.set(new Uint8Array(ciphertext), 8 + aad.length + nonce.length)
  const macKey = await crypto.subtle.importKey(
    'raw',
    bundle.slice(32),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const tag = new Uint8Array(await crypto.subtle.sign('HMAC', macKey, signed))

  const publicKey = await crypto.subtle.importKey(
    'spki',
    fromBase64(recipientKey.public_key_spki_b64),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  )
  const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, bundle))

  return {
    metadata: {
      item_id: itemId,
      ciphertext_id: crypto.randomUUID(),
      field: sample.field,
      cipher: 'aes',
      key_version: keyVersion,
      nonce_b64: toBase64(nonce),
      hmac_tag_b64: toBase64(tag),
      content_type: sample.content_type ?? 'text/plain; charset=utf-8',
      size_bytes: sample.bytes.length,
    },
    ciphertext,
    encryptedKeyB64: toBase64(wrapped),
  }
}

function pendingOwnedBy(ownerId: string, requestId: string): StoredShare | null {
  const share = shares.get(requestId)
  return share && share.request.owner_id === ownerId && share.request.status === 'pending'
    ? share
    : null
}

export function createSharingHandlers({ requireRole, verifyCsrf }: Gate) {
  return [
    http.get('*/api/sharing/keys/me', () => {
      const gate = requireRole('peserta')
      if (!gate.ok) {
        return gate.response
      }
      return json({ key: keys.get(gate.record.user.id) ?? null })
    }),

    http.post('*/api/sharing/keys', async ({ request }) => {
      const gate = requireRole('peserta')
      if (!gate.ok) {
        return gate.response
      }
      const csrfError = verifyCsrf(request)
      if (csrfError) {
        return csrfError
      }
      const body = (await request.json().catch(() => null)) as { public_key_spki_b64?: unknown } | null
      if (typeof body?.public_key_spki_b64 !== 'string' || body.public_key_spki_b64.length === 0) {
        return error(400, 'validation_error', 'Public key tidak valid.')
      }
      const existing = keys.get(gate.record.user.id)
      if (existing) {
        return existing.public_key_spki_b64 === body.public_key_spki_b64
          ? json(existing, 200)
          : error(409, 'conflict', 'Akun ini sudah memiliki public key yang berbeda.')
      }
      const created: SharingPublicKey = {
        id: crypto.randomUUID(),
        public_key_spki_b64: body.public_key_spki_b64,
      }
      keys.set(gate.record.user.id, created)
      return json(created, 201)
    }),

    http.post('*/api/sharing/requests', async ({ request }) => {
      const gate = requireRole('peserta')
      if (!gate.ok) {
        return gate.response
      }
      const csrfError = verifyCsrf(request)
      if (csrfError) {
        return csrfError
      }
      const requesterId = gate.record.user.id
      const body = (await request.json().catch(() => null)) as { owner_id?: unknown } | null
      if (typeof body?.owner_id !== 'string' || body.owner_id === requesterId) {
        return error(400, 'validation_error', 'ID pemilik tidak valid.')
      }
      if (!keys.has(requesterId)) {
        return error(409, 'conflict', 'Daftarkan public key Anda terlebih dahulu.')
      }
      const created: SharingRequest = {
        id: crypto.randomUUID(),
        owner_id: body.owner_id,
        requester_id: requesterId,
        status: 'pending',
        created_at: new Date().toISOString(),
        decided_at: null,
      }
      shares.set(created.id, { request: created, keyFile: null, items: [], ciphertexts: new Map() })
      return json(created, 201)
    }),

    http.get('*/api/sharing/requests/incoming', () => {
      const gate = requireRole('peserta')
      if (!gate.ok) {
        return gate.response
      }
      const requests = Array.from(shares.values())
        .map((share) => share.request)
        .filter((request) => request.owner_id === gate.record.user.id)
      return json({ requests })
    }),

    http.get('*/api/sharing/requests/outgoing', () => {
      const gate = requireRole('peserta')
      if (!gate.ok) {
        return gate.response
      }
      const requests = Array.from(shares.values())
        .map((share) => share.request)
        .filter((request) => request.requester_id === gate.record.user.id)
      return json({ requests })
    }),

    http.get('*/api/sharing/requests/:requestId/available-items', ({ params }) => {
      const gate = requireRole('peserta')
      if (!gate.ok) {
        return gate.response
      }
      const share = pendingOwnedBy(gate.record.user.id, String(params.requestId))
      return share
        ? json({ items: availableItems(share.request.owner_id) })
        : error(404, 'not_found', 'Permintaan tidak ditemukan.')
    }),

    http.post('*/api/sharing/requests/:requestId/approve', async ({ request, params }) => {
      const gate = requireRole('peserta')
      if (!gate.ok) {
        return gate.response
      }
      const csrfError = verifyCsrf(request)
      if (csrfError) {
        return csrfError
      }
      const share = pendingOwnedBy(gate.record.user.id, String(params.requestId))
      if (!share) {
        return error(404, 'not_found', 'Permintaan tidak ditemukan.')
      }
      const body = (await request.json().catch(() => null)) as { item_ids?: unknown } | null
      const itemIds = Array.isArray(body?.item_ids)
        ? Array.from(new Set(body.item_ids.filter((id): id is string => typeof id === 'string')))
        : []
      if (itemIds.length === 0 || itemIds.length > MAX_SHARED_ITEMS) {
        return error(400, 'validation_error', `Pilih 1 sampai ${MAX_SHARED_ITEMS} item.`)
      }
      const owner = share.request.owner_id
      const requesterKey = keys.get(share.request.requester_id)
      if (!requesterKey) {
        return error(409, 'conflict', 'Peminta belum memiliki public key.')
      }

      const sealed = []
      for (const itemId of itemIds) {
        const sample = SAMPLE_ITEMS.find((item) => sampleItemId(owner, item.field) === itemId)
        if (!sample) {
          return error(404, 'not_found', 'Item tidak ditemukan.')
        }
        sealed.push(await sealForRecipient(itemId, sample, requesterKey))
      }

      share.items = sealed.map((entry) => entry.metadata)
      share.ciphertexts = new Map(sealed.map((entry) => [entry.metadata.item_id, entry.ciphertext]))
      share.keyFile = {
        format: SHARE_KEYS_FORMAT,
        request_id: share.request.id,
        owner_id: owner,
        recipient_id: share.request.requester_id,
        recipient_key_id: requesterKey.id,
        algorithm: 'RSA-OAEP-256',
        items: sealed.map((entry) => ({
          item_id: entry.metadata.item_id,
          ciphertext_id: entry.metadata.ciphertext_id,
          encrypted_key_b64: entry.encryptedKeyB64,
        })),
      }
      share.request = { ...share.request, status: 'approved', decided_at: new Date().toISOString() }
      return json(share.request)
    }),

    http.post('*/api/sharing/requests/:requestId/reject', ({ request, params }) => {
      const gate = requireRole('peserta')
      if (!gate.ok) {
        return gate.response
      }
      const csrfError = verifyCsrf(request)
      if (csrfError) {
        return csrfError
      }
      const share = pendingOwnedBy(gate.record.user.id, String(params.requestId))
      if (!share) {
        return error(404, 'not_found', 'Permintaan tidak ditemukan.')
      }
      share.request = { ...share.request, status: 'rejected', decided_at: new Date().toISOString() }
      return json(share.request)
    }),

    http.get('*/api/sharing/requests/:requestId/key-file', ({ params }) => {
      const gate = requireRole('peserta')
      if (!gate.ok) {
        return gate.response
      }
      const share = shares.get(String(params.requestId))
      return share?.keyFile && share.request.owner_id === gate.record.user.id
        ? json(share.keyFile)
        : error(404, 'not_found', 'File kunci tidak ditemukan.')
    }),

    http.get('*/api/sharing/requests/:requestId/items', ({ params }) => {
      const gate = requireRole('peserta')
      if (!gate.ok) {
        return gate.response
      }
      const share = shares.get(String(params.requestId))
      return share && share.request.requester_id === gate.record.user.id && share.keyFile
        ? json({ items: share.items })
        : error(404, 'not_found', 'Permintaan tidak ditemukan.')
    }),

    http.get('*/api/sharing/requests/:requestId/items/:itemId/ciphertext', ({ params }) => {
      const gate = requireRole('peserta')
      if (!gate.ok) {
        return gate.response
      }
      const share = shares.get(String(params.requestId))
      const ciphertext = share?.ciphertexts.get(String(params.itemId))
      if (!share || !ciphertext || share.request.requester_id !== gate.record.user.id) {
        return error(404, 'not_found', 'Data tidak ditemukan.')
      }
      return new HttpResponse(ciphertext, {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }),
  ]
}
