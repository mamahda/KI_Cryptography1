const BACKUP_FORMAT = 'schematics-private-key-v1'
const ITERATIONS = 600_000
const encoder = new TextEncoder()
const rsaAlgorithm = { name: 'RSA-OAEP', hash: 'SHA-256' } as const

function toBase64(bytes: Uint8Array<ArrayBuffer>): string {
  return btoa(String.fromCharCode(...bytes))
}

function fromBase64(value: unknown, maxBytes: number, exactBytes?: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length === 0 ||
      value.length > 4 * Math.ceil(maxBytes / 3) ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Base64 tidak valid')
  }
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
  if (bytes.length > maxBytes || (exactBytes !== undefined && bytes.length !== exactBytes) ||
      toBase64(bytes) !== value) {
    throw new Error('Ukuran atau encoding data tidak valid')
  }
  return bytes
}

async function backupKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new Error('Passphrase tidak boleh kosong')
  }
  const password = encoder.encode(passphrase)
  try {
    const material = await crypto.subtle.importKey('raw', password, 'PBKDF2', false, ['deriveKey'])
    return await crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    )
  } finally {
    password.fill(0)
  }
}

function checkRsaKey(key: CryptoKey): void {
  const algorithm = key.algorithm as RsaHashedKeyAlgorithm
  if (algorithm.name !== 'RSA-OAEP' || algorithm.modulusLength !== 2048 ||
      algorithm.hash?.name !== 'SHA-256') {
    throw new Error('Key harus RSA-OAEP 2048-bit SHA-256')
  }
}

export async function generateKeyBackup(passphrase: string): Promise<{
  publicKeySpkiB64: string; backupJson: string
}> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const protectionKey = await backupKey(passphrase, salt)
  const pair = await crypto.subtle.generateKey(
    { ...rsaAlgorithm, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true, ['encrypt', 'decrypt'],
  )
  const publicKeySpkiB64 = toBase64(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)))
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  try {
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: encoder.encode(BACKUP_FORMAT), tagLength: 128 },
      protectionKey, pkcs8,
    )
    return {
      publicKeySpkiB64,
      backupJson: JSON.stringify({
        format: BACKUP_FORMAT, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS,
        salt_b64: toBase64(salt), cipher: 'AES-256-GCM', nonce_b64: toBase64(nonce),
        public_key_spki_b64: publicKeySpkiB64, ciphertext_b64: toBase64(new Uint8Array(ciphertext)),
      }),
    }
  } finally {
    pkcs8.fill(0)
  }
}

export async function unlockPrivateKey(backupJson: string, passphrase: string): Promise<{
  privateKey: CryptoKey; publicKeySpkiB64: string
}> {
  if (typeof backupJson !== 'string' || backupJson.length > 16_384) {
    throw new Error('Ukuran backup tidak valid (maksimal 16 KiB)')
  }
  let pkcs8: Uint8Array<ArrayBuffer> | undefined
  try {
    const backup = JSON.parse(backupJson)
    if (!backup || typeof backup !== 'object' || Array.isArray(backup) ||
        backup.format !== BACKUP_FORMAT || backup.kdf !== 'PBKDF2-SHA256' ||
        backup.iterations !== ITERATIONS || backup.cipher !== 'AES-256-GCM') {
      throw new Error('Format backup tidak didukung')
    }
    const salt = fromBase64(backup.salt_b64, 16, 16)
    const nonce = fromBase64(backup.nonce_b64, 12, 12)
    const spki = fromBase64(backup.public_key_spki_b64, 512)
    const ciphertext = fromBase64(backup.ciphertext_b64, 4096)
    if (ciphertext.length <= 16) throw new Error('Backup kosong')
    const publicKey = await crypto.subtle.importKey('spki', spki, rsaAlgorithm, false, ['encrypt'])
    checkRsaKey(publicKey)
    const protectionKey = await backupKey(passphrase, salt)
    pkcs8 = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: encoder.encode(BACKUP_FORMAT), tagLength: 128 },
      protectionKey, ciphertext,
    ))
    const privateKey = await crypto.subtle.importKey('pkcs8', pkcs8, rsaAlgorithm, false, ['decrypt'])
    checkRsaKey(privateKey)
    // The public metadata must belong to the encrypted private key as well.
    const challenge = crypto.getRandomValues(new Uint8Array(32))
    const wrapped = await crypto.subtle.encrypt(rsaAlgorithm, publicKey, challenge)
    const opened = new Uint8Array(await crypto.subtle.decrypt(rsaAlgorithm, privateKey, wrapped))
    if (!opened.every((byte, index) => byte === challenge[index]) || opened.length !== challenge.length) {
      throw new Error('Pasangan key tidak cocok')
    }
    return { privateKey, publicKeySpkiB64: backup.public_key_spki_b64 }
  } catch {
    throw new Error('Backup tidak valid atau passphrase salah')
  } finally {
    pkcs8?.fill(0)
  }
}

export async function decryptWrappedKey(privateKey: CryptoKey, encryptedKeyB64: string): Promise<Uint8Array> {
  checkRsaKey(privateKey)
  if (privateKey.type !== 'private' || !privateKey.usages.includes('decrypt')) {
    throw new Error('Private key untuk dekripsi diperlukan')
  }
  const encrypted = fromBase64(encryptedKeyB64, 256, 256)
  const keyBytes = new Uint8Array(await crypto.subtle.decrypt(rsaAlgorithm, privateKey, encrypted))
  if (keyBytes.length !== 64) {
    keyBytes.fill(0)
    throw new Error('Paket kunci AES dan HMAC harus tepat 64 byte')
  }
  return keyBytes
}
