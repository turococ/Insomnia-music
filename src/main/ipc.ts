import { app, BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AuthStatus,
  CollectionKind,
  LibraryListKind,
  LyricsQuery,
  SearchFilter,
  SignInOutcome,
  SignInResult
} from '@shared/types'
import { authService } from './auth'
import { mediaProxy } from './media-proxy'
import { getSettings, resetSettings, updateSettings } from './settings'
import { checkForUpdates, downloadUpdate, getUpdateState, installUpdate } from './updater'
import { musicService } from './yt/music'

const COLLECTION_KINDS: CollectionKind[] = ['album', 'playlist', 'artist']
const LIBRARY_LIST_KINDS: LibraryListKind[] = ['playlists', 'albums', 'artists']
const SEARCH_FILTERS: SearchFilter[] = ['all', 'song', 'album', 'artist', 'playlist', 'video']

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

async function authStatus(strict = false): Promise<AuthStatus> {
  if (!(await authService.isAuthenticated())) return { authenticated: false }

  try {
    if (!(await musicService.isSignedIn())) return { authenticated: false }
    const account = await musicService.account()
    if (!account && strict) return { authenticated: false }
    return { authenticated: true, account: account ?? undefined }
  } catch (error) {
    console.warn(
      '[auth] could not validate the saved session:',
      error instanceof Error ? error.message : error
    )
    if (strict) return { authenticated: false }
    // The cookies are still present. Keep the account connected and let the
    // library surface any network error instead of silently signing out.
    return { authenticated: true }
  }
}

async function finishSignIn(outcome: SignInOutcome): Promise<SignInResult> {
  // Even a cancelled attempt may have cleared an invalid saved session.
  await musicService.reloadSession()
  // A completed sign-in must produce a usable account, not merely a cookie
  // string. This catches a session YouTube Music rejected.
  const status = await authStatus(true)

  if (outcome === 'signed-in' && !status.authenticated) {
    throw new Error('YouTube Music did not accept the sign-in session. Please try again.')
  }

  return { status, outcome }
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

  ipcMain.handle(IPC.musicLyrics, (_event, query: unknown) => {
    if (!query || typeof query !== 'object') throw new Error('Invalid lyrics query')

    const value = query as Record<string, unknown>
    const title = requireString(value.title, 'track title', 300)
    const artist =
      typeof value.artist === 'string' && value.artist.trim()
        ? requireString(value.artist, 'artist name', 300)
        : undefined
    const album =
      typeof value.album === 'string' && value.album.trim()
        ? requireString(value.album, 'album name', 300)
        : undefined
    const duration =
      typeof value.duration === 'number' && Number.isFinite(value.duration) && value.duration > 0
        ? value.duration
        : undefined

    const lyricsQuery: LyricsQuery = {
      id: requireString(value.id, 'track id', 200),
      title,
      artist,
      album,
      duration
    }
    return musicService.lyrics(lyricsQuery)
  })

  ipcMain.handle(IPC.musicUpNext, (_event, id: unknown, automix: unknown) =>
    musicService.upNext(requireString(id, 'track id', 200), automix === true)
  )

  ipcMain.handle(IPC.musicLikeStatus, (_event, id: unknown) =>
    musicService.likeStatus(requireString(id, 'track id', 200))
  )

  ipcMain.handle(IPC.musicSetLiked, (_event, id: unknown, liked: unknown) =>
    musicService.setLiked(requireString(id, 'track id', 200), liked === true)
  )

  ipcMain.handle(
    IPC.musicSetCollectionSaved,
    (_event, kind: unknown, id: unknown, saved: unknown) => {
      const collectionKind = requireString(kind, 'collection kind', 20)
      if (!COLLECTION_KINDS.includes(collectionKind as CollectionKind)) {
        throw new Error('Invalid collection kind')
      }
      return musicService.setCollectionSaved(
        collectionKind as CollectionKind,
        requireString(id, 'collection id', 200),
        saved === true
      )
    }
  )

  ipcMain.handle(IPC.musicPlaylists, (_event, more: unknown) =>
    musicService.playlists(more === true)
  )

  ipcMain.handle(IPC.musicAddToPlaylist, (_event, playlistId: unknown, videoId: unknown) =>
    musicService.addToPlaylist(
      requireString(playlistId, 'playlist id', 200),
      requireString(videoId, 'video id', 200)
    )
  )

  ipcMain.handle(IPC.musicCreatePlaylist, (_event, title: unknown, videoId: unknown) =>
    musicService.createPlaylist(
      requireString(title, 'playlist title', 150),
      requireString(videoId, 'video id', 200)
    )
  )

  ipcMain.handle(IPC.libraryList, (_event, kind: unknown) =>
    musicService.libraryList(requireLibraryKind(kind))
  )

  ipcMain.handle(IPC.libraryMore, (_event, kind: unknown) =>
    musicService.libraryMore(requireLibraryKind(kind))
  )

  ipcMain.handle(IPC.authStatus, () => authStatus())

  ipcMain.handle(IPC.authCancel, () => authService.cancelSignIn())

  ipcMain.handle(IPC.authSignIn, async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const outcome = await authService.signIn(parent)
    return finishSignIn(outcome)
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

  ipcMain.handle(IPC.settingsGet, () => getSettings())

  ipcMain.handle(IPC.settingsUpdate, (_event, patch: unknown) => {
    const previous = getSettings()
    const next = updateSettings(patch)
    if (next.audioQuality !== previous.audioQuality) musicService.clearSourceCache()
    return next
  })

  ipcMain.handle(IPC.settingsReset, () => {
    const previous = getSettings()
    const next = resetSettings()
    if (next.audioQuality !== previous.audioQuality) musicService.clearSourceCache()
    return next
  })

  ipcMain.handle(IPC.appVersion, () => app.getVersion())

  ipcMain.on(IPC.windowMinimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle(IPC.windowToggleMaximize, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false

    const next = !win.isMaximized()
    if (next) win.maximize()
    else win.unmaximize()

    return next
  })

  ipcMain.on(IPC.windowClose, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle(
    IPC.windowIsMaximized,
    (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  )

  ipcMain.handle(IPC.updatesStatus, () => getUpdateState())
  ipcMain.handle(IPC.updatesCheck, () => checkForUpdates())
  ipcMain.handle(IPC.updatesDownload, () => downloadUpdate())
  ipcMain.handle(IPC.updatesInstall, () => installUpdate())
}
