import type { Algorithm } from './api'

export interface AlgInfo {
  name: string
  mode: string
  keyBits: string
  blockBits: string
  note: string
  /** CSS custom property holding this algorithm's series color. */
  colorVar: string
}

// Colors follow the algorithm everywhere (charts, dots, tabs) so the same
// entity always has the same hue.
export const ALG_INFO: Record<Algorithm, AlgInfo> = {
  AES: {
    name: 'AES-256',
    mode: 'CTR',
    keyBits: '256 bit',
    blockBits: '128 bit',
    note: 'Standar saat ini; dipercepat instruksi AES-NI di CPU modern.',
    colorVar: '--series-1',
  },
  DES: {
    name: 'DES',
    mode: 'CTR',
    keyBits: '56 bit efektif',
    blockBits: '64 bit',
    note: 'Kunci pendek (bisa di-brute-force) dan blok 64-bit rawan Sweet32.',
    colorVar: '--series-2',
  },
  RC4: {
    name: 'RC4-128',
    mode: 'Stream, drop-3072',
    keyBits: '128 bit',
    blockBits: '— (stream)',
    note: 'Keystream awal bias; nonce per file mencegah keystream dipakai ulang.',
    colorVar: '--series-3',
  },
}
