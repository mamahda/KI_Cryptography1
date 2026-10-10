import { useEffect, useState } from 'react'
import type { Algorithm } from './api'

export interface ChartTheme {
  series: Record<Algorithm, string>
  surface: string
  grid: string
  axis: string
  muted: string
  text: string
  text2: string
}

// SVG presentation attributes do not reliably resolve var(), so the chart
// colors are read from the CSS tokens and re-read when the color scheme flips.
function readTheme(): ChartTheme {
  const s = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback
  return {
    series: {
      AES: v('--series-1', '#2a78d6'),
      DES: v('--series-2', '#eb6834'),
      RC4: v('--series-3', '#1baf7a'),
    },
    surface: v('--surface', '#fcfcfb'),
    grid: v('--grid', '#e1e0d9'),
    axis: v('--axis', '#c3c2b7'),
    muted: v('--muted', '#898781'),
    text: v('--text', '#0b0b0b'),
    text2: v('--text-2', '#52514e'),
  }
}

export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState(readTheme)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setTheme(readTheme())
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return theme
}
