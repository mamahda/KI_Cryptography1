import {
  SHARE_KEYS_FORMAT,
  sharingApi,
  type SharingItemMetadata,
  type SharingKeyFile,
  type SharingPublicKey,
  type SharingRequest,
} from '@/api'
import { decryptSharedData, decryptWrappedKey, unlockPrivateKey } from './sharingCrypto'

/** Upper bounds for the files the user picks; both are small JSON documents. */
export const MAX_KEY_FILE_BYTES = 256 * 1024
export const MAX_BACKUP_FILE_BYTES = 16 * 1024

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export type OpenedItem =
  | { itemId: string; field: string; kind: 'text'; text: string }
  | { itemId: string; field: string; kind: 'image'; blob: Blob }
  | { itemId: string; field: string; kind: 'file'; blob: Blob; contentType: string }
  | { itemId: string; field: string; kind: 'error'; message: string }

export interface OpenSharedInput {
  request: SharingRequest
  /** The signed-in user's own ID, from `/api/me`. */
  userId: string
  /** The public key registered for this account. */
  registeredKey: SharingPublicKey
  keyFileText: string
  backupText: string
  passphrase: string
}

function parseKeyFile(text: string): SharingKeyFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('File kunci bukan JSON yang valid.')
  }
  const file = parsed as Partial<SharingKeyFile> | null
  if (
    !file ||
    file.format !== SHARE_KEYS_FORMAT ||
    file.algorithm !== 'RSA-OAEP-256' ||
    typeof file.request_id !== 'string' ||
    typeof file.owner_id !== 'string' ||
    typeof file.recipient_id !== 'string' ||
    typeof file.recipient_key_id !== 'string' ||
    !Array.isArray(file.items) ||
    file.items.some(
      (item) =>
        typeof item?.item_id !== 'string' ||
        typeof item?.ciphertext_id !== 'string' ||
        typeof item?.encrypted_key_b64 !== 'string',
    )
  ) {
    throw new Error('Format file kunci tidak dikenali.')
  }
  return file as SharingKeyFile
}

/** The key file is only trusted for this exact request, recipient and key. */
function assertKeyFileMatches(file: SharingKeyFile, input: OpenSharedInput): void {
  const { request, userId, registeredKey } = input
  if (file.request_id !== request.id || file.owner_id !== request.owner_id) {
    throw new Error('File kunci ini bukan untuk permintaan tersebut.')
  }
  if (file.recipient_id !== userId) {
    throw new Error('File kunci ini ditujukan untuk akun lain.')
  }
  if (file.recipient_key_id !== registeredKey.id) {
    throw new Error('File kunci ini dibuat untuk public key yang berbeda dari kunci akun Anda.')
  }
}

function describe(item: SharingItemMetadata, bytes: ArrayBuffer): OpenedItem {
  const base = { itemId: item.item_id, field: item.field }
  const contentType = item.content_type.split(';')[0].trim().toLowerCase()
  if (contentType.startsWith('text/')) {
    try {
      return { ...base, kind: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
    } catch {
      return { ...base, kind: 'error', message: 'Isi teks tidak valid.' }
    }
  }
  if (IMAGE_TYPES.has(contentType)) {
    return { ...base, kind: 'image', blob: new Blob([bytes], { type: contentType }) }
  }
  return { ...base, kind: 'file', blob: new Blob([bytes], { type: contentType }), contentType }
}

/**
 * Opens every item granted to the signed-in user. Whole-run problems (wrong key,
 * mismatched key file) throw; a problem with a single item, such as a failed
 * HMAC, is reported on that item so the others still open.
 */
export async function openSharedItems(input: OpenSharedInput): Promise<OpenedItem[]> {
  const keyFile = parseKeyFile(input.keyFileText)
  assertKeyFileMatches(keyFile, input)

  const { privateKey, publicKeySpkiB64 } = await unlockPrivateKey(input.backupText, input.passphrase)
  if (publicKeySpkiB64 !== input.registeredKey.public_key_spki_b64) {
    throw new Error('Private key di file backup tidak cocok dengan public key akun Anda.')
  }

  const { items } = await sharingApi.listItems(input.request.id)
  const opened: OpenedItem[] = []

  for (const metadata of items) {
    const base = { itemId: metadata.item_id, field: metadata.field }
    const entry = keyFile.items.find((candidate) => candidate.item_id === metadata.item_id)
    if (!entry || entry.ciphertext_id !== metadata.ciphertext_id) {
      opened.push({ ...base, kind: 'error', message: 'Kunci untuk data ini tidak ada di file kunci.' })
      continue
    }
    try {
      const keyBytes = await decryptWrappedKey(privateKey, entry.encrypted_key_b64)
      const ciphertext = await sharingApi.getCiphertext(input.request.id, metadata.item_id)
      opened.push(describe(metadata, await decryptSharedData(keyBytes, metadata, ciphertext)))
    } catch (error) {
      opened.push({
        ...base,
        kind: 'error',
        message: error instanceof Error ? error.message : 'Data tidak dapat dibuka.',
      })
    }
  }
  return opened
}
