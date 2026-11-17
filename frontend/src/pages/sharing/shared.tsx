import { AlertCircle } from 'lucide-react'
import type { SharingRequestStatus } from '@/api'

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

const STATUS_STYLES: Record<SharingRequestStatus, { label: string; className: string }> = {
  pending: {
    label: 'Menunggu persetujuan',
    className: 'border-amber-500/40 bg-amber-950/50 text-amber-200',
  },
  approved: {
    label: 'Disetujui',
    className: 'border-emerald-500/40 bg-emerald-950/50 text-emerald-200',
  },
  rejected: {
    label: 'Ditolak',
    className: 'border-rose-500/40 bg-rose-950/50 text-rose-200',
  },
}

export function RequestStatusBadge({ status }: { status: SharingRequestStatus }) {
  const style = STATUS_STYLES[status]
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${style.className}`}
    >
      {style.label}
    </span>
  )
}

export function ErrorNote({ message, testId }: { message: string; testId?: string }) {
  return (
    <p
      data-testid={testId}
      role="alert"
      className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-950/30 px-3 py-2.5 text-sm text-red-200"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </p>
  )
}
