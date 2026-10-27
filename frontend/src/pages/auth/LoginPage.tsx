import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Eye, EyeOff, LogIn } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { apiClient, isApiClientError } from '../../api'
import { useAuthStore } from '../../stores/authStore'
import { resolvePostAuthNavigation } from './authNavigation'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function LoginPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()

  const sessionChecked = useAuthStore((state) => state.sessionChecked)
  const user = useAuthStore((state) => state.user)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)

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

  if (sessionChecked && user && !loginMutation.isPending) {
    const destination = resolvePostAuthNavigation(user, location.state)
    return <Navigate to={destination.to} replace state={destination.state} />
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    const trimmedEmail = email.trim()
    const nextFieldErrors: { email?: string; password?: string } = {}

    if (!trimmedEmail) {
      nextFieldErrors.email = 'Email wajib diisi.'
    } else if (!EMAIL_PATTERN.test(trimmedEmail)) {
      nextFieldErrors.email = 'Format email tidak valid.'
    }

    if (!password) {
      nextFieldErrors.password = 'Password wajib diisi.'
    }

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors)
      return
    }

    setFieldErrors({})
    loginMutation.mutate({
      email: trimmedEmail,
      password,
    })
  }

  return (
    <div className="mx-auto max-w-md">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs sm:p-8">
        <div className="flex items-center gap-2.5">
          <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600">
            <LogIn className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Masuk ke Schematics NIC</h1>
            <p className="text-xs text-slate-500">
              Gunakan akun peserta, juri, atau superadmin Anda
            </p>
          </div>
        </div>

        {formError && (
          <div
            role="alert"
            data-testid="login-error-alert"
            className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-slate-700">
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
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
            />
            {fieldErrors.email && (
              <p className="mt-1 text-xs text-rose-600">{fieldErrors.email}</p>
            )}
          </div>

          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-slate-700">
              Password
            </label>
            <div className="relative mt-1">
              <input
                id="login-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={Boolean(fieldErrors.password)}
                placeholder="Masukkan password"
                className="block w-full rounded-lg border border-slate-300 px-3 py-2 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {fieldErrors.password && (
              <p className="mt-1 text-xs text-rose-600">{fieldErrors.password}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={loginMutation.isPending}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-2xs transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loginMutation.isPending ? 'Memproses login...' : 'Masuk'}
          </button>
        </form>

        <p className="mt-5 border-t border-slate-100 pt-4 text-center text-sm text-slate-600">
          Belum punya akun peserta?{' '}
          <Link
            to="/register"
            state={location.state}
            className="font-semibold text-indigo-600 hover:text-indigo-700"
          >
            Daftar sekarang
          </Link>
        </p>
      </section>
    </div>
  )
}
