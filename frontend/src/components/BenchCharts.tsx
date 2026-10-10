import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
} from 'recharts'
import type { Algorithm } from '../lib/api'
import { useChartTheme, type ChartTheme } from '../lib/chartTheme'
import { formatNs, formatNumber } from '../lib/format'
import { AlgDot } from './ui'

export interface SeriesResult {
  algorithm: Algorithm
  meanNs: number
  samplesNs: number[]
}

function tooltipStyle(t: ChartTheme) {
  return {
    contentStyle: {
      background: t.surface,
      border: `1px solid ${t.grid}`,
      borderRadius: 8,
      color: t.text,
      fontSize: 13,
      boxShadow: '0 4px 16px rgba(0,0,0,.08)',
    },
    labelStyle: { color: t.text2, marginBottom: 2 },
    itemStyle: { color: t.text },
  }
}

const msTick = (v: number) => `${formatNumber(v, v < 10 ? 2 : 0)} ms`

/** Tick formatter with enough decimals that ticks across `span` ms stay distinct. */
function msTickFor(span: number) {
  const digits = span < 0.1 ? 3 : span < 1 ? 2 : span < 10 ? 1 : 0
  return (v: number) => `${formatNumber(v, digits)} ms`
}

/** Horizontal bars of the mean time per algorithm, value at the bar tip. */
export function MeanBarChart({ results, label }: { results: SeriesResult[]; label: string }) {
  const t = useChartTheme()
  const data = results.map((r) => ({ alg: r.algorithm, ms: r.meanNs / 1e6 }))
  return (
    <figure className="chart">
      <figcaption className="chart-title">{label}</figcaption>
      <ResponsiveContainer width="100%" height={56 * data.length + 40}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 96, bottom: 4, left: 4 }}>
          <CartesianGrid horizontal={false} stroke={t.grid} />
          <XAxis
            type="number"
            tickFormatter={msTick}
            tick={{ fill: t.muted, fontSize: 12 }}
            stroke={t.axis}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="alg"
            width={44}
            tick={{ fill: t.text2, fontSize: 13 }}
            stroke={t.axis}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: t.grid, opacity: 0.5 }}
            formatter={(v) => [formatNs(Number(v) * 1e6), 'Rata-rata']}
            {...tooltipStyle(t)}
          />
          <Bar
            dataKey="ms"
            barSize={24}
            isAnimationActive={false}
            shape={(p: BarShapeProps) => (
              <Rectangle
                x={p.x}
                y={p.y}
                width={p.width}
                height={p.height}
                radius={[0, 4, 4, 0]}
                fill={t.series[(p.payload as { alg: Algorithm }).alg]}
              />
            )}
          >
            <LabelList
              dataKey="ms"
              position="right"
              formatter={(v) => formatNs(Number(v) * 1e6)}
              fill={t.text2}
              fontSize={12}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </figure>
  )
}

/**
 * One small line chart per algorithm showing every run. Each panel has its
 * own y-scale because DES is roughly two orders of magnitude slower than
 * AES; the panel title says so to avoid cross-panel misreading.
 */
export function RunsSmallMultiples({ results }: { results: SeriesResult[] }) {
  const t = useChartTheme()
  return (
    <div className="multiples">
      {results.map((r) => {
        const data = r.samplesNs.map((ns, i) => ({ run: i + 1, ms: ns / 1e6 }))
        const values = data.map((d) => d.ms)
        const span = values.length ? Math.max(...values) - Math.min(...values) : 0
        const color = t.series[r.algorithm]
        return (
          <figure key={r.algorithm} className="chart">
            <figcaption className="chart-title">
              <AlgDot alg={r.algorithm} /> {r.algorithm} — waktu per run
            </figcaption>
            <ResponsiveContainer width="100%" height={150}>
              <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke={t.grid} />
                <XAxis
                  dataKey="run"
                  tick={{ fill: t.muted, fontSize: 11 }}
                  stroke={t.axis}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  width={64}
                  domain={['auto', 'auto']}
                  tickFormatter={msTickFor(span)}
                  tick={{ fill: t.muted, fontSize: 11 }}
                  stroke={t.axis}
                  tickLine={false}
                  tickCount={4}
                />
                <Tooltip
                  formatter={(v) => [formatNs(Number(v) * 1e6), r.algorithm]}
                  labelFormatter={(l) => `Run ${l}`}
                  {...tooltipStyle(t)}
                />
                <Line
                  type="linear"
                  dataKey="ms"
                  stroke={color}
                  strokeWidth={2}
                  dot={{ r: 4, fill: color, stroke: t.surface, strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: color, stroke: t.surface, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </figure>
        )
      })}
      <p className="small muted span-all">Setiap panel memakai skala sumbu-Y sendiri; bandingkan nilai antar algoritma lewat tabel.</p>
    </div>
  )
}
