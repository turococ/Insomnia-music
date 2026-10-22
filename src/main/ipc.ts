import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { CollectionKind } from '@shared/types'
import { mediaProxy } from './media-proxy'
import { musicService } from './yt/music'

const COLLECTION_KINDS: CollectionKind[] = ['album', 'playlist', 'artist']

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

  ipcMain.handle(IPC.musicSearch, (_event, query: unknown) =>
    musicService.search(requireString(query, 'query', 200))
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
