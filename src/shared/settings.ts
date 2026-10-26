import type { AccentId, AppSettings, AudioQuality } from './types'

export const ACCENT_IDS = ['lime', 'violet', 'cyan', 'coral', 'amber'] as const
export const AUDIO_QUALITIES = ['best', 'data-saver'] as const

export const DEFAULT_SETTINGS: AppSettings = {
  audioQuality: 'best',
  accent: 'lime',
  customCss: '',
  closeToTray: false,
  launchAtStartup: false,
  autoUpdate: true
}

export function isAccentId(value: unknown): value is AccentId {
  return typeof value === 'string' && (ACCENT_IDS as readonly string[]).includes(value)
}

export function isAudioQuality(value: unknown): value is AudioQuality {
  return typeof value === 'string' && (AUDIO_QUALITIES as readonly string[]).includes(value)
}
