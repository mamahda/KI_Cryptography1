/**
 * TEMPORARY stand-in for the browser crypto owned by members 2 and 3
 * (`lib/sharingKeys.ts`, `lib/sharingData.ts`), written to the signatures and
 * formats of KONTRAK_SHARING_ASSIGNMENT_2.md sections 5 and 6 so the UI can be
 * exercised end to end. Once their modules land, re-point `sharingCrypto.ts`
 * at them and delete this file.
 */
import type { SharingItemMetadata } from '@/api'

const BACKUP_FORMAT = 'schematics-private-key-v1'
const BACKUP_ITERATIONS = 600_000
const SALT_BYTES = 16
const GCM_NONCE_BYTES = 12
const AES_NONCE_BYTES = 8
const KEY_BUNDLE_BYTES = 64
const HMAC_TAG_BYTES = 32
const MAX_BACKUP_CIPHERTEXT_B64 = 8192

type Bytes = Uint8Array<ArrayBuffer>

const encoder = new TextEncoder()

function fromBase64(value: string): Bytes {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function decodeField(value: unknown, expectedLength?: number): Bytes {
  if (typeof value !== 'string') {
    throw new Error('File backup tidak valid.')
  }
  let bytes: Bytes
  try {
    bytes = fromBase64(value)
  } catch {
    throw new Error('File backup tidak valid.')
  }
  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    throw new Error('File backup tidak valid.')
  }
  return bytes
}

async function derivePassphraseKey(
  passphrase: string,
  salt: Bytes,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function generateKeyBackup(
  passphrase: string,
): Promise<{ publicKeySpkiB64: string; backupJson: string }> {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  )
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey)

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const nonce = crypto.getRandomValues(new Uint8Array(GCM_NONCE_BYTES))
  const aesKey = await derivePassphraseKey(passphrase, salt, BACKUP_ITERATIONS)
  const sealed = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      additionalData: encoder.encode(BACKUP_FORMAT),
      tagLength: 128,
    },
    aesKey,
    pkcs8,
  )

  const publicKeySpkiB64 = toBase64(spki)
  return {
    publicKeySpkiB64,
    backupJson: JSON.stringify({
      format: BACKUP_FORMAT,
      kdf: 'PBKDF2-SHA256',
      iterations: BACKUP_ITERATIONS,
      salt_b64: toBase64(salt),
      cipher: 'AES-256-GCM',
      nonce_b64: toBase64(nonce),
      public_key_spki_b64: publicKeySpkiB64,
      ciphertext_b64: toBase64(new Uint8Array(sealed)),
    }),
  }
}

export async function unlockPrivateKey(
  backupJson: string,
  passphrase: string,
): Promise<{ privateKey: CryptoKey; publicKeySpkiB64: string }> {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(backupJson) as Record<string, unknown>
  } catch {
    throw new Error('File backup tidak valid.')
  }
  if (
    parsed.format !== BACKUP_FORMAT ||
    parsed.kdf !== 'PBKDF2-SHA256' ||
    parsed.cipher !== 'AES-256-GCM' ||
    parsed.iterations !== BACKUP_ITERATIONS ||
    typeof parsed.public_key_spki_b64 !== 'string' ||
    typeof parsed.ciphertext_b64 !== 'string' ||
    parsed.ciphertext_b64.length > MAX_BACKUP_CIPHERTEXT_B64
  ) {
    throw new Error('File backup tidak valid.')
  }
  const salt = decodeField(parsed.salt_b64, SALT_BYTES)
  const nonce = decodeField(parsed.nonce_b64, GCM_NONCE_BYTES)
  const sealed = decodeField(parsed.ciphertext_b64)

  const aesKey = await derivePassphraseKey(passphrase, salt, BACKUP_ITERATIONS)
  let pkcs8: ArrayBuffer
  try {
    pkcs8 = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonce,
        additionalData: encoder.encode(BACKUP_FORMAT),
        tagLength: 128,
      },
      aesKey,
      sealed,
    )
  } catch {
    throw new Error('Passphrase salah atau file backup rusak.')
  }
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['decrypt'],
  )
  return { privateKey, publicKeySpkiB64: parsed.public_key_spki_b64 }
}

export async function decryptWrappedKey(
  privateKey: CryptoKey,
  encryptedKeyB64: string,
): Promise<Uint8Array> {
  let bundle: ArrayBuffer
  try {
    bundle = await crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      privateKey,
      fromBase64(encryptedKeyB64),
    )
  } catch {
    throw new Error('Kunci data tidak dapat dibuka dengan private key ini.')
  }
  if (bundle.byteLength !== KEY_BUNDLE_BYTES) {
    throw new Error('Kunci data tidak valid.')
  }
  return new Uint8Array(bundle)
}

function uint64BigEndian(value: number): Bytes {
  const out = new Uint8Array(8)
  new DataView(out.buffer).setBigUint64(0, BigInt(value))
  return out
}

export async function decryptSharedData(
  keyBytes: Uint8Array,
  metadata: SharingItemMetadata,
  ciphertext: ArrayBuffer,
): Promise<ArrayBuffer> {
  if (metadata.cipher !== 'aes' || keyBytes.length !== KEY_BUNDLE_BYTES) {
    throw new Error('Kunci atau metadata data tidak valid.')
  }
  const nonce = fromBase64(metadata.nonce_b64)
  const tag = fromBase64(metadata.hmac_tag_b64)
  if (nonce.length !== AES_NONCE_BYTES || tag.length !== HMAC_TAG_BYTES) {
    throw new Error('Kunci atau metadata data tidak valid.')
  }

  const aad = encoder.encode(`${metadata.item_id}|aes|${metadata.key_version}`)
  const signed = new Uint8Array(8 + aad.length + nonce.length + ciphertext.byteLength)
  signed.set(uint64BigEndian(aad.length), 0)
  signed.set(aad, 8)
  signed.set(nonce, 8 + aad.length)
  signed.set(new Uint8Array(ciphertext), 8 + aad.length + nonce.length)

  const macKey = await crypto.subtle.importKey(
    'raw',
    keyBytes.slice(32),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  if (!(await crypto.subtle.verify('HMAC', macKey, tag, signed))) {
    throw new Error('HMAC tidak cocok: data berubah atau kunci salah.')
  }

  const counter = new Uint8Array(16)
  counter.set(nonce, 0)
  const aesKey = await crypto.subtle.importKey(
    'raw',
    keyBytes.slice(0, 32),
    { name: 'AES-CTR' },
    false,
    ['decrypt'],
  )
  return crypto.subtle.decrypt({ name: 'AES-CTR', counter, length: 64 }, aesKey, ciphertext)
}
