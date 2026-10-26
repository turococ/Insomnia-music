import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { accentById, accents } from './accents'
import { SettingsContext } from './context'

const ACCENT_CACHE_KEY = 'toneglass:accent'
const CSS_CACHE_KEY = 'toneglass:custom-css'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function cachedSettings(): AppSettings {
  const cachedAccent = localStorage.getItem(ACCENT_CACHE_KEY)
  return {
    ...DEFAULT_SETTINGS,
    accent: accents.some((accent) => accent.id === cachedAccent)
      ? (cachedAccent as AppSettings['accent'])
      : DEFAULT_SETTINGS.accent,
    customCss: localStorage.getItem(CSS_CACHE_KEY) ?? ''
  }
}

export function SettingsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings>(cachedSettings)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const revision = useRef(0)

  useEffect(() => {
    let cancelled = false

    window.api.settings
      .get()
      .then((next) => {
        if (cancelled) return
        setSettings(next)
        setIsLoading(false)
      })
      .catch((cause) => {
        if (cancelled) return
        setError(errorMessage(cause))
        setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useLayoutEffect(() => {
    const accent = accentById(settings.accent)
    const root = document.documentElement
    root.style.setProperty('--color-accent', accent.color)
    root.style.setProperty('--color-accent-soft', accent.soft)
    localStorage.setItem(ACCENT_CACHE_KEY, accent.id)
  }, [settings.accent])

  useLayoutEffect(() => {
    let style = document.getElementById('toneglass-user-css') as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = 'toneglass-user-css'
      document.head.appendChild(style)
    }
    style.textContent = settings.customCss
    localStorage.setItem(CSS_CACHE_KEY, settings.customCss)
  }, [settings.customCss])

  const update = useCallback(async (patch: Partial<AppSettings>) => {
    const id = ++revision.current
    setSettings((current) => ({ ...current, ...patch }))
    setError(null)

    try {
      const next = await window.api.settings.update(patch)
      if (id === revision.current) setSettings(next)
    } catch (cause) {
      if (id !== revision.current) return
      setError(errorMessage(cause))
      try {
        setSettings(await window.api.settings.get())
      } catch {
        // Keep the optimistic values if the settings file is unavailable.
      }
    }
  }, [])

  const reset = useCallback(async () => {
    const id = ++revision.current
    setError(null)

    try {
      const next = await window.api.settings.reset()
      if (id === revision.current) setSettings(next)
    } catch (cause) {
      if (id === revision.current) setError(errorMessage(cause))
    }
  }, [])

  const value = useMemo(
    () => ({ settings, isLoading, error, update, reset }),
    [settings, isLoading, error, update, reset]
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}
