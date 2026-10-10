const idNumber = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 })
const idDate = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' })

export function formatNumber(x: number, digits = 2): string {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: digits }).format(x)
}

/** Binary units (1 KB = 1024 B), matching the backend's size limits. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${idNumber.format(v)} ${units[i]}`
}

/** Picks ns / µs / ms / s so the number stays readable. */
export function formatNs(ns: number): string {
  if (!Number.isFinite(ns)) return '–'
  const abs = Math.abs(ns)
  if (abs < 1e3) return `${formatNumber(ns, 0)} ns`
  if (abs < 1e6) return `${formatNumber(ns / 1e3)} µs`
  if (abs < 1e9) return `${formatNumber(ns / 1e6)} ms`
  return `${formatNumber(ns / 1e9)} s`
}

export function nsToMs(ns: number): number {
  return ns / 1e6
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : idDate.format(d)
}

export const CATEGORY_LABEL: Record<string, string> = {
  id_card: 'Foto KTP',
  document: 'Dokumen',
  video: 'Video',
}

export const CATEGORY_RULES: Record<string, { exts: string[]; maxBytes: number; accept: string }> = {
  id_card: { exts: ['jpg', 'jpeg', 'png'], maxBytes: 5 << 20, accept: '.jpg,.jpeg,.png' },
  document: {
    exts: ['pdf', 'doc', 'docx', 'xls', 'xlsx'],
    maxBytes: 20 << 20,
    accept: '.pdf,.doc,.docx,.xls,.xlsx',
  },
  video: { exts: ['mp4', 'webm', 'mkv'], maxBytes: 200 << 20, accept: '.mp4,.webm,.mkv' },
}
