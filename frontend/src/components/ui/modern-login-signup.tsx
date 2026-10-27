import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import type * as ThreeNamespace from 'three'
import { apiClient, isApiClientError } from '@/api'
import { cn } from '@/lib/utils'
import { resolvePostAuthNavigation } from '@/pages/auth/authNavigation'
import { useAuthStore } from '@/stores/authStore'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 10

export interface ModernLoginSignupProps {
  initialMode?: 'login' | 'register'
  syncWithRouter?: boolean
  className?: string
}

interface AuthFieldErrors {
  email?: string
  password?: string
  confirmPassword?: string
}

export default function ModernLoginSignup({
  initialMode = 'login',
  syncWithRouter = false,
  className,
}: ModernLoginSignupProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [localIsLogin, setLocalIsLogin] = useState(initialMode === 'login')
  const isLogin = syncWithRouter ? initialMode === 'login' : localIsLogin

  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()

  const sessionChecked = useAuthStore((state) => state.sessionChecked)
  const user = useAuthStore((state) => state.user)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || typeof WebGL2RenderingContext === 'undefined') {
      return
    }

    let active = true
    let renderer: ThreeNamespace.WebGLRenderer | null = null
    let geometry: ThreeNamespace.PlaneGeometry | null = null
    let material: ThreeNamespace.ShaderMaterial | null = null
    let animationId = 0
    let detachResize: (() => void) | null = null

    let glContext: WebGL2RenderingContext | null = null
    try {
      glContext = canvas.getContext('webgl2', {
        alpha: true,
        antialias: false,
      })
    } catch {
      glContext = null
    }

    if (!glContext) {
      return
    }

    const getBounds = () => ({
      width: container.clientWidth || window.innerWidth,
      height: container.clientHeight || window.innerHeight,
    })

    const verifiedGl = glContext

    void import('three')
      .then((THREE) => {
        if (!active) {
          return
        }

        const initialBounds = getBounds()
        renderer = new THREE.WebGLRenderer({
          canvas,
          context: verifiedGl,
          alpha: true,
          antialias: false,
        })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
        renderer.setSize(initialBounds.width, initialBounds.height)

        const scene = new THREE.Scene()
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

        const uniforms = {
          u_time: { value: 0 },
          u_resolution: {
            value: new THREE.Vector2(initialBounds.width * 2, initialBounds.height * 2),
          },
          u_opacities: { value: [0.3, 0.3, 0.3, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 1.0] },
          u_colors: {
            value: [
              new THREE.Vector3(1, 1, 1),
              new THREE.Vector3(1, 1, 1),
              new THREE.Vector3(1, 1, 1),
              new THREE.Vector3(1, 1, 1),
              new THREE.Vector3(1, 1, 1),
              new THREE.Vector3(1, 1, 1),
            ],
          },
          u_total_size: { value: 20.0 },
          u_dot_size: { value: 6.0 },
          u_reverse: { value: 0 },
        }

        material = new THREE.ShaderMaterial({
          vertexShader: `
            precision mediump float;
            uniform vec2 u_resolution;
            out vec2 fragCoord;
            void main() {
              gl_Position = vec4(position, 1.0);
              fragCoord = (position.xy + 1.0) * 0.5 * u_resolution;
              fragCoord.y = u_resolution.y - fragCoord.y;
            }
          `,
          fragmentShader: `
            precision mediump float;
            in vec2 fragCoord;

            uniform float u_time;
            uniform float u_opacities[10];
            uniform vec3 u_colors[6];
            uniform float u_total_size;
            uniform float u_dot_size;
            uniform vec2 u_resolution;
            uniform int u_reverse;

            out vec4 fragColor;

            float PHI = 1.61803398874989484820459;
            float random(vec2 xy) {
                return fract(tan(distance(xy * PHI, xy) * 0.5) * xy.x);
            }

            void main() {
                vec2 st = fragCoord.xy;
                st.x -= abs(floor((mod(u_resolution.x, u_total_size) - u_dot_size) * 0.5));
                st.y -= abs(floor((mod(u_resolution.y, u_total_size) - u_dot_size) * 0.5));

                float opacity = step(0.0, st.x) * step(0.0, st.y);

                vec2 st2 = vec2(int(st.x / u_total_size), int(st.y / u_total_size));

                float frequency = 5.0;
                float show_offset = random(st2);
                float rand = random(st2 * floor((u_time / frequency) + show_offset + frequency));
                opacity *= u_opacities[int(rand * 10.0)];
                opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.x / u_total_size));
                opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.y / u_total_size));

                vec3 color = u_colors[int(show_offset * 6.0)];

                float animation_speed_factor = 3.0;
                vec2 center_grid = u_resolution / 2.0 / u_total_size;
                float dist_from_center = distance(center_grid, st2);

                float timing_offset_intro = dist_from_center * 0.01 + (random(st2) * 0.15);

                float current_timing_offset = timing_offset_intro;
                opacity *= step(current_timing_offset, u_time * animation_speed_factor);
                opacity *= clamp((1.0 - step(current_timing_offset + 0.1, u_time * animation_speed_factor)) * 1.25, 1.0, 1.25);

                fragColor = vec4(color, opacity);
                fragColor.rgb *= fragColor.a;
            }
          `,
          uniforms,
          glslVersion: THREE.GLSL3,
          blending: THREE.CustomBlending,
          blendSrc: THREE.SrcAlphaFactor,
          blendDst: THREE.OneFactor,
          transparent: true,
        })

        geometry = new THREE.PlaneGeometry(2, 2)
        const mesh = new THREE.Mesh(geometry, material)
        scene.add(mesh)

        const startTime = performance.now()
        const activeRenderer = renderer
        const animate = () => {
          if (!active) {
            return
          }
          animationId = requestAnimationFrame(animate)
          uniforms.u_time.value = (performance.now() - startTime) / 1000.0
          activeRenderer.render(scene, camera)
        }
        animate()

        const handleResize = () => {
          if (!renderer) {
            return
          }
          const nextBounds = getBounds()
          renderer.setSize(nextBounds.width, nextBounds.height)
          uniforms.u_resolution.value.set(nextBounds.width * 2, nextBounds.height * 2)
        }

        window.addEventListener('resize', handleResize)
        detachResize = () => window.removeEventListener('resize', handleResize)
      })
      .catch(() => undefined)

    return () => {
      active = false
      detachResize?.()
      if (animationId) {
        cancelAnimationFrame(animationId)
      }
      renderer?.dispose()
      geometry?.dispose()
      material?.dispose()
    }
  }, [])

  const loginMutation = useMutation({
    mutationFn: apiClient.auth.login,
    onSuccess: (response) => {
      queryClient.setQueryData(['auth', 'me'], response.user)
      const destination = resolvePostAuthNavigation(response.user, location.state)
      useAuthStore.getState().setSessionUser(response.user)
      void navigate(destination.to, { replace: true, state: destination.state })
    },
    onError: (err) => {
      if (isApiClientError(err)) {
        if (err.isValidationError()) {
          setFieldErrors({
            email: err.fieldErrors.email,
            password: err.fieldErrors.password,
          })
          setFormError(err.message)
          return
        }
        if (err.code === 'rate_limited') {
          setFormError(
            err.message || 'Terlalu banyak percobaan login. Silakan coba lagi beberapa saat.',
          )
          return
        }
        setFormError(err.message || 'Email atau password salah.')
        return
      }
      setFormError('Terjadi kesalahan tak terduga saat mencoba masuk.')
    },
  })

  const registerMutation = useMutation({
    mutationFn: apiClient.auth.register,
    onSuccess: (response) => {
      queryClient.setQueryData(['auth', 'me'], response.user)
      const destination = resolvePostAuthNavigation(response.user, location.state)
      useAuthStore.getState().setSessionUser(response.user)
      void navigate(destination.to, { replace: true, state: destination.state })
    },
    onError: (err) => {
      if (isApiClientError(err)) {
        if (err.code === 'email_taken') {
          setFieldErrors({
            email: err.message || 'Email sudah terdaftar.',
          })
          setFormError(err.message || 'Email sudah digunakan oleh akun lain.')
          return
        }
        if (err.isValidationError()) {
          setFieldErrors({
            email: err.fieldErrors.email,
            password: err.fieldErrors.password,
          })
          setFormError(err.message)
          return
        }
        setFormError(err.message || 'Pendaftaran gagal diproses.')
        return
      }
      setFormError('Terjadi kesalahan tak terduga saat mendaftarkan akun.')
    },
  })

  const isPending = loginMutation.isPending || registerMutation.isPending

  if (sessionChecked && user && !isPending) {
    const destination = resolvePostAuthNavigation(user, location.state)
    return <Navigate to={destination.to} replace state={destination.state} />
  }

  function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    const trimmedEmail = email.trim()
    const nextErrors: AuthFieldErrors = {}

    if (!trimmedEmail) {
      nextErrors.email = 'Email wajib diisi.'
    } else if (!EMAIL_PATTERN.test(trimmedEmail)) {
      nextErrors.email = 'Format email tidak valid.'
    }

    if (!password) {
      nextErrors.password = 'Password wajib diisi.'
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors)
      return
    }

    setFieldErrors({})
    loginMutation.mutate({
      email: trimmedEmail,
      password,
    })
  }

  function handleRegisterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    const trimmedEmail = email.trim()
    const nextErrors: AuthFieldErrors = {}

    if (!trimmedEmail) {
      nextErrors.email = 'Email wajib diisi.'
    } else if (!EMAIL_PATTERN.test(trimmedEmail)) {
      nextErrors.email = 'Format email tidak valid.'
    }

    if (!password) {
      nextErrors.password = 'Password wajib diisi.'
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      nextErrors.password = `Password minimal ${MIN_PASSWORD_LENGTH} karakter.`
    }

    if (!confirmPassword) {
      nextErrors.confirmPassword = 'Konfirmasi password wajib diisi.'
    } else if (confirmPassword !== password) {
      nextErrors.confirmPassword = 'Konfirmasi password tidak cocok.'
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors)
      return
    }

    setFieldErrors({})
    registerMutation.mutate({
      email: trimmedEmail,
      password,
    })
  }

  function switchMode(targetLogin: boolean) {
    setFieldErrors({})
    setFormError(null)
    if (syncWithRouter) {
      void navigate(targetLogin ? '/login' : '/register', { state: location.state })
    } else {
      setLocalIsLogin(targetLogin)
    }
  }

  const BrandLogo = (
    <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-[#333] bg-[#111] text-white shadow-inner">
      <ShieldCheck className="h-5 w-5 text-zinc-100" aria-hidden="true" />
    </div>
  )

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex min-h-[calc(100vh-3.5rem)] w-full items-center justify-center overflow-hidden bg-black px-4 py-10 text-white',
        className,
      )}
    >
      {/* Subtle CSS dot fallback behind WebGL shader */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 opacity-25"
        style={{
          backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.35) 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      />

      {/* WebGL Animated Dot-Matrix Shader Canvas */}
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-0 h-full w-full" />

      {/* Radial Vignette */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-1"
        style={{
          background:
            'radial-gradient(circle at center, rgba(0, 0, 0, 0.78) 0%, rgba(0, 0, 0, 0.15) 100%)',
        }}
      />

      {/* Auth Modal Card */}
      <section className="relative z-2 flex w-full max-w-[420px] flex-col items-center rounded-xl border border-[#222] bg-[#121212] p-7 shadow-[0_10px_40px_rgba(0,0,0,0.85)] sm:p-8">
        {isLogin ? (
          <div className="flex w-full max-w-[360px] flex-col items-center text-center">
            {BrandLogo}
            <h1 className="text-[1.35rem] font-semibold tracking-tight text-white">
              Masuk ke Schematics NIC
            </h1>
            <p className="mt-1 mb-4 text-[0.85rem] leading-relaxed text-[#888]">
              Gunakan akun peserta, juri, atau superadmin Anda.
            </p>

            {formError && (
              <div
                role="alert"
                data-testid="login-error-alert"
                className="mb-3.5 flex w-full items-start gap-2 rounded-md border border-rose-500/40 bg-rose-950/50 px-3 py-2.5 text-left text-xs text-rose-200"
              >
                <AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0 text-rose-400"
                  aria-hidden="true"
                />
                <span>{formError}</span>
              </div>
            )}

            <form
              onSubmit={handleLoginSubmit}
              noValidate
              className="flex w-full flex-col gap-3 text-left"
            >
              <div>
                <label
                  htmlFor="login-email"
                  className="mb-1 block text-xs font-medium text-zinc-300"
                >
                  Email
                </label>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={Boolean(fieldErrors.email)}
                  placeholder="nama@mahasiswa.ac.id"
                  className="w-full rounded-md border border-[#333] bg-black px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-zinc-400 focus:outline-none"
                />
                {fieldErrors.email && (
                  <p className="mt-1 text-xs text-rose-400">{fieldErrors.email}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="mb-1 block text-xs font-medium text-zinc-300"
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id="login-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-invalid={Boolean(fieldErrors.password)}
                    placeholder="Masukkan password"
                    className="w-full rounded-md border border-[#333] bg-black px-3.5 py-2.5 pr-10 text-sm text-white placeholder:text-zinc-500 focus:border-zinc-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-zinc-500 hover:text-zinc-300"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {fieldErrors.password && (
                  <p className="mt-1 text-xs text-rose-400">{fieldErrors.password}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={loginMutation.isPending}
                className="mt-1 w-full cursor-pointer rounded-md bg-[#ededed] px-4 py-2.5 text-sm font-medium text-black transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loginMutation.isPending ? 'Memproses login...' : 'Masuk'}
              </button>
            </form>

            <div className="my-4 h-px w-full bg-[#222]" />

            <div className="text-sm text-[#888]">
              Belum punya akun peserta?{' '}
              {syncWithRouter ? (
                <Link
                  to="/register"
                  state={location.state}
                  className="font-medium text-white hover:underline"
                >
                  Daftar sekarang
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => switchMode(false)}
                  className="cursor-pointer font-medium text-white hover:underline"
                >
                  Daftar sekarang
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex w-full max-w-[360px] flex-col items-center text-center">
            {BrandLogo}
            <h1 className="text-[1.35rem] font-semibold tracking-tight text-white">
              Daftar Akun Peserta
            </h1>
            <p className="mt-1 mb-4 text-[0.85rem] leading-relaxed text-[#888]">
              Khusus mahasiswa peserta hackathon Schematics NIC.
            </p>

            {formError && (
              <div
                role="alert"
                data-testid="register-error-alert"
                className="mb-3.5 flex w-full items-start gap-2 rounded-md border border-rose-500/40 bg-rose-950/50 px-3 py-2.5 text-left text-xs text-rose-200"
              >
                <AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0 text-rose-400"
                  aria-hidden="true"
                />
                <span>{formError}</span>
              </div>
            )}

            <form
              onSubmit={handleRegisterSubmit}
              noValidate
              className="flex w-full flex-col gap-3 text-left"
            >
              <div>
                <label
                  htmlFor="register-email"
                  className="mb-1 block text-xs font-medium text-zinc-300"
                >
                  Email Mahasiswa
                </label>
                <input
                  id="register-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={Boolean(fieldErrors.email)}
                  placeholder="nama@mahasiswa.ac.id"
                  className="w-full rounded-md border border-[#333] bg-black px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-zinc-400 focus:outline-none"
                />
                {fieldErrors.email && (
                  <p className="mt-1 text-xs text-rose-400">{fieldErrors.email}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="register-password"
                  className="mb-1 block text-xs font-medium text-zinc-300"
                >
                  Password (minimal 10 karakter)
                </label>
                <div className="relative">
                  <input
                    id="register-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-invalid={Boolean(fieldErrors.password)}
                    placeholder="Minimal 10 karakter"
                    className="w-full rounded-md border border-[#333] bg-black px-3.5 py-2.5 pr-10 text-sm text-white placeholder:text-zinc-500 focus:border-zinc-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-zinc-500 hover:text-zinc-300"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {fieldErrors.password && (
                  <p className="mt-1 text-xs text-rose-400">{fieldErrors.password}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="register-confirm-password"
                  className="mb-1 block text-xs font-medium text-zinc-300"
                >
                  Konfirmasi Password
                </label>
                <input
                  id="register-confirm-password"
                  name="confirmPassword"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  aria-invalid={Boolean(fieldErrors.confirmPassword)}
                  placeholder="Ulangi password Anda"
                  className="w-full rounded-md border border-[#333] bg-black px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-zinc-400 focus:outline-none"
                />
                {fieldErrors.confirmPassword && (
                  <p className="mt-1 text-xs text-rose-400">{fieldErrors.confirmPassword}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={registerMutation.isPending}
                className="mt-1 w-full cursor-pointer rounded-md bg-[#ededed] px-4 py-2.5 text-sm font-medium text-black transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {registerMutation.isPending ? 'Mendaftarkan akun...' : 'Daftar & Masuk'}
              </button>
            </form>

            <div className="my-4 h-px w-full bg-[#222]" />

            <div className="text-sm text-[#888]">
              Sudah punya akun?{' '}
              {syncWithRouter ? (
                <Link to="/login" className="font-medium text-white hover:underline">
                  Masuk di sini
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => switchMode(true)}
                  className="cursor-pointer font-medium text-white hover:underline"
                >
                  Masuk di sini
                </button>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
