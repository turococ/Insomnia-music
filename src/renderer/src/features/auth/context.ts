import { createContext, useContext } from 'react'
import type { AuthStatus } from '@shared/types'

export interface AuthContextValue {
  status?: AuthStatus
  isLoading: boolean
  isPending: boolean
  error: string | null
  signIn: () => Promise<void>
  cancelSignIn: () => Promise<void>
  signOut: () => Promise<void>
  clearError: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
