import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Alert, AlgDot, EntropyMeter, HexView, MacBadge, Spinner } from '../components/ui'
import { api, downloadUrl, errorText, type Analysis } from '../lib/api'
import { ALG_INFO } from '../lib/algorithms'
import { CATEGORY_LABEL, formatBytes, formatDate, formatNs } from '../lib/format'

export function AnalysisPage() {
  const { id = '' } = useParams()
  const [result, setResult] = useState<{ id: string; data?: Analysis; error?: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .analysis(id)
      .then((d) => !cancelled && setResult({ id, data: d }))
      .catch((err) => !cancelled && setResult({ id, error: errorText(err) }))
    return () => {
      cancelled = true
    }
  }, [id])

  // Ignore a result that belongs to a previously viewed file.
  const current = result?.id === id ? result : null
  const data = current?.data ?? null
  const error = current?.error ?? ''

  return (
    <>
      <div className="page-head">
        <div>
          <Link to={data ? `/files?c=${data.category}` : '/files'} className="back-link">
            ← Kembali ke daftar file
          </Link>
          <h1>Analisis ciphertext</h1>
          {data && (
            <p className="muted">
              <strong>{data.filename}</strong> · {CATEGORY_LABEL[data.category]} · {data.mime_type} ·{' '}
              {formatBytes(data.size)} · {formatDate(data.created_at)}
            </p>
          )}
        </div>
        {data && (
          <Link className="btn" to={`/benchmark?file=${data.id}`}>
            Benchmark file ini
          </Link>
        )}
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {!data && !error && <Spinner label="Membaca dan memverifikasi ketiga ciphertext…" />}

      {data && (
        <>
          <section className="card">
            <h2>Plaintext (file asli)</h2>
            {data.plaintext ? (
              <>
                <dl className="kv">
                  <dt>Ukuran</dt>
                  <dd>{formatBytes(data.size)}</dd>
                  <dt>Entropi</dt>
                  <dd>
                    <EntropyMeter value={data.plaintext.entropy} />
                  </dd>
                </dl>
                <h3 className="h-sub">256 byte pertama</h3>
                <HexView hex={data.plaintext.hex_preview} />
              </>
            ) : (
              <Alert kind="error">Tidak ada varian dengan HMAC valid, plaintext tidak ditampilkan.</Alert>
            )}
          </section>

          <div className="variant-grid">
            {data.variants.map((v) => (
              <section key={v.algorithm} className="card variant-card">
                <div className="card-head">
                  <h2 className="alg-title">
                    <AlgDot alg={v.algorithm} /> {ALG_INFO[v.algorithm].name}
                  </h2>
                  <MacBadge valid={v.mac_valid} />
                </div>
                <dl className="kv">
                  <dt>Mode</dt>
                  <dd>{v.mode}</dd>
                  <dt>Kunci / blok</dt>
                  <dd>
                    {v.key_bits} bit / {v.block_bits ? `${v.block_bits} bit` : 'stream'}
                  </dd>
                  <dt>Ukuran ciphertext</dt>
                  <dd>
                    {formatBytes(v.size_cipher)}{' '}
                    <span className="muted small">
                      ({v.size_cipher === data.size ? 'sama dengan plaintext, tanpa padding' : 'berbeda'})
                    </span>
                  </dd>
                  <dt>Overhead tersimpan</dt>
                  <dd>
                    {v.overhead_bytes} byte <span className="muted small">(IV/nonce + HMAC, di database)</span>
                  </dd>
                  <dt>Entropi</dt>
                  <dd>
                    <EntropyMeter value={v.entropy} />
                  </dd>
                  <dt>Waktu enkripsi</dt>
                  <dd>
                    {formatNs(v.encrypt_ns)} <span className="muted small">(total {formatNs(v.encrypt_total_ns)})</span>
                  </dd>
                  <dt>{v.algorithm === 'RC4' ? 'Nonce' : 'IV'}</dt>
                  <dd className="mono break">{v.iv_hex}</dd>
                  <dt>HMAC</dt>
                  <dd className="mono break">{v.mac_hex}</dd>
                </dl>
                <h3 className="h-sub">128 byte pertama ciphertext</h3>
                <HexView hex={v.hex_preview.slice(0, 256)} ascii={false} perRow={8} />
                <a className="btn btn-block" href={downloadUrl(data.id, v.algorithm)} download>
                  Unduh (dekripsi {v.algorithm})
                </a>
              </section>
            ))}
          </div>

          <section className="card">
            <h2>Cara membaca</h2>
            <ul className="check-list">
              <li>
                Ketiga ciphertext berukuran sama dengan plaintext karena CTR dan RC4 bekerja sebagai stream cipher,
                sehingga tidak ada padding.
              </li>
              <li>
                Entropi ciphertext mendekati 8 bit/byte (tampak acak) walaupun entropi plaintext rendah. Dengan ECB,
                blok plaintext yang sama akan menghasilkan blok ciphertext yang sama.
              </li>
              <li>
                Byte ciphertext ketiga algoritma berbeda total walaupun berasal dari file yang sama: kunci dan
                IV/nonce-nya berbeda.
              </li>
              <li>HMAC diverifikasi untuk setiap versi. Jika file diubah 1 bit saja, versi itu ditandai tidak cocok.</li>
            </ul>
          </section>
        </>
      )}
    </>
  )
}
