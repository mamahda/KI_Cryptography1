import { AlertCircle } from 'lucide-react'
import type { SharingRequestStatus } from '@/api'

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
