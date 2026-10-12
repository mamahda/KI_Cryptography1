// Typed client for the backend API. Every request goes to /api on the same
// origin (proxied by Vite in development) so the HttpOnly session cookie
// is sent automatically.

export type Algorithm = 'AES' | 'DES' | 'RC4'
export const ALGORITHMS: Algorithm[] = ['AES', 'DES', 'RC4']

export type Category = 'id_card' | 'document' | 'video'

export interface User {
  id: number
  username: string
}

export interface Profile {
  full_name: string
  nik: string
  birth_place: string
  birth_date: string
  gender: string
  nationality: string
  religion: string
  marital_status: string
  address: string
  phone: string
  email: string
  blood_type: string
  health_notes: string
  bank_account: string
}

export interface Timing {
  cipher_ns: number
  total_ns: number
}

export interface ProfileResponse {
  algorithm: Algorithm
  data: Profile | null
  decrypt_ns?: number
  decrypt_total_ns?: number
  encrypt_ns?: number
  size?: number
  iv_hex?: string
  mac_hex?: string
  ciphertext_hex?: string
  ciphertext_entropy?: number
  updated_at?: string
}

export interface SaveProfileResponse {
  data: Profile
  size: number
  encrypt: Record<Algorithm, Timing>
}

export interface FileItem {
  id: string
  category: Category
  filename: string
  mime_type: string
  size: number
  created_at: string
  integrity_error?: boolean
}

export interface UploadResponse {
  file: FileItem
  encrypt: Record<Algorithm, Timing>
}

export interface VariantAnalysis {
  algorithm: Algorithm
  mode: string
  key_bits: number
  block_bits: number
  iv_hex: string
  mac_hex: string
  size_cipher: number
  overhead_bytes: number
  entropy: number
  hex_preview: string
  mac_valid: boolean
  encrypt_ns: number
  encrypt_total_ns: number
}

export interface Analysis extends FileItem {
  plaintext: { entropy: number; hex_preview: string } | null
  variants: VariantAnalysis[]
}

export interface Summary {
  mean_ns: number
  median_ns: number
  stddev_ns: number
  min_ns: number
  max_ns: number
}

export interface BenchResult {
  algorithm: Algorithm
  verify_ns: number
  cipher: Summary
  total: Summary
  throughput_mbps: number
  cipher_ns: number[]
}

export interface BenchResponse {
  file_id: string
  bytes: number
  runs: number
  results: BenchResult[]
}

export type Operation = 'encrypt' | 'decrypt' | 'download'
export type Source = 'server' | 'client'

export interface BenchSummaryItem {
  file_id: string | null
  algorithm: Algorithm
  operation: Operation
  source: Source
  runs: number
  bytes: number
  mean_ns: number
  min_ns: number
  max_ns: number
  stddev_ns: number
  throughput_mbps: number
}

export interface BenchRawRow {
  file_id: string | null
  algorithm: Algorithm
  operation: Operation
  source: Source
  bytes: number
  run_index: number
  duration_ns: number
  created_at: string
}

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

let onUnauthorized: (() => void) | null = null

/** Called whenever an authenticated request comes back 401. */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn
}

function errorMessage(data: unknown, status: number): string {
  if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
    return data.error
  }
  return `Permintaan gagal (HTTP ${status})`
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'Tidak dapat terhubung ke server. Pastikan backend berjalan.')
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.()
    throw new ApiError(res.status, errorMessage(data, res.status))
  }
  return data as T
}

export const api = {
  me: () => request<User>('GET', '/auth/me'),
  /** Always 200: { user: null } when signed out, so page load logs no 401. */
  session: () => request<{ user: User | null }>('GET', '/auth/session').then((r) => r.user),
  login: (username: string, password: string) => request<User>('POST', '/auth/login', { username, password }),
  register: (username: string, password: string) =>
    request<User>('POST', '/auth/register', { username, password }),
  logout: () => request<void>('POST', '/auth/logout'),

  getProfile: (alg: Algorithm) => request<ProfileResponse>('GET', `/profile?alg=${alg}`),
  saveProfile: (p: Profile) => request<SaveProfileResponse>('PUT', '/profile', p),

  listFiles: (category?: Category) =>
    request<{ files: FileItem[] }>('GET', category ? `/files?category=${category}` : '/files').then((r) => r.files),
  deleteFile: (id: string) => request<void>('DELETE', `/files/${id}`),
  analysis: (id: string) => request<Analysis>('GET', `/files/${id}/analysis`),
  benchmark: (id: string, runs: number) => request<BenchResponse>('POST', `/files/${id}/benchmark`, { runs }),

  recordClientBenchmark: (fileId: string, algorithm: Algorithm, durationsNs: number[]) =>
    request<{ inserted: number }>('POST', '/benchmarks', {
      file_id: fileId,
      algorithm,
      durations_ns: durationsNs,
    }),
  benchmarkSummary: () => request<{ summary: BenchSummaryItem[] }>('GET', '/benchmarks').then((r) => r.summary),
  benchmarkRaw: () => request<{ rows: BenchRawRow[] }>('GET', '/benchmarks/raw').then((r) => r.rows),
  clearBenchmarks: () => request<void>('DELETE', '/benchmarks'),
}

export function downloadUrl(id: string, alg: Algorithm): string {
  return `/api/files/${id}/download?alg=${alg}`
}

/**
 * Uploads with XMLHttpRequest because fetch cannot report upload progress.
 * onProgress receives a fraction between 0 and 1.
 */
export function uploadFile(
  category: Category,
  file: File,
  onProgress: (fraction: number) => void,
): { promise: Promise<UploadResponse>; abort: () => void } {
  const xhr = new XMLHttpRequest()
  const promise = new Promise<UploadResponse>((resolve, reject) => {
    const form = new FormData()
    form.append('category', category)
    form.append('file', file)
    xhr.open('POST', '/api/files')
    xhr.withCredentials = true
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      let data: unknown = null
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        data = null
      }
      if (xhr.status === 201) {
        resolve(data as UploadResponse)
        return
      }
      if (xhr.status === 401) onUnauthorized?.()
      reject(new ApiError(xhr.status, errorMessage(data, xhr.status)))
    }
    xhr.onerror = () => reject(new ApiError(0, 'Upload gagal: koneksi ke server terputus.'))
    xhr.onabort = () => reject(new ApiError(0, 'Upload dibatalkan.'))
    xhr.send(form)
  })
  return { promise, abort: () => xhr.abort() }
}

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
