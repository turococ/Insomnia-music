import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
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
    lyrics: (query) => ipcRenderer.invoke(IPC.musicLyrics, query),
    upNext: (videoId, automix) => ipcRenderer.invoke(IPC.musicUpNext, videoId, automix),
    likeStatus: (id) => ipcRenderer.invoke(IPC.musicLikeStatus, id),
    setLiked: (id, liked) => ipcRenderer.invoke(IPC.musicSetLiked, id, liked),
    setCollectionSaved: (kind, id, saved) =>
      ipcRenderer.invoke(IPC.musicSetCollectionSaved, kind, id, saved),
    playlists: (more) => ipcRenderer.invoke(IPC.musicPlaylists, more),
    addToPlaylist: (playlistId, videoId) =>
      ipcRenderer.invoke(IPC.musicAddToPlaylist, playlistId, videoId),
    createPlaylist: (title, videoId) => ipcRenderer.invoke(IPC.musicCreatePlaylist, title, videoId)
  },
  library: {
    list: (kind) => ipcRenderer.invoke(IPC.libraryList, kind),
    more: (kind) => ipcRenderer.invoke(IPC.libraryMore, kind)
  },
  auth: {
    status: () => ipcRenderer.invoke(IPC.authStatus),
    signIn: () => ipcRenderer.invoke(IPC.authSignIn),
    cancelSignIn: () => ipcRenderer.invoke(IPC.authCancel),
    signOut: () => ipcRenderer.invoke(IPC.authSignOut)
  },
  playback: {
    resolve: (videoId) => ipcRenderer.invoke(IPC.playbackResolve, videoId)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
    reset: () => ipcRenderer.invoke(IPC.settingsReset)
  },
  app: {
    version: () => ipcRenderer.invoke(IPC.appVersion),
    onPlayerCommand: (callback) => {
      const listener = (_event: IpcRendererEvent, command: Parameters<typeof callback>[0]): void =>
        callback(command)
      ipcRenderer.on(IPC.playerCommand, listener)
      return () => ipcRenderer.removeListener(IPC.playerCommand, listener)
    }
  },
  updates: {
    status: () => ipcRenderer.invoke(IPC.updatesStatus),
    check: () => ipcRenderer.invoke(IPC.updatesCheck),
    download: () => ipcRenderer.invoke(IPC.updatesDownload),
    install: () => ipcRenderer.invoke(IPC.updatesInstall),
    onChange: (callback) => {
      const listener = (_event: IpcRendererEvent, state: Parameters<typeof callback>[0]): void =>
        callback(state)
      ipcRenderer.on(IPC.updatesChanged, listener)
      return () => ipcRenderer.removeListener(IPC.updatesChanged, listener)
    }
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
