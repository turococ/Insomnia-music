import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC } from '../shared/ipc'
import type { AppApi } from '../shared/types'

const api: AppApi = {
  music: {
    home: (filter) => ipcRenderer.invoke(IPC.musicHome, filter),
    search: (query, filter) => ipcRenderer.invoke(IPC.musicSearch, query, filter),
    searchMore: (query, filter) => ipcRenderer.invoke(IPC.musicSearchMore, query, filter),
    topResultAction: (actionId) => ipcRenderer.invoke(IPC.musicSearchTopAction, actionId),
    collection: (kind, id) => ipcRenderer.invoke(IPC.musicCollection, kind, id),
    collectionMore: (kind, id) => ipcRenderer.invoke(IPC.musicCollectionMore, kind, id),
    albumYears: (ids) => ipcRenderer.invoke(IPC.musicAlbumYears, ids),
    track: (id) => ipcRenderer.invoke(IPC.musicTrack, id),
    lyrics: (id) => ipcRenderer.invoke(IPC.musicLyrics, id)
  },
  playback: {
    resolve: (videoId) => ipcRenderer.invoke(IPC.playbackResolve, videoId)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
