const LEGACY_KEYS: Record<string, string> = {
  'toneglass:accent': 'insomnia:accent',
  'toneglass:custom-css': 'insomnia:custom-css',
  'toneglass:volume': 'insomnia:volume',
  'toneglass:player': 'insomnia:player'
}

/**
 * Moves renderer preferences from the old ToneGlass keys to Insomnia keys.
 *
 * This module is imported before the player store so the persisted queue and
 * volume are already under their new names when zustand hydrates.
 */
function migrateLegacyStorage(): void {
  try {
    for (const [legacyKey, currentKey] of Object.entries(LEGACY_KEYS)) {
      const value = localStorage.getItem(legacyKey)
      if (value === null) continue

      if (localStorage.getItem(currentKey) === null) {
        localStorage.setItem(
          currentKey,
          legacyKey === 'toneglass:accent' && value === 'lime' ? 'violet' : value
        )
      }

      localStorage.removeItem(legacyKey)
    }
  } catch {
    // Storage can be unavailable in restricted renderer contexts.
  }
}

migrateLegacyStorage()
