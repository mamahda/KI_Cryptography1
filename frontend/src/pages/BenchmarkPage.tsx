import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MeanBarChart, RunsSmallMultiples, type SeriesResult } from '../components/BenchCharts'
import { Alert, AlgDot, Spinner } from '../components/ui'
import {
  ALGORITHMS,
  ApiError,
  api,
  downloadUrl,
  errorText,
  type Algorithm,
  type BenchSummaryItem,
  type FileItem,
  type Summary,
} from '../lib/api'
import { CATEGORY_LABEL, formatBytes, formatNs, formatNumber } from '../lib/format'
import { summarize, throughput } from '../lib/stats'

interface Row {
  algorithm: Algorithm
  summary: Summary
  mbps: number
  samples: number[]
  verifyNs?: number
}

interface RunResult {
  source: 'server' | 'client'
  file: FileItem
  runs: number
  rows: Row[]
}

const OPERATION_LABEL: Record<string, string> = {
  encrypt: 'Enkripsi (saat upload)',
  decrypt: 'Dekripsi (benchmark server)',
  download: 'Download',
}

export function BenchmarkPage() {
  const [params, setParams] = useSearchParams()
  const [files, setFiles] = useState<FileItem[] | null>(null)
  const [fileId, setFileId] = useState(params.get('file') ?? '')
  const [runs, setRuns] = useState(10)
  const [busy, setBusy] = useState<'server' | 'client' | null>(null)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<RunResult | null>(null)
  const [history, setHistory] = useState<BenchSummaryItem[] | null>(null)
  const cancelRef = useRef(false)

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await api.benchmarkSummary())
    } catch (err) {
      setError(errorText(err))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([api.listFiles(), api.benchmarkSummary()])
      .then(([f, h]) => {
        if (cancelled) return
        setFiles(f)
        setHistory(h)
        setFileId((cur) => (f.some((x) => x.id === cur) ? cur : (f[0]?.id ?? '')))
      })
      .catch((err) => !cancelled && setError(errorText(err)))
    return () => {
      cancelled = true
      cancelRef.current = true
    }
  }, [])

  const file = files?.find((f) => f.id === fileId) ?? null
  const fileNames = useMemo(() => new Map(files?.map((f) => [f.id, f.filename]) ?? []), [files])

  function chooseFile(id: string) {
    setFileId(id)
    setParams(id ? { file: id } : {}, { replace: true })
  }

  const runsValid = Number.isInteger(runs) && runs >= 1 && runs <= 50

  async function runServer() {
    if (!file) return
    setBusy('server')
    setError('')
    setProgress(`Mendekripsi ${file.filename} sebanyak ${runs}× per algoritma di server…`)
    try {
      const r = await api.benchmark(file.id, runs)
      setResult({
        source: 'server',
        file,
        runs: r.runs,
        rows: r.results.map((x) => ({
          algorithm: x.algorithm,
          summary: x.cipher,
          mbps: x.throughput_mbps,
          samples: x.cipher_ns,
          verifyNs: x.verify_ns,
        })),
      })
      await loadHistory()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(null)
      setProgress('')
    }
  }

  // Downloads the file runs times per algorithm from the browser and times
  // each request end to end (HMAC check + decryption + transfer). The first
  // download per algorithm is a warm-up and not recorded; the algorithm
  // order rotates every run.
  async function runClient() {
    if (!file) return
    setBusy('client')
    setError('')
    cancelRef.current = false
    const samples: Record<Algorithm, number[]> = { AES: [], DES: [], RC4: [] }
    const fetchOnce = async (alg: Algorithm) => {
      const t0 = performance.now()
      const res = await fetch(downloadUrl(file.id, alg), { cache: 'no-store', credentials: 'same-origin' })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new ApiError(res.status, data?.error ?? `HTTP ${res.status}`)
      }
      await res.arrayBuffer()
      return Math.max(1, Math.round((performance.now() - t0) * 1e6))
    }
    try {
      for (const alg of ALGORITHMS) {
        setProgress(`Pemanasan ${alg}…`)
        await fetchOnce(alg)
      }
      for (let run = 0; run < runs; run++) {
        for (let i = 0; i < ALGORITHMS.length; i++) {
          if (cancelRef.current) throw new Error('Benchmark dibatalkan.')
          const alg = ALGORITHMS[(i + run) % ALGORITHMS.length]
          setProgress(`Run ${run + 1}/${runs} — download ${alg}`)
          samples[alg].push(await fetchOnce(alg))
        }
      }
      setProgress('Menyimpan hasil…')
      for (const alg of ALGORITHMS) await api.recordClientBenchmark(file.id, alg, samples[alg])
      setResult({
        source: 'client',
        file,
        runs,
        rows: ALGORITHMS.map((alg) => {
          const s = summarize(samples[alg])
          return { algorithm: alg, summary: s, mbps: throughput(file.size, s.mean_ns), samples: samples[alg] }
        }),
      })
      await loadHistory()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(null)
      setProgress('')
    }
  }

  async function exportCsv() {
    try {
      const rows = await api.benchmarkRaw()
      const esc = (v: string | number | null) => {
        const s = v === null ? '' : String(v)
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      }
      const header = ['file_id', 'filename', 'algorithm', 'operation', 'source', 'bytes', 'run_index', 'duration_ns', 'created_at']
      const lines = rows.map((r) =>
        [
          r.file_id,
          r.file_id ? (fileNames.get(r.file_id) ?? '') : '',
          r.algorithm,
          r.operation,
          r.source,
          r.bytes,
          r.run_index,
          r.duration_ns,
          r.created_at,
        ]
          .map(esc)
          .join(','),
      )
      const blob = new Blob([[header.join(','), ...lines].join('\n') + '\n'], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'benchmark_raw.csv'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(errorText(err))
    }
  }

  async function clearHistory() {
    if (!window.confirm('Hapus seluruh riwayat benchmark?')) return
    try {
      await api.clearBenchmarks()
      await loadHistory()
    } catch (err) {
      setError(errorText(err))
    }
  }

  const series: SeriesResult[] =
    result?.rows.map((r) => ({ algorithm: r.algorithm, meanNs: r.summary.mean_ns, samplesNs: r.samples })) ?? []

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Benchmark</h1>
          <p className="muted">
            Unduh/dekripsi data berkali-kali dan bandingkan running time AES, DES, dan RC4 pada file yang sama.
          </p>
        </div>
      </div>

      <section className="card">
        <h2>Jalankan pengukuran</h2>
        {!files && !error && <Spinner />}
        {files && files.length === 0 && <p className="muted">Unggah file terlebih dahulu di halaman File.</p>}
        {files && files.length > 0 && (
          <>
            <div className="bench-controls">
              <label className="field grow">
                <span>File</span>
                <select value={fileId} onChange={(e) => chooseFile(e.target.value)} disabled={busy !== null}>
                  {files.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.filename} — {CATEGORY_LABEL[f.category]}, {formatBytes(f.size)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field runs-field">
                <span>Jumlah run</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={Number.isNaN(runs) ? '' : runs}
                  onChange={(e) => setRuns(e.target.valueAsNumber)}
                  disabled={busy !== null}
                />
              </label>
            </div>
            {!runsValid && <Alert kind="error">Jumlah run harus 1–50.</Alert>}
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!file || !runsValid || busy !== null}
                onClick={runServer}
              >
                Dekripsi berulang di server
              </button>
              <button
                type="button"
                className="btn"
                disabled={!file || !runsValid || busy !== null}
                onClick={runClient}
              >
                Download berulang dari browser
              </button>
              {busy === 'client' && (
                <button type="button" className="btn btn-ghost" onClick={() => (cancelRef.current = true)}>
                  Batalkan
                </button>
              )}
            </div>
            <ul className="small muted bench-notes">
              <li>
                <strong>Server</strong>: hanya waktu cipher (setup kunci + XOR keystream), dari file di disk ke memori.
                HMAC diverifikasi sekali per algoritma dan diukur terpisah.
              </li>
              <li>
                <strong>Browser</strong>: waktu end-to-end satu download (verifikasi HMAC + dekripsi + transfer HTTP),
                diukur dengan <code>performance.now()</code>.
              </li>
            </ul>
            {busy && <Spinner label={progress || 'Menjalankan…'} />}
          </>
        )}
        {error && <Alert kind="error">{error}</Alert>}
      </section>

      {result && (
        <section className="card">
          <h2>
            Hasil: {result.source === 'server' ? 'dekripsi di server' : 'download dari browser'} — {result.file.filename}
          </h2>
          <p className="small muted">
            {formatBytes(result.file.size)} · {result.runs} run per algoritma
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Algoritma</th>
                  <th className="num">Rata-rata</th>
                  <th className="num">Median</th>
                  <th className="num">Std. deviasi</th>
                  <th className="num">Min</th>
                  <th className="num">Maks</th>
                  <th className="num">Throughput</th>
                  {result.source === 'server' && <th className="num">Verifikasi HMAC</th>}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.algorithm}>
                    <td>
                      <AlgDot alg={r.algorithm} /> {r.algorithm}
                    </td>
                    <td className="num">{formatNs(r.summary.mean_ns)}</td>
                    <td className="num">{formatNs(r.summary.median_ns)}</td>
                    <td className="num">{formatNs(r.summary.stddev_ns)}</td>
                    <td className="num">{formatNs(r.summary.min_ns)}</td>
                    <td className="num">{formatNs(r.summary.max_ns)}</td>
                    <td className="num">{formatNumber(r.mbps, 1)} MB/s</td>
                    {result.source === 'server' && <td className="num">{formatNs(r.verifyNs ?? 0)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <MeanBarChart
            results={series}
            label={result.source === 'server' ? 'Rata-rata waktu dekripsi (lebih pendek = lebih cepat)' : 'Rata-rata waktu download (lebih pendek = lebih cepat)'}
          />
          <RunsSmallMultiples results={series} />
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Riwayat pengukuran</h2>
          <div className="btn-row">
            <button type="button" className="btn btn-sm" onClick={exportCsv} disabled={!history?.length}>
              Ekspor CSV (data mentah)
            </button>
            <button type="button" className="btn btn-sm btn-danger-ghost" onClick={clearHistory} disabled={!history?.length}>
              Hapus riwayat
            </button>
          </div>
        </div>
        {!history && <Spinner />}
        {history && history.length === 0 && <p className="muted">Belum ada data benchmark.</p>}
        {history && history.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Operasi</th>
                  <th>Sumber</th>
                  <th>Algoritma</th>
                  <th className="num">n</th>
                  <th className="num">Ukuran</th>
                  <th className="num">Rata-rata</th>
                  <th className="num">Std. deviasi</th>
                  <th className="num">Throughput</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={`${h.file_id}-${h.operation}-${h.source}-${h.algorithm}-${i}`}>
                    <td className="file-name">
                      {h.file_id ? (fileNames.get(h.file_id) ?? h.file_id.slice(0, 8)) : <em className="muted">(dihapus)</em>}
                    </td>
                    <td>{OPERATION_LABEL[h.operation] ?? h.operation}</td>
                    <td>{h.source === 'server' ? 'Server' : 'Browser'}</td>
                    <td>
                      <AlgDot alg={h.algorithm} /> {h.algorithm}
                    </td>
                    <td className="num">{h.runs}</td>
                    <td className="num">{formatBytes(h.bytes)}</td>
                    <td className="num">{formatNs(h.mean_ns)}</td>
                    <td className="num">{formatNs(h.stddev_ns)}</td>
                    <td className="num">{formatNumber(h.throughput_mbps, 1)} MB/s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
