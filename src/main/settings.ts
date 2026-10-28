import { app } from 'electron'
import Store from 'electron-store'
import type { AppSettings } from '@shared/types'
import { DEFAULT_SETTINGS, isAccentId, isAudioQuality } from '@shared/settings'

const MAX_CSS_LENGTH = 100_000

let store: Store<AppSettings> | null = null

function getStore(): Store<AppSettings> {
  if (!store) {
    store = new Store<AppSettings>({
      name: 'settings',
      defaults: DEFAULT_SETTINGS
    })
  }

  return store
}

function sanitize(stored: Partial<AppSettings>): AppSettings {
  return {
    audioQuality: isAudioQuality(stored.audioQuality)
      ? stored.audioQuality
      : DEFAULT_SETTINGS.audioQuality,
    accent: isAccentId(stored.accent) ? stored.accent : DEFAULT_SETTINGS.accent,
    customCss:
      typeof stored.customCss === 'string'
        ? stored.customCss.slice(0, MAX_CSS_LENGTH)
        : DEFAULT_SETTINGS.customCss,
    closeToTray:
      typeof stored.closeToTray === 'boolean' ? stored.closeToTray : DEFAULT_SETTINGS.closeToTray,
    launchAtStartup:
      typeof stored.launchAtStartup === 'boolean'
        ? stored.launchAtStartup
        : DEFAULT_SETTINGS.launchAtStartup,
    autoUpdate:
      typeof stored.autoUpdate === 'boolean' ? stored.autoUpdate : DEFAULT_SETTINGS.autoUpdate
  }
}

export function getSettings(): AppSettings {
  return sanitize(getStore().store)
}

function applyLaunchAtStartup(enabled: boolean): void {
  // Registering the Electron binary as a startup item during development
  // would point at node_modules on every login.
  if (!app.isPackaged) return

  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: ['--hidden']
  })
}

export function updateSettings(patch: unknown): AppSettings {
  if (!patch || typeof patch !== 'object') throw new Error('Invalid settings update')

  const input = patch as Record<string, unknown>
  const next = getSettings()

  if ('audioQuality' in input) {
    if (!isAudioQuality(input.audioQuality)) throw new Error('Invalid audio quality')
    next.audioQuality = input.audioQuality
  }

  if ('accent' in input) {
    if (!isAccentId(input.accent)) throw new Error('Invalid accent')
    next.accent = input.accent
  }

  if ('customCss' in input) {
    if (typeof input.customCss !== 'string') throw new Error('Invalid custom CSS')
    next.customCss = input.customCss.slice(0, MAX_CSS_LENGTH)
  }

  for (const key of ['closeToTray', 'launchAtStartup', 'autoUpdate'] as const) {
    if (!(key in input)) continue
    if (typeof input[key] !== 'boolean') throw new Error(`Invalid ${key} setting`)
    next[key] = input[key] as boolean
  }

  getStore().store = next

  if ('launchAtStartup' in input) applyLaunchAtStartup(next.launchAtStartup)

  return next
}

export function resetSettings(): AppSettings {
  getStore().store = DEFAULT_SETTINGS
  applyLaunchAtStartup(DEFAULT_SETTINGS.launchAtStartup)
  return getSettings()
}

export function applyStoredSettings(): void {
  applyLaunchAtStartup(getSettings().launchAtStartup)
}

export function startsHidden(): boolean {
  return process.argv.includes('--hidden')
}
