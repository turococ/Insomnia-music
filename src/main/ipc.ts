import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { CollectionKind, SearchFilter } from '@shared/types'
import { mediaProxy } from './media-proxy'
import { musicService } from './yt/music'

const COLLECTION_KINDS: CollectionKind[] = ['album', 'playlist', 'artist']
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

  ipcMain.handle(IPC.playbackResolve, async (_event, videoId: unknown) => {
    const id = requireString(videoId, 'video id', 200)
    const source = await musicService.resolve(id)
    return {
      ...source,
      url: await mediaProxy.urlFor(id)
    }
  })
}
