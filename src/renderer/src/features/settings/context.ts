import { createContext, useContext } from 'react'
import type { AppSettings } from '@shared/types'

export interface SettingsContextValue {
  settings: AppSettings
  isLoading: boolean
  error: string | null
  update: (patch: Partial<AppSettings>) => Promise<void>
  reset: () => Promise<void>
}

export const SettingsContext = createContext<SettingsContextValue | null>(null)

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext)
  if (!value) throw new Error('useSettings must be used inside SettingsProvider')
  return value
}
