import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, UserPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { apiClient, isApiClientError } from '../../api'
import { useAuthStore } from '../../stores/authStore'
import { resolvePostAuthNavigation } from './authNavigation'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 10

interface RegisterFieldErrors {
  email?: string
  password?: string
  confirmPassword?: string
}

export function RegisterPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()

  const sessionChecked = useAuthStore((state) => state.sessionChecked)
  const user = useAuthStore((state) => state.user)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<RegisterFieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

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

  if (sessionChecked && user && !registerMutation.isPending) {
    const destination = resolvePostAuthNavigation(user, location.state)
    return <Navigate to={destination.to} replace state={destination.state} />
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    const trimmedEmail = email.trim()
    const nextErrors: RegisterFieldErrors = {}

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

  return (
    <div className="mx-auto max-w-md">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs sm:p-8">
        <div className="flex items-center gap-2.5">
          <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600">
            <UserPlus className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Daftar Akun Peserta</h1>
            <p className="text-xs text-slate-500">
              Khusus mahasiswa peserta hackathon Schematics NIC
            </p>
          </div>
        </div>

        {formError && (
          <div
            role="alert"
            data-testid="register-error-alert"
            className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
          <div>
            <label htmlFor="register-email" className="block text-sm font-medium text-slate-700">
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
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
            />
            {fieldErrors.email && (
              <p className="mt-1 text-xs text-rose-600">{fieldErrors.email}</p>
            )}
          </div>

          <div>
            <label htmlFor="register-password" className="block text-sm font-medium text-slate-700">
              Password (minimal 10 karakter)
            </label>
            <input
              id="register-password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(fieldErrors.password)}
              placeholder="Minimal 10 karakter"
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
            />
            {fieldErrors.password && (
              <p className="mt-1 text-xs text-rose-600">{fieldErrors.password}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="register-confirm-password"
              className="block text-sm font-medium text-slate-700"
            >
              Konfirmasi Password
            </label>
            <input
              id="register-confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              aria-invalid={Boolean(fieldErrors.confirmPassword)}
              placeholder="Ulangi password Anda"
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
            />
            {fieldErrors.confirmPassword && (
              <p className="mt-1 text-xs text-rose-600">{fieldErrors.confirmPassword}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={registerMutation.isPending}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-2xs transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {registerMutation.isPending ? 'Mendaftarkan akun...' : 'Daftar & Masuk'}
          </button>
        </form>

        <p className="mt-5 border-t border-slate-100 pt-4 text-center text-sm text-slate-600">
          Sudah punya akun?{' '}
          <Link to="/login" className="font-semibold text-indigo-600 hover:text-indigo-700">
            Masuk di sini
          </Link>
        </p>
      </section>
    </div>
  )
}
