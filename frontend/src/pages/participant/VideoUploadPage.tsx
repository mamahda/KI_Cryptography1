import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Clapperboard,
  Download,
  Lock,
  PlayCircle,
  ShieldAlert,
  Upload,
  Users,
} from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import {
  apiClient,
  isApiClientError,
  type ItemMeta,
  type UploadProgress,
} from '@/api'
import { formatBytes, validateVideoFile, VIDEO_MAX_BYTES } from '@/lib/fileValidation'
import { useAuthStore } from '@/stores/authStore'

const CARD =
  'rounded-xl border border-[#222] bg-[#121212] shadow-[0_10px_40px_rgba(0,0,0,0.8)]'
const WELL = 'rounded-lg border border-[#222] bg-black'
const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-100'
const BTN_PRIMARY = `inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-[#ededed] px-4 py-2 text-sm font-semibold text-black transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`
const BTN_SECONDARY = `inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#333] bg-black px-3.5 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`

function describeError(error: unknown, fallback: string): string {
  return isApiClientError(error) ? error.message : fallback
}

export function VideoUploadPage() {
  const user = useAuthStore((state) => state.user)
  const queryClient = useQueryClient()

  const fileInputRef = useRef<HTMLInputElement>(null)
  /** The Object URL currently handed to the <video> element, if any. */
  const objectUrlRef = useRef<string | null>(null)
  const playbackAbortRef = useRef<AbortController | null>(null)

  const [uploadError, setUploadError] = useState<string | null>(null)
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [playbackError, setPlaybackError] = useState<string | null>(null)
  const [isIntegrityFailure, setIsIntegrityFailure] = useState(false)
  const [isLoadingPlayback, setIsLoadingPlayback] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)

  const teamQuery = useQuery({
    queryKey: ['team', 'me'],
    queryFn: ({ signal }) => apiClient.teams.getMine(signal),
  })

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: ({ signal }) => apiClient.public.getSettings(signal),
  })

  const team = teamQuery.data?.team ?? null
  const video = team?.submission.video ?? null
  const isLeader = Boolean(team && user && team.leader_id === user.id)
  const isLocked = team?.status === 'final'
  const maxBytes = settingsQuery.data?.limits.video_max_bytes ?? VIDEO_MAX_BYTES

  function revokeObjectUrl() {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }

  // The contract's own guidance: download the blob in full, play it, then
  // release the Object URL when the view goes away.
  useEffect(() => {
    return () => {
      playbackAbortRef.current?.abort()
      revokeObjectUrl()
    }
  }, [])

  const uploadMutation = useMutation({
    mutationFn: (file: File) =>
      apiClient.teams.uploadVideo(file, {
        filename: file.name,
        onProgress: setProgress,
      }),
    onSuccess: (uploaded: ItemMeta) => {
      setProgress(null)
      // A replacement invalidates whatever blob the player is holding.
      revokeObjectUrl()
      setObjectUrl(null)
      setPlaybackError(null)
      setIsIntegrityFailure(false)
      if (team) {
        queryClient.setQueryData(['team', 'me'], {
          team: { ...team, submission: { ...team.submission, video: uploaded } },
        })
      }
      void queryClient.invalidateQueries({ queryKey: ['team', 'me'] })
      void queryClient.invalidateQueries({ queryKey: ['teams', 'me'] })
    },
    onError: (error) => {
      setProgress(null)
      setUploadError(describeError(error, 'Video gagal diunggah.'))
    },
  })

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }

    setUploadError(null)
    const result = await validateVideoFile(file, maxBytes)
    if (!result.valid) {
      setUploadError(result.errorMessage)
      return
    }

    uploadMutation.mutate(file)
  }

  async function handleLoadPlayback() {
    if (!video) {
      return
    }

    playbackAbortRef.current?.abort()
    const controller = new AbortController()
    playbackAbortRef.current = controller

    revokeObjectUrl()
    setObjectUrl(null)
    setPlaybackError(null)
    setIsIntegrityFailure(false)
    setIsLoadingPlayback(true)

    try {
      const fetched = await apiClient.items.getBlob(video.item_id, {
        download: false,
        signal: controller.signal,
      })

      if (controller.signal.aborted) {
        return
      }

      const typedBlob =
        fetched.blob.type === fetched.content_type
          ? fetched.blob
          : new Blob([fetched.blob], { type: fetched.content_type })
      const nextUrl = URL.createObjectURL(typedBlob)
      objectUrlRef.current = nextUrl
      setObjectUrl(nextUrl)
    } catch (err) {
      if (isApiClientError(err) && err.code === 'aborted') {
        return
      }
      setIsIntegrityFailure(isApiClientError(err) && err.isIntegrityError())
      setPlaybackError(describeError(err, 'Gagal memuat video terenkripsi.'))
    } finally {
      setIsLoadingPlayback(false)
    }
  }

  async function handleDownload() {
    if (!video) {
      return
    }

    setIsDownloading(true)
    setPlaybackError(null)
    setIsIntegrityFailure(false)

    try {
      const fetched = await apiClient.items.getBlob(video.item_id, { download: true })

      const downloadUrl = URL.createObjectURL(fetched.blob)
      const anchor = document.createElement('a')
      anchor.href = downloadUrl
      anchor.download = fetched.filename || video.original_filename
      anchor.style.display = 'none'
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      window.setTimeout(() => {
        URL.revokeObjectURL(downloadUrl)
      }, 0)
    } catch (err) {
      setIsIntegrityFailure(isApiClientError(err) && err.isIntegrityError())
      setPlaybackError(describeError(err, 'Gagal mengunduh video dari server.'))
    } finally {
      setIsDownloading(false)
    }
  }

  if (teamQuery.isLoading) {
    return (
      <div
        role="status"
        data-testid="video-loading"
        className={`${CARD} p-6 text-center text-sm text-zinc-300`}
      >
        Memuat status video demo tim...
      </div>
    )
  }

  return (
    <div data-testid="video-page" className="space-y-6">
      <header className={`${CARD} p-6`}>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#333] bg-black px-3 py-1 text-xs font-medium text-zinc-300">
          <Clapperboard className="h-3.5 w-3.5 text-zinc-100" aria-hidden="true" />
          Video Demo · Komponen Karya
        </span>
        <h1 className="mt-2.5 text-2xl font-bold tracking-tight text-white">
          Video Demo Upload &amp; Player
        </h1>
        <p className="mt-1.5 max-w-prose text-sm text-zinc-400">
          Unggah satu video demo MP4 untuk tim Anda. Video dikirim sebagai byte mentah,
          disimpan terenkripsi, dan diputar kembali hanya setelah server memverifikasi
          integritasnya secara penuh.
        </p>
      </header>

      {teamQuery.isError && (
        <div
          role="alert"
          data-testid="video-team-error"
          className="flex items-center gap-2.5 rounded-xl border border-amber-500/40 bg-amber-950/40 px-5 py-4 text-sm text-amber-200"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
          Status tim gagal dimuat dari server.
        </div>
      )}

      {!team ? (
        <section
          data-testid="video-empty-state"
          className={`${CARD} p-6 text-sm text-zinc-300`}
        >
          <div className="flex items-start gap-3">
            <Users className="mt-0.5 h-5 w-5 shrink-0 text-zinc-400" aria-hidden="true" />
            <div>
              <p className="font-medium text-white">
                Anda belum tergabung dalam tim mana pun.
              </p>
              <p className="mt-1 text-zinc-400">
                Video demo adalah karya tim, bukan perorangan. Buat atau gabung tim terlebih
                dahulu di Team Workspace, lalu Ketua Tim dapat mengunggah video di halaman ini.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <section
          data-testid="video-upload-card"
          aria-labelledby="video-upload-heading"
          className={`${CARD} p-6`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#222] pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#333] bg-black text-white">
                <Clapperboard className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 id="video-upload-heading" className="text-base font-semibold text-white">
                  Video Demo Tim {team.name}
                </h2>
                <p className="text-sm text-zinc-400">
                  Format MP4, ukuran maksimal {formatBytes(maxBytes)}
                </p>
              </div>
            </div>

            {video ? (
              <span className="rounded-full border border-emerald-500/40 bg-emerald-950/50 px-3 py-1 text-xs font-semibold text-emerald-200">
                Terunggah
              </span>
            ) : (
              <span className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-semibold text-zinc-300">
                Belum Diunggah
              </span>
            )}
          </div>

          <div className="mt-4 space-y-4">
            {video ? (
              <div className={`${WELL} px-3.5 py-3 text-sm`}>
                <p data-testid="video-meta" className="text-zinc-300">
                  <span className="font-medium text-white">{video.original_filename}</span>
                  <span className="text-zinc-400">
                    {' · '}
                    <span className="tabular-nums">{formatBytes(video.size_bytes)}</span>
                    {' · '}
                    {video.content_type}
                  </span>
                </p>
              </div>
            ) : (
              <p className="text-sm text-zinc-400">
                Belum ada video demo yang diunggah untuk tim ini.
              </p>
            )}

            {isLocked ? (
              <div
                data-testid="video-locked-notice"
                className="flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-950/25 px-3.5 py-3 text-sm text-emerald-100"
              >
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
                <span>
                  Tim sudah submit final, sehingga video demo terkunci untuk penjurian dan
                  tidak dapat diganti lagi.
                </span>
              </div>
            ) : !isLeader ? (
              <div
                data-testid="video-not-leader-notice"
                className={`flex items-start gap-2.5 ${WELL} px-3.5 py-3 text-sm text-zinc-300`}
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
                <span>
                  Hanya Ketua Tim yang dapat mengunggah atau mengganti video demo. Anda tetap
                  dapat memutar dan mengunduh video tim di bawah ini.
                </span>
              </div>
            ) : (
              <div>
                <label htmlFor="file-input-video" className="text-sm font-medium text-zinc-200">
                  {video ? 'Ganti Video Demo' : 'Pilih Video Demo'}
                </label>
                <input
                  ref={fileInputRef}
                  id="file-input-video"
                  data-testid="file-input-video"
                  type="file"
                  accept="video/mp4,.mp4"
                  disabled={uploadMutation.isPending}
                  onChange={handleFileChange}
                  className="sr-only"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadMutation.isPending}
                    className={BTN_PRIMARY}
                  >
                    <Upload className="h-4 w-4" aria-hidden="true" />
                    {uploadMutation.isPending
                      ? 'Mengunggah...'
                      : video
                        ? 'Ganti Video'
                        : 'Unggah Video'}
                  </button>
                  <span className="text-sm text-zinc-400">
                    MP4 · maksimal <span className="tabular-nums">{formatBytes(maxBytes)}</span>
                  </span>
                </div>
              </div>
            )}

            {progress && (
              <div data-testid="video-progress" className={`${WELL} px-3.5 py-3`}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-zinc-300">Mengunggah video demo</span>
                  <span className="font-mono font-medium text-white tabular-nums">
                    {progress.percent === null ? '—' : `${progress.percent}%`}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress.percent ?? undefined}
                  aria-label="Progres unggahan video demo"
                  className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#1c1c1c]"
                >
                  <div
                    className="h-full rounded-full bg-[#ededed] transition-[width]"
                    style={{ width: `${progress.percent ?? 0}%` }}
                  />
                </div>
                <p className="mt-2 text-sm text-zinc-400 tabular-nums">
                  {`${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}`}
                </p>
              </div>
            )}

            {uploadError && (
              <div
                role="alert"
                data-testid="video-error"
                className="flex items-start gap-2.5 rounded-lg border border-rose-500/40 bg-rose-950/35 px-3.5 py-3 text-sm text-rose-100"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" aria-hidden="true" />
                <span>{uploadError}</span>
              </div>
            )}
          </div>

          {video && (
            <div className="mt-5 border-t border-[#222] pt-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  data-testid="video-load-btn"
                  onClick={handleLoadPlayback}
                  disabled={isLoadingPlayback}
                  className={BTN_SECONDARY}
                >
                  <PlayCircle className="h-4 w-4" aria-hidden="true" />
                  {isLoadingPlayback ? 'Memuat video...' : 'Muat & Putar Video'}
                </button>
                <button
                  type="button"
                  data-testid="video-download-btn"
                  onClick={handleDownload}
                  disabled={isDownloading}
                  className={BTN_SECONDARY}
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  {isDownloading ? 'Mengunduh...' : 'Unduh Video'}
                </button>
                <span className="text-sm text-zinc-400">
                  Video diunduh utuh dan diverifikasi sebelum diputar.
                </span>
              </div>

              {playbackError && (
                <div
                  role="alert"
                  data-testid="video-player-error"
                  className="mt-3 flex items-start gap-2.5 rounded-lg border border-rose-500/40 bg-rose-950/35 px-3.5 py-3 text-sm text-rose-100"
                >
                  <ShieldAlert
                    className="mt-0.5 h-4 w-4 shrink-0 text-rose-300"
                    aria-hidden="true"
                  />
                  <span>
                    {isIntegrityFailure && (
                      <strong className="font-semibold text-white">
                        Kegagalan Integritas Kriptografi (500 integrity_error).{' '}
                      </strong>
                    )}
                    {playbackError}
                  </span>
                </div>
              )}

              {objectUrl && (
                <video
                  data-testid="video-player"
                  src={objectUrl}
                  controls
                  preload="metadata"
                  className="mt-3 w-full rounded-lg border border-[#222] bg-black"
                >
                  <track kind="captions" />
                </video>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
