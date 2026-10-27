import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Calculator, Cpu, Gauge, Inbox } from 'lucide-react'
import { useState } from 'react'
import {
  apiClient,
  BENCHMARK_OPERATIONS,
  BENCHMARK_SOURCES,
  isApiClientError,
  type BenchmarkOperation,
  type BenchmarkRow,
  type BenchmarkSource,
  type CipherType,
} from '@/api'
import { CARD, INPUT, LABEL, RECESSED, TD, TH, WELL } from '@/components/ui/tokens'
import { formatBytes } from '@/lib/fileValidation'

const OPERATION_LABELS: Record<BenchmarkOperation, string> = {
  enc: 'Enkripsi',
  dec: 'Dekripsi',
  hmac: 'HMAC-SHA256',
}

const SOURCE_LABELS: Record<BenchmarkSource, string> = {
  controlled: 'Terkendali (lab)',
  live: 'Langsung (produksi)',
}

const CIPHER_LABELS: Record<CipherType, string> = {
  aes: 'AES-CTR',
  des: 'DES-CTR',
  rc4: 'RC4',
}

/**
 * One upload is encrypted three times and each ciphertext gets its own HMAC
 * tag, so the HMAC term carries a factor of three while each cipher is paid
 * for once:
 *
 *   T_CPU = N · S · (1/v_AES + 1/v_DES + 1/v_RC4 + 3/v_HMAC)
 *
 * `S` is in MB and each `v` in MB/s, so the result is in seconds.
 */
const HMAC_TAGS_PER_ITEM = 3

interface Throughputs {
  aes: number | null
  des: number | null
  rc4: number | null
  hmac: number | null
}

/** Throughput of the encryption pass per cipher, plus the HMAC pass. */
function readThroughputs(rows: BenchmarkRow[]): Throughputs {
  function encThroughput(cipher: CipherType): number | null {
    const row = rows.find(
      (candidate) => candidate.cipher === cipher && candidate.operation === 'enc',
    )
    return row ? row.median_mb_s : null
  }

  const hmacRow = rows.find((candidate) => candidate.operation === 'hmac')

  return {
    aes: encThroughput('aes'),
    des: encThroughput('des'),
    rc4: encThroughput('rc4'),
    hmac: hmacRow ? hmacRow.median_mb_s : null,
  }
}

function computeTCpuSeconds(
  throughputs: Throughputs,
  itemCount: number,
  sizeMb: number,
): number | null {
  const { aes, des, rc4, hmac } = throughputs
  if (!aes || !des || !rc4 || !hmac) {
    return null
  }
  const secondsPerMb = 1 / aes + 1 / des + 1 / rc4 + HMAC_TAGS_PER_ITEM / hmac
  return itemCount * sizeMb * secondsPerMb
}

function nanosecondsToMs(ns: number): string {
  return (ns / 1_000_000).toFixed(2)
}

export function BenchmarksPage() {
  const [source, setSource] = useState<BenchmarkSource>('controlled')
  const [operation, setOperation] = useState<BenchmarkOperation | ''>('')
  const [itemCount, setItemCount] = useState('100')
  const [sizeMb, setSizeMb] = useState('5')

  const tableQuery = useQuery({
    queryKey: ['admin', 'benchmarks', source, operation],
    queryFn: ({ signal }) =>
      apiClient.admin.getBenchmarks({ source, ...(operation ? { operation } : {}) }, signal),
  })

  // The scenario always needs the encryption and HMAC passes, so it reads the
  // unfiltered set rather than whatever the table happens to be showing. With
  // no operation filter active this is the table's own query key.
  const scenarioQuery = useQuery({
    queryKey: ['admin', 'benchmarks', source, ''],
    queryFn: ({ signal }) => apiClient.admin.getBenchmarks({ source }, signal),
  })

  const rows = tableQuery.data?.rows ?? []
  const env = tableQuery.data?.env
  const throughputs = readThroughputs(scenarioQuery.data?.rows ?? [])

  const missing = [
    throughputs.aes === null ? 'AES-CTR' : null,
    throughputs.des === null ? 'DES-CTR' : null,
    throughputs.rc4 === null ? 'RC4' : null,
    throughputs.hmac === null ? 'HMAC-SHA256' : null,
  ].filter((label): label is string => label !== null)

  const parsedItemCount = Number(itemCount)
  const parsedSizeMb = Number(sizeMb)
  const scenarioValid =
    Number.isFinite(parsedItemCount) &&
    parsedItemCount > 0 &&
    Number.isFinite(parsedSizeMb) &&
    parsedSizeMb > 0
  const tCpuSeconds = scenarioValid
    ? computeTCpuSeconds(throughputs, parsedItemCount, parsedSizeMb)
    : null

  return (
    <div data-testid="admin-benchmarks-page" className="space-y-6">
      <header className={`${CARD} p-6`}>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#333] bg-black px-3 py-1 text-xs font-medium text-zinc-300">
          <Gauge className="h-3.5 w-3.5 text-zinc-100" aria-hidden="true" />
          Superadmin
        </span>
        <h1 className="mt-2.5 text-2xl font-bold tracking-tight text-white">
          Cipher Benchmark Dashboard
        </h1>
        <p className="mt-1.5 max-w-prose text-sm text-zinc-400">
          Throughput terukur untuk ketiga cabang cipher beserta sebaran waktunya, lalu dipakai
          untuk memperkirakan biaya CPU satu skenario unggahan.
        </p>
      </header>

      {tableQuery.isError ? (
        <p
          data-testid="benchmark-error"
          role="alert"
          className={`${CARD} flex items-start gap-2 p-6 text-sm text-red-200`}
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {isApiClientError(tableQuery.error)
              ? tableQuery.error.message
              : 'Gagal memuat hasil benchmark.'}
          </span>
        </p>
      ) : null}

      {env ? (
        <section className={`${CARD} p-6`} aria-labelledby="env-heading">
          <h2
            id="env-heading"
            className="flex items-center gap-1.5 text-lg font-semibold text-white"
          >
            <Cpu className="h-4 w-4 text-zinc-400" aria-hidden="true" />
            Lingkungan pengukuran
          </h2>
          <dl data-testid="benchmark-env" className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
            <div className={`${RECESSED} px-3 py-2 sm:col-span-2`}>
              <dt className="text-xs text-zinc-400">CPU</dt>
              <dd className="mt-0.5 text-sm text-zinc-200">{env.cpu}</dd>
            </div>
            <div className={`${RECESSED} px-3 py-2`}>
              <dt className="text-xs text-zinc-400">AES-NI</dt>
              <dd className="mt-0.5 text-sm text-zinc-200">
                {env.aes_ni ? 'Aktif' : 'Tidak aktif'}
              </dd>
            </div>
            <div className={`${RECESSED} px-3 py-2`}>
              <dt className="text-xs text-zinc-400">Python</dt>
              <dd className="mt-0.5 text-sm tabular-nums text-zinc-200">{env.python}</dd>
            </div>
            <div className={`${RECESSED} px-3 py-2 sm:col-span-4`}>
              <dt className="text-xs text-zinc-400">PyCryptodome</dt>
              <dd className="mt-0.5 text-sm tabular-nums text-zinc-200">{env.pycryptodome}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className={`${CARD} p-6`} aria-labelledby="rows-heading">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="rows-heading" className="text-lg font-semibold text-white">
            Hasil pengukuran
          </h2>

          <div className="flex flex-wrap gap-3">
            <div>
              <label htmlFor="benchmark-source-filter" className={LABEL}>
                Sumber
              </label>
              <select
                id="benchmark-source-filter"
                data-testid="benchmark-source-filter"
                value={source}
                onChange={(event) => setSource(event.target.value as BenchmarkSource)}
                className={`mt-1 ${INPUT} sm:w-52`}
              >
                {BENCHMARK_SOURCES.map((value) => (
                  <option key={value} value={value}>
                    {SOURCE_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="benchmark-operation-filter" className={LABEL}>
                Operasi
              </label>
              <select
                id="benchmark-operation-filter"
                data-testid="benchmark-operation-filter"
                value={operation}
                onChange={(event) => setOperation(event.target.value as BenchmarkOperation | '')}
                className={`mt-1 ${INPUT} sm:w-52`}
              >
                <option value="">Semua operasi</option>
                {BENCHMARK_OPERATIONS.map((value) => (
                  <option key={value} value={value}>
                    {OPERATION_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {tableQuery.isPending ? (
          <p data-testid="benchmark-loading" className="mt-3 text-sm text-zinc-400">
            Memuat hasil benchmark...
          </p>
        ) : null}

        {tableQuery.isSuccess && rows.length === 0 ? (
          <div
            data-testid="benchmark-empty-state"
            className={`mt-3 ${WELL} flex flex-col items-center gap-2 px-4 py-10 text-center`}
          >
            <Inbox className="h-6 w-6 text-zinc-400" aria-hidden="true" />
            <p className="text-sm font-medium text-zinc-200">Belum ada hasil untuk filter ini</p>
          </div>
        ) : null}

        {rows.length > 0 ? (
          <div className={`mt-3 ${WELL} overflow-x-auto`}>
            <table data-testid="benchmark-table" className="w-full border-collapse">
              <caption className="sr-only">
                Throughput median dan rentang antar-kuartil per cipher dan operasi
              </caption>
              <thead>
                <tr className="border-b border-[#222]">
                  <th scope="col" className={TH}>
                    Cipher
                  </th>
                  <th scope="col" className={TH}>
                    Operasi
                  </th>
                  <th scope="col" className={TH}>
                    Ukuran payload
                  </th>
                  <th scope="col" className={TH}>
                    n
                  </th>
                  <th scope="col" className={TH}>
                    Median
                  </th>
                  <th scope="col" className={TH}>
                    IQR (Q1–Q3)
                  </th>
                  <th scope="col" className={TH}>
                    Throughput
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={`${row.cipher}-${row.operation}-${row.size_bytes}`}
                    data-testid={`benchmark-row-${row.cipher}-${row.operation}-${row.size_bytes}`}
                    className="border-b border-[#1c1c1c] last:border-b-0"
                  >
                    <td className={`${TD} font-medium text-zinc-100`}>
                      {CIPHER_LABELS[row.cipher]}
                    </td>
                    <td className={TD}>{OPERATION_LABELS[row.operation]}</td>
                    <td className={`${TD} tabular-nums`}>{formatBytes(row.size_bytes)}</td>
                    <td className={`${TD} tabular-nums`}>{row.n}</td>
                    <td className={`${TD} tabular-nums whitespace-nowrap`}>
                      {nanosecondsToMs(row.median_ns)} ms
                    </td>
                    <td className={`${TD} tabular-nums whitespace-nowrap`}>
                      {nanosecondsToMs(row.q1_ns)}–{nanosecondsToMs(row.q3_ns)} ms
                    </td>
                    <td className={`${TD} tabular-nums whitespace-nowrap text-zinc-100`}>
                      {row.median_mb_s} MB/s
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* T_CPU scenario calculator                                           */}
      {/* ------------------------------------------------------------------ */}

      <section className={`${CARD} p-6`} aria-labelledby="tcpu-heading">
        <h2
          id="tcpu-heading"
          className="flex items-center gap-1.5 text-lg font-semibold text-white"
        >
          <Calculator className="h-4 w-4 text-zinc-400" aria-hidden="true" />
          Kalkulator skenario T<sub>CPU</sub>
        </h2>

        <p data-testid="tcpu-formula" className={`mt-3 ${WELL} px-3 py-2.5 text-sm text-zinc-300`}>
          <code className="font-mono text-xs break-words text-zinc-200">
            T_CPU = N · S · (1/v_AES + 1/v_DES + 1/v_RC4 + 3/v_HMAC)
          </code>
          <span className="mt-1.5 block text-zinc-400">
            Setiap unggahan dienkripsi tiga kali dan setiap ciphertext memperoleh tag HMAC-nya
            sendiri, sehingga suku HMAC dikalikan 3 sementara tiap cipher dibayar sekali.
          </span>
        </p>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="tcpu-items-input" className={LABEL}>
              Jumlah item (N)
            </label>
            <input
              id="tcpu-items-input"
              data-testid="tcpu-items-input"
              type="number"
              min={1}
              step={1}
              value={itemCount}
              onChange={(event) => setItemCount(event.target.value)}
              className={`mt-1 ${INPUT}`}
            />
          </div>
          <div>
            <label htmlFor="tcpu-size-input" className={LABEL}>
              Ukuran rata-rata per item (S, MB)
            </label>
            <input
              id="tcpu-size-input"
              data-testid="tcpu-size-input"
              type="number"
              min={0}
              step="any"
              value={sizeMb}
              onChange={(event) => setSizeMb(event.target.value)}
              className={`mt-1 ${INPUT}`}
            />
          </div>
        </div>

        {missing.length > 0 ? (
          <p
            data-testid="tcpu-incomplete"
            className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-950/30 px-3 py-2.5 text-sm text-amber-200"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              T<sub>CPU</sub> belum dapat dihitung: belum ada pengukuran untuk {missing.join(', ')}.
            </span>
          </p>
        ) : !scenarioValid ? (
          <p data-testid="tcpu-invalid-scenario" className="mt-3 text-sm text-zinc-400">
            Masukkan jumlah item dan ukuran per item yang lebih besar dari nol.
          </p>
        ) : tCpuSeconds !== null ? (
          <div data-testid="tcpu-result" className={`mt-3 ${RECESSED} px-4 py-3`}>
            <p className="text-xs text-zinc-400">
              Perkiraan waktu CPU untuk {parsedItemCount} item × {parsedSizeMb} MB
            </p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-white sm:text-3xl">
              {tCpuSeconds.toFixed(2)} s
            </p>
            <p className="mt-1.5 text-xs text-zinc-400">
              Berdasarkan v_AES = {throughputs.aes} MB/s, v_DES = {throughputs.des} MB/s, v_RC4 ={' '}
              {throughputs.rc4} MB/s, v_HMAC = {throughputs.hmac} MB/s (sumber:{' '}
              {SOURCE_LABELS[source]}). Angka ini hanya biaya CPU kriptografi, bukan total latensi
              permintaan.
            </p>
          </div>
        ) : null}
      </section>
    </div>
  )
}
