import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IPC } from '@shared/ipc'
import type { UpdateState } from '@shared/types'

let state: UpdateState = { status: 'idle' }
let initialized = false

function broadcast(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC.updatesChanged, state)
  }
}

function setState(next: UpdateState): void {
  state = next
  broadcast()
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function getUpdateState(): UpdateState {
  return state
}

export function initUpdater(): void {
  if (initialized) return
  initialized = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => setState({ status: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    setState({ status: 'available', version: info.version })
  )
  autoUpdater.on('update-not-available', (info) =>
    setState({ status: 'up-to-date', version: info.version })
  )
  autoUpdater.on('update-downloaded', (info) =>
    setState({ status: 'downloaded', version: info.version })
  )
  autoUpdater.on('download-progress', (progress) =>
    setState({ status: 'downloading', percent: Math.round(progress.percent) })
  )
  autoUpdater.on('error', (error) => setState({ status: 'error', message: message(error) }))
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged) {
    setState({
      status: 'unsupported',
      message: 'Automatic updates are available in packaged builds only.'
    })
    return state
  }

  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    setState({ status: 'error', message: message(error) })
  }

  return state
}

export async function downloadUpdate(): Promise<UpdateState> {
  if (!app.isPackaged) {
    setState({
      status: 'unsupported',
      message: 'Automatic updates are available in packaged builds only.'
    })
    return state
  }

  if (state.status !== 'available' && state.status !== 'error') return state

  setState({ status: 'downloading', percent: 0 })
  try {
    await autoUpdater.downloadUpdate()
  } catch (error) {
    setState({ status: 'error', message: message(error) })
  }

  return state
}

export function installUpdate(): void {
  if (state.status !== 'downloaded') return
  autoUpdater.quitAndInstall()
}
