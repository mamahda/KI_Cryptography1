/** Labels for the item fields the contract allows to be shared. */
export const FIELD_LABELS: Record<string, string> = {
  full_name: 'Nama lengkap',
  nim: 'NIM',
  study_program: 'Program studi',
  institution: 'Institusi',
  birth_date: 'Tanggal lahir',
  domicile: 'Domisili',
  phone: 'Nomor HP',
  ktp: 'Scan KTP',
  ktm: 'Scan KTM/KRSM',
  twibbon: 'Bukti twibbon',
}

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

/** First eight characters of a UUID: enough to tell requests apart on screen. */
export function shortId(id: string): string {
  return id.slice(0, 8)
}
