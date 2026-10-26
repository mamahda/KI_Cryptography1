import { create } from 'zustand'

export type UserRole = 'peserta' | 'juri' | 'superadmin'
export type VerificationStatus = 'belum_lengkap' | 'menunggu' | 'terverifikasi' | 'ditolak'

export interface SessionUserSummary {
  id: string
  email: string
  role: UserRole
  full_name: string | null
  verification_status: VerificationStatus | null
}

interface AuthUiState {
  sessionChecked: boolean
  user: SessionUserSummary | null
  setSessionUser: (user: SessionUserSummary | null) => void
  markSessionChecked: () => void
  clearSession: () => void
}

export const useAuthStore = create<AuthUiState>((set) => ({
  sessionChecked: false,
  user: null,
  setSessionUser: (user) => set({ user, sessionChecked: true }),
  markSessionChecked: () => set({ sessionChecked: true }),
  clearSession: () => set({ user: null, sessionChecked: true }),
}))
