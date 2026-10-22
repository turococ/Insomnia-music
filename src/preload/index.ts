import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC } from '../shared/ipc'
import type { AppApi } from '../shared/types'

const api: AppApi = {
  music: {
    home: (filter) => ipcRenderer.invoke(IPC.musicHome, filter),
    search: (query) => ipcRenderer.invoke(IPC.musicSearch, query),
    collection: (kind, id) => ipcRenderer.invoke(IPC.musicCollection, kind, id),
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
