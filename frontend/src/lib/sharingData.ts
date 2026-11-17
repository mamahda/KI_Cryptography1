/** Decrypt an existing AES-CTR/HMAC ciphertext after RSA key transport. */

export interface SharingItemMetadata {
  item_id: string
  ciphertext_id: string
  field: string
  cipher: string
  key_version: number
  nonce_b64: string
  hmac_tag_b64: string
  content_type: string
  size_bytes: number
}

function decodeBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Metadata base64 tidak valid')
  }
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

function buffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer
}

export async function decryptSharedData(
  keyBytes: Uint8Array,
  metadata: SharingItemMetadata,
  ciphertext: ArrayBuffer,
): Promise<ArrayBuffer> {
  if (!(keyBytes instanceof Uint8Array) || keyBytes.byteLength !== 64 ||
      metadata.cipher !== 'aes' || !metadata.item_id ||
      !Number.isSafeInteger(metadata.key_version) || metadata.key_version < 1 ||
      !(ciphertext instanceof ArrayBuffer)) {
    throw new Error('Data berbagi tidak valid')
  }

  const nonce = decodeBase64(metadata.nonce_b64)
  const tag = decodeBase64(metadata.hmac_tag_b64)
  if (nonce.byteLength !== 8 || tag.byteLength !== 32) {
    throw new Error('Metadata enkripsi tidak valid')
  }

  const aad = new TextEncoder().encode(`${metadata.item_id}|aes|${metadata.key_version}`)
  const macInput = new Uint8Array(8 + aad.byteLength + nonce.byteLength + ciphertext.byteLength)
  new DataView(macInput.buffer).setBigUint64(0, BigInt(aad.byteLength), false)
  macInput.set(aad, 8)
  macInput.set(nonce, 8 + aad.byteLength)
  macInput.set(new Uint8Array(ciphertext), 8 + aad.byteLength + nonce.byteLength)

  const macKey = await crypto.subtle.importKey(
    'raw', buffer(keyBytes.subarray(32)),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
  )
  const valid = await crypto.subtle.verify('HMAC', macKey, buffer(tag), buffer(macInput))
  if (!valid) {
    throw new Error('HMAC tidak cocok; data tidak boleh dibuka')
  }

  const aesKey = await crypto.subtle.importKey(
    'raw', buffer(keyBytes.subarray(0, 32)), 'AES-CTR', false, ['decrypt'],
  )
  const counter = new Uint8Array(16)
  counter.set(nonce)
  return crypto.subtle.decrypt(
    { name: 'AES-CTR', counter: buffer(counter), length: 64 }, aesKey, ciphertext,
  )
}
