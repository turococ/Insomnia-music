import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AuthMode,
  AuthStatus,
  CollectionKind,
  LibraryListKind,
  SearchFilter
} from '@shared/types'
import { authService } from './auth'
import { mediaProxy } from './media-proxy'
import { musicService } from './yt/music'

const COLLECTION_KINDS: CollectionKind[] = ['album', 'playlist', 'artist']
const LIBRARY_LIST_KINDS: LibraryListKind[] = ['playlists', 'albums', 'artists']
const SEARCH_FILTERS: SearchFilter[] = ['all', 'song', 'album', 'artist', 'playlist', 'video']
const AUTH_MODES: AuthMode[] = ['browser', 'embedded']

function requireSearchFilter(value: unknown): SearchFilter {
  if (value === undefined || value === null) return 'all'

  const filter = requireString(value, 'search filter', 20)
  if (!SEARCH_FILTERS.includes(filter as SearchFilter)) {
    throw new Error('Invalid search filter')
  }

  return filter as SearchFilter
}

function requireString(value: unknown, field: string, maxLength = 512): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid ${field}`)
  }
  if (value.length > maxLength) {
    throw new Error(`${field} is too long`)
  }
  return value.trim()
}

function requireLibraryKind(value: unknown): LibraryListKind {
  const kind = requireString(value, 'library list kind', 20)
  if (!LIBRARY_LIST_KINDS.includes(kind as LibraryListKind)) {
    throw new Error('Invalid library list kind')
  }
  return kind as LibraryListKind
}

function requireAuthMode(value: unknown): AuthMode {
  if (value === undefined || value === null) return 'browser'

  const mode = requireString(value, 'sign-in mode', 20)
  if (!AUTH_MODES.includes(mode as AuthMode)) {
    throw new Error('Invalid sign-in mode')
  }

  return mode as AuthMode
}

async function authStatus(): Promise<AuthStatus> {
  if (!(await authService.isAuthenticated())) return { authenticated: false }

  try {
    if (!(await musicService.isSignedIn())) return { authenticated: false }
    const account = await musicService.account()
    return { authenticated: true, account: account ?? undefined }
  } catch (error) {
    console.warn(
      '[auth] could not validate the saved session:',
      error instanceof Error ? error.message : error
    )
    // The cookies are still present. Keep the account connected and let the
    // library surface any network error instead of silently signing out.
    return { authenticated: true }
  }
}

export function registerIpc(): void {
  ipcMain.handle(IPC.musicHome, (_event, filter: unknown) => {
    const selected =
      typeof filter === 'string' && filter.trim() ? requireString(filter, 'filter', 50) : undefined
    return musicService.home(selected)
  })

  ipcMain.handle(IPC.musicSearch, (_event, query: unknown, filter: unknown) =>
    musicService.search(requireString(query, 'query', 200), requireSearchFilter(filter))
  )

  ipcMain.handle(IPC.musicSearchMore, (_event, query: unknown, filter: unknown) =>
    musicService.searchMore(requireString(query, 'query', 200), requireSearchFilter(filter))
  )

  ipcMain.handle(IPC.musicSearchTopAction, (_event, actionId: unknown) =>
    musicService.topResultAction(requireString(actionId, 'top result action', 64))
  )

  ipcMain.handle(IPC.musicCollection, (_event, kind: unknown, id: unknown) => {
    const collectionKind = requireString(kind, 'collection kind', 20)
    if (!COLLECTION_KINDS.includes(collectionKind as CollectionKind)) {
      throw new Error('Invalid collection kind')
    }
    return musicService.collection(
      collectionKind as CollectionKind,
      requireString(id, 'collection id', 200)
    )
  })

  ipcMain.handle(IPC.musicCollectionMore, (_event, kind: unknown, id: unknown) => {
    const collectionKind = requireString(kind, 'collection kind', 20)
    if (!COLLECTION_KINDS.includes(collectionKind as CollectionKind)) {
      throw new Error('Invalid collection kind')
    }
    return musicService.collectionMore(
      collectionKind as CollectionKind,
      requireString(id, 'collection id', 200)
    )
  })

  ipcMain.handle(IPC.musicAlbumYears, (_event, ids: unknown) => {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 300) {
      throw new Error('Invalid album ids')
    }

    return musicService.albumYears(
      ids.map((id, index) => requireString(id, `album id ${index + 1}`, 200))
    )
  })

  ipcMain.handle(IPC.musicTrack, (_event, id: unknown) =>
    musicService.track(requireString(id, 'track id', 200))
  )

  ipcMain.handle(IPC.musicLyrics, (_event, id: unknown) =>
    musicService.lyrics(requireString(id, 'track id', 200))
  )

  ipcMain.handle(IPC.libraryList, (_event, kind: unknown) =>
    musicService.libraryList(requireLibraryKind(kind))
  )

  ipcMain.handle(IPC.libraryMore, (_event, kind: unknown) =>
    musicService.libraryMore(requireLibraryKind(kind))
  )

  ipcMain.handle(IPC.authStatus, () => authStatus())

  ipcMain.handle(IPC.authEnvironment, () => authService.environment())

  ipcMain.handle(IPC.authSignIn, async (event, mode: unknown) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const signedIn = await authService.signIn(requireAuthMode(mode), parent)
    // Even a cancelled attempt may have cleared an invalid saved session.
    await musicService.reloadSession()
    const status = await authStatus()

    // The browser flow found cookies, but YouTube Music rejected them. Surface
    // that instead of silently leaving the user signed out.
    if (signedIn && !status.authenticated) {
      throw new Error('YouTube Music did not accept the browser session. Please try again.')
    }

    return status
  })

  ipcMain.handle(IPC.authSignOut, async () => {
    await authService.signOut()
    await musicService.reloadSession()
    return { authenticated: false } satisfies AuthStatus
  })

  ipcMain.handle(IPC.playbackResolve, async (_event, videoId: unknown) => {
    const id = requireString(videoId, 'video id', 200)
    const source = await musicService.resolve(id)
    return {
      ...source,
      url: await mediaProxy.urlFor(id)
    }
  })
}
