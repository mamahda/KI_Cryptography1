import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Alert, AlgDot, AlgTabs, Modal, Spinner } from '../components/ui'
import {
  ALGORITHMS,
  ApiError,
  api,
  downloadUrl,
  errorText,
  uploadFile,
  type Algorithm,
  type Category,
  type FileItem,
  type UploadResponse,
} from '../lib/api'
import { CATEGORY_LABEL, CATEGORY_RULES, formatBytes, formatDate, formatNs } from '../lib/format'

const TABS: Category[] = ['id_card', 'document', 'video']

function isCategory(v: string | null): v is Category {
  return v !== null && (TABS as string[]).includes(v)
}

export function FilesPage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('c')
  const category: Category = isCategory(raw) ? raw : 'id_card'

  const [files, setFiles] = useState<FileItem[] | null>(null)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<FileItem | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setFiles(await api.listFiles())
      setError('')
    } catch (err) {
      setError(errorText(err))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    api
      .listFiles()
      .then((f) => !cancelled && setFiles(f))
      .catch((err) => !cancelled && setError(errorText(err)))
    return () => {
      cancelled = true
    }
  }, [])

  async function remove(f: FileItem) {
    if (!window.confirm(`Hapus "${f.filename}"? Ketiga versi terenkripsi akan dihapus permanen.`)) return
    setDeleting(f.id)
    try {
      await api.deleteFile(f.id)
      await reload()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setDeleting(null)
    }
  }

  const list = files?.filter((f) => f.category === category) ?? []
  const count = (c: Category) => files?.filter((f) => f.category === c).length ?? 0

  return (
    <>
      <div className="page-head">
        <div>
          <h1>File</h1>
          <p className="muted">
            Setiap file dienkripsi tiga kali (AES, DES, RC4) dan disimpan sebagai ciphertext. Pilih algoritma saat
            mengunduh untuk mendekripsi versi tersebut.
          </p>
        </div>
      </div>

      <div className="tabs tabs-page" role="tablist" aria-label="Kategori file">
        {TABS.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={category === c}
            className={category === c ? 'active' : ''}
            onClick={() => setParams({ c })}
          >
            {CATEGORY_LABEL[c]} <span className="count">{files ? count(c) : ''}</span>
          </button>
        ))}
      </div>

      <Uploader key={category} category={category} onUploaded={reload} />

      <section className="card">
        <h2>{CATEGORY_LABEL[category]} tersimpan</h2>
        {error && <Alert kind="error">{error}</Alert>}
        {!files && !error && <Spinner />}
        {files && list.length === 0 && <p className="muted">Belum ada file pada kategori ini.</p>}
        {list.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nama file</th>
                  <th className="num">Ukuran</th>
                  <th>Diunggah</th>
                  <th>Unduh (dekripsi dengan)</th>
                  <th aria-label="Aksi" />
                </tr>
              </thead>
              <tbody>
                {list.map((f) => (
                  <tr key={f.id}>
                    <td className="file-name">
                      {f.integrity_error ? <span className="badge badge-bad">✕ nama rusak</span> : f.filename}
                      <div className="small muted">{f.mime_type}</div>
                    </td>
                    <td className="num">{formatBytes(f.size)}</td>
                    <td className="nowrap">{formatDate(f.created_at)}</td>
                    <td>
                      <div className="btn-row">
                        {ALGORITHMS.map((a) => (
                          <a key={a} className="btn btn-sm btn-alg" href={downloadUrl(f.id, a)} download>
                            <AlgDot alg={a} />
                            {a}
                          </a>
                        ))}
                      </div>
                    </td>
                    <td>
                      <div className="btn-row btn-row-end">
                        {f.category === 'id_card' && (
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPreview(f)}>
                            Lihat
                          </button>
                        )}
                        <Link className="btn btn-sm btn-ghost" to={`/files/${f.id}`}>
                          Analisis
                        </Link>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger-ghost"
                          disabled={deleting === f.id}
                          onClick={() => remove(f)}
                        >
                          {deleting === f.id ? 'Menghapus…' : 'Hapus'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {preview && <ImagePreview file={preview} onClose={() => setPreview(null)} />}
    </>
  )
}

function Uploader({ category, onUploaded }: { category: Category; onUploaded: () => void }) {
  const rules = CATEGORY_RULES[category]
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<(() => void) | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [result, setResult] = useState<UploadResponse | null>(null)

  useEffect(() => () => abortRef.current?.(), [])

  function pick(f: File | null) {
    setError('')
    setResult(null)
    setFile(null)
    if (!f) return
    const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
    if (!rules.exts.includes(ext)) {
      setError(`Format tidak didukung. Yang diterima: ${rules.exts.join(', ')}.`)
      return
    }
    if (f.size === 0) {
      setError('File kosong.')
      return
    }
    if (f.size > rules.maxBytes) {
      setError(`Ukuran ${formatBytes(f.size)} melebihi batas ${formatBytes(rules.maxBytes)}.`)
      return
    }
    setFile(f)
  }

  async function upload() {
    if (!file) return
    setError('')
    setResult(null)
    setProgress(0)
    const { promise, abort } = uploadFile(category, file, setProgress)
    abortRef.current = abort
    try {
      const r = await promise
      setResult(r)
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      onUploaded()
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 0 && err.message.includes('dibatalkan'))) {
        setError(errorText(err))
      }
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }

  const uploading = progress !== null
  return (
    <section className="card">
      <h2>Unggah {CATEGORY_LABEL[category]}</h2>
      <p className="small muted">
        Format: {rules.exts.join(', ')} · Maks {formatBytes(rules.maxBytes)}. Isi file diperiksa (magic bytes), bukan
        hanya ekstensinya.
      </p>
      <div className="upload-row">
        <input
          ref={inputRef}
          type="file"
          accept={rules.accept}
          disabled={uploading}
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
          aria-label={`Pilih file ${CATEGORY_LABEL[category]}`}
        />
        {!uploading ? (
          <button type="button" className="btn btn-primary" disabled={!file} onClick={upload}>
            Unggah &amp; enkripsi
          </button>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={() => abortRef.current?.()}>
            Batal
          </button>
        )}
      </div>
      {uploading && (
        <div className="progress-block">
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <span className="small muted">
            {progress < 1 ? `Mengunggah ${Math.round(progress * 100)}%` : 'Mengenkripsi dengan AES, DES, dan RC4 di server…'}
          </span>
        </div>
      )}
      {error && <Alert kind="error">{error}</Alert>}
      {result && (
        <Alert kind="success">
          <strong>{result.file.filename}</strong> ({formatBytes(result.file.size)}) tersimpan dalam 3 versi terenkripsi.
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Algoritma</th>
                <th className="num">Waktu cipher</th>
                <th className="num">Total (I/O + HMAC)</th>
              </tr>
            </thead>
            <tbody>
              {ALGORITHMS.map((a) => (
                <tr key={a}>
                  <td>
                    <AlgDot alg={a} /> {a}
                  </td>
                  <td className="num">{formatNs(result.encrypt[a].cipher_ns)}</td>
                  <td className="num">{formatNs(result.encrypt[a].total_ns)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Alert>
      )}
    </section>
  )
}

function ImagePreview({ file, onClose }: { file: FileItem; onClose: () => void }) {
  const [alg, setAlg] = useState<Algorithm>('AES')
  return (
    <Modal title={file.filename} onClose={onClose}>
      <div className="card-head">
        <AlgTabs value={alg} onChange={setAlg} label="Dekripsi dengan" />
      </div>
      <DecryptedImage key={alg} file={file} alg={alg} />
    </Modal>
  )
}

/** Downloads one decrypted variant as a blob and shows it. Keyed by alg. */
function DecryptedImage({ file, alg }: { file: FileItem; alg: Algorithm }) {
  const [state, setState] = useState<{ url?: string; ms?: number; error?: string }>({})

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    const t0 = performance.now()
    fetch(downloadUrl(file.id, alg), { cache: 'no-store', credentials: 'same-origin' })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => null)
          throw new Error(data?.error ?? `HTTP ${res.status}`)
        }
        return res.blob()
      })
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setState({ url: objectUrl, ms: performance.now() - t0 })
      })
      .catch((err) => !cancelled && setState({ error: errorText(err) }))
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file.id, alg])

  if (state.error) return <Alert kind="error">{state.error}</Alert>
  if (!state.url) return <Spinner label="Mendekripsi…" />
  return (
    <>
      <p className="small muted">
        Diunduh &amp; didekripsi dengan {alg} dalam {formatNs((state.ms ?? 0) * 1e6)}
      </p>
      <img className="preview-img" src={state.url} alt={`Pratinjau ${file.filename}`} />
    </>
  )
}
