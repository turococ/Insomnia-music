import { app, shell, BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { IPC } from '@shared/ipc'
import type { PlayerCommand } from '@shared/types'
import icon from '../../resources/icon.png?asset'
import { registerIpc } from './ipc'
import { applyStoredSettings, getSettings, startsHidden } from './settings'
import { checkForUpdates, initUpdater } from './updater'
import { musicService } from './yt/music'

app.setName('ToneGlass')

if (is.dev && process.env['TONEGLASS_DEBUG_PORT']) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env['TONEGLASS_DEBUG_PORT'])
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

function showWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }

  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function sendPlayerCommand(command: PlayerCommand): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(IPC.playerCommand, command)
}

function createTray(): void {
  if (tray) return

  const image = nativeImage.createFromPath(icon)
  tray = new Tray(image.isEmpty() ? icon : image.resize({ width: 16, height: 16 }))
  tray.setToolTip('ToneGlass')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show ToneGlass', click: showWindow },
      { type: 'separator' },
      { label: 'Play / Pause', click: () => sendPlayerCommand('toggle') },
      { label: 'Next track', click: () => sendPlayerCommand('next') },
      { label: 'Previous track', click: () => sendPlayerCommand('previous') },
      { type: 'separator' },
      {
        label: 'Quit ToneGlass',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )

  tray.on('click', showWindow)
  tray.on('double-click', showWindow)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#09090b',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (!startsHidden()) mainWindow?.show()
  })

  mainWindow.on('close', (event) => {
    if (quitting || !getSettings().closeToTray) return
    event.preventDefault()
    mainWindow?.hide()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showWindow()
  })

  app.on('before-quit', () => {
    quitting = true
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.toneglass.app')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    applyStoredSettings()
    initUpdater()
    registerIpc()
    createTray()

    // Warm up the InnerTube session in the background so the first search is fast.
    void musicService.init().catch((error) => {
      console.error('[music] failed to initialise InnerTube', error)
    })

    createWindow()

    if (getSettings().autoUpdate && app.isPackaged) {
      setTimeout(() => void checkForUpdates(), 15_000)
    }

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else showWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
