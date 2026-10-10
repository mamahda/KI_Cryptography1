import { useEffect, useId, useRef, type ReactNode } from 'react'
import { ALGORITHMS, type Algorithm } from '../lib/api'
import { ALG_INFO } from '../lib/algorithms'

export function AlgDot({ alg }: { alg: Algorithm }) {
  return <span className="alg-dot" style={{ background: `var(${ALG_INFO[alg].colorVar})` }} aria-hidden="true" />
}

/** Segmented control for choosing AES / DES / RC4. */
export function AlgTabs({
  value,
  onChange,
  label = 'Algoritma',
}: {
  value: Algorithm
  onChange: (a: Algorithm) => void
  label?: string
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {ALGORITHMS.map((a) => (
        <button
          key={a}
          type="button"
          role="radio"
          aria-checked={value === a}
          className={value === a ? 'active' : ''}
          onClick={() => onChange(a)}
        >
          <AlgDot alg={a} />
          {a}
        </button>
      ))}
    </div>
  )
}

export function Alert({ kind, children }: { kind: 'error' | 'success' | 'info'; children: ReactNode }) {
  const icon = kind === 'error' ? '!' : kind === 'success' ? '✓' : 'i'
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span className="alert-icon" aria-hidden="true">
        {icon}
      </span>
      <div>{children}</div>
    </div>
  )
}

export function Spinner({ label = 'Memuat…' }: { label?: string }) {
  return (
    <div className="spinner-row" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  )
}

/** Hex dump: offset, bytes per row (default 16), optional printable-ASCII column. */
export function HexView({ hex, ascii = true, perRow = 16 }: { hex: string; ascii?: boolean; perRow?: number }) {
  const bytes: number[] = []
  for (let i = 0; i + 1 < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16))
  if (bytes.length === 0) return <pre className="hex">(kosong)</pre>
  const rows: string[] = []
  for (let off = 0; off < bytes.length; off += perRow) {
    const chunk = bytes.slice(off, off + perRow)
    const h = chunk.map((b) => b.toString(16).padStart(2, '0')).join(' ')
    const a = chunk.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('')
    rows.push(`${off.toString(16).padStart(4, '0')}  ${ascii ? `${h.padEnd(perRow * 3 - 1)}  ${a}` : h}`)
  }
  return <pre className="hex">{rows.join('\n')}</pre>
}

/** Entropy in bits/byte on a 0–8 scale. */
export function EntropyMeter({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, (value / 8) * 100))
  return (
    <div className="meter" title={`${value.toFixed(4)} bit/byte`}>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="meter-value">{value.toFixed(4)} / 8</span>
    </div>
  )
}

export function MacBadge({ valid }: { valid: boolean }) {
  return valid ? (
    <span className="badge badge-good">✓ HMAC valid</span>
  ) : (
    <span className="badge badge-bad">✕ HMAC tidak cocok</span>
  )
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close()
      }}
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="btn btn-ghost" onClick={() => ref.current?.close()} aria-label="Tutup">
          ✕
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  )
}
