export const INVITE_CODE_REGEX = /^[A-Za-z0-9]{8}$/

export function normalizeTeamName(raw: string): string {
  return raw.trim()
}

export function validateTeamName(raw: string): string | null {
  const normalized = normalizeTeamName(raw)
  if (normalized.length < 1 || normalized.length > 50) {
    return 'Nama tim wajib diisi (1–50 karakter).'
  }
  return null
}

export function normalizeInviteCode(raw: string): string {
  return raw.trim().toUpperCase()
}

export function validateInviteCode(raw: string): string | null {
  const normalized = normalizeInviteCode(raw)
  if (!INVITE_CODE_REGEX.test(normalized)) {
    return 'Kode undangan tim harus terdiri dari 8 karakter huruf atau angka.'
  }
  return null
}
