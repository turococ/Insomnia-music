import { app } from 'electron'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const LEGACY_APP_NAME = 'ToneGlass'
const CURRENT_APP_NAME = 'Insomnia'
const MIGRATION_MARKER = '.migrated-from-toneglass'

function copyFile(source: string, target: string): boolean {
  if (!existsSync(source)) return false
  if (!existsSync(target)) {
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(source, target)
  }
  return true
}

function copyDirectory(source: string, target: string): boolean {
  if (!existsSync(source)) return false
  // Merge instead of failing when a previous attempt was interrupted. Files
  // that already exist in the new profile are left untouched.
  cpSync(source, target, { recursive: true, force: false, errorOnExist: false })
  return true
}

/**
 * Copies the previous ToneGlass profile into the Insomnia profile once.
 *
 * This runs before electron-store is created and before any Electron session
 * is opened, so settings, the auth partition and localStorage can be moved
 * without either app touching the files mid-copy.
 */
export function migrateLegacyProfile(): void {
  try {
    runMigration()
  } catch (error) {
    // A failed import must never stop the app from starting. The marker is not
    // written, so the next launch retries the merge.
    console.error('[migrate] could not import ToneGlass profile', error)
  }
}

function runMigration(): void {
  const appData = app.getPath('appData')
  const legacyRoot = join(appData, LEGACY_APP_NAME)
  const currentRoot = join(appData, CURRENT_APP_NAME)
  const marker = join(currentRoot, MIGRATION_MARKER)

  if (existsSync(marker)) return
  if (!existsSync(legacyRoot)) return

  mkdirSync(currentRoot, { recursive: true })

  // Never overwrite a profile that already has settings. This can happen if a
  // development build created the new profile before the migration shipped.
  if (existsSync(join(currentRoot, 'settings.json'))) {
    writeFileSync(marker, `skipped ${new Date().toISOString()}\n`)
    return
  }

  const copied: string[] = []

  if (copyFile(join(legacyRoot, 'settings.json'), join(currentRoot, 'settings.json'))) {
    const settingsPath = join(currentRoot, 'settings.json')
    try {
      const stored = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>
      if (stored.accent === 'lime') {
        stored.accent = 'violet'
        writeFileSync(settingsPath, `${JSON.stringify(stored, null, '\t')}\n`)
      }
    } catch {
      // A malformed settings file is sanitised by electron-store on first read.
    }
    copied.push('settings')
  }

  if (
    copyDirectory(
      join(legacyRoot, 'Partitions', 'toneglass-auth'),
      join(currentRoot, 'Partitions', 'insomnia-auth')
    )
  ) {
    copied.push('auth session')
  }

  if (copyDirectory(join(legacyRoot, 'Local Storage'), join(currentRoot, 'Local Storage'))) {
    copied.push('local storage')
  }

  writeFileSync(marker, `${new Date().toISOString()} ${copied.join(', ') || 'empty'}\n`)
  console.log(`[migrate] ToneGlass profile imported: ${copied.join(', ') || 'nothing to copy'}`)
}
