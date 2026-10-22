import { create } from 'zustand'
import type { CollectionKind, MediaItem } from '@shared/types'

export type RepeatMode = 'off' | 'all' | 'one'

export interface QueueSource {
  kind: CollectionKind
  id: string
}

interface PlayerState {
  current: MediaItem | null
  queue: MediaItem[]
  queueIndex: number
  queueSource: QueueSource | null
  isPlaying: boolean
  isLoading: boolean
  isLive: boolean
  progress: number
  duration: number
  volume: number
  muted: boolean
  repeat: RepeatMode
  shuffle: boolean
  error: string | null
  playTrack: (track: MediaItem, queue?: MediaItem[], source?: QueueSource) => Promise<void>
  playQueue: (queue: MediaItem[], index: number, source?: QueueSource | null) => Promise<void>
  appendTracks: (tracks: MediaItem[], source: QueueSource) => boolean
  toggle: () => void
  next: () => void
  previous: () => void
  seek: (seconds: number) => void
  setVolume: (value: number) => void
  toggleMute: () => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  clearError: () => void
}

let audio: HTMLAudioElement | null = null
let mediaSessionReady = false

function isPlayable(item: MediaItem): boolean {
  return item.kind === 'song' || item.kind === 'video'
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
      .replace(/^Error invoking remote method '[^']+':\s*/i, '')
      .replace(/^Error:\s*/i, '')
  }
  return 'Playback failed'
}

function updateMediaSession(track: MediaItem): void {
  if (!('mediaSession' in navigator)) return

  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artists.map((artist) => artist.name).join(', '),
    album: track.album?.name ?? '',
    artwork: track.thumbnails.slice(0, 3).map((thumbnail) => ({
      src: thumbnail.url,
      sizes: `${thumbnail.width}x${thumbnail.height}`,
      type: 'image/jpeg'
    }))
  })
}

function setupMediaSession(): void {
  if (mediaSessionReady || !('mediaSession' in navigator)) return
  mediaSessionReady = true

  const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
    ['play', () => void getAudio().play()],
    ['pause', () => getAudio().pause()],
    ['previoustrack', () => usePlayer.getState().previous()],
    ['nexttrack', () => usePlayer.getState().next()],
    [
      'seekbackward',
      (details) =>
        usePlayer.getState().seek(Math.max(0, getAudio().currentTime - (details.seekOffset ?? 10)))
    ],
    [
      'seekforward',
      (details) =>
        usePlayer
          .getState()
          .seek(
            Math.min(
              getAudio().duration || Infinity,
              getAudio().currentTime + (details.seekOffset ?? 10)
            )
          )
    ],
    [
      'seekto',
      (details) => {
        if (typeof details.seekTime === 'number') usePlayer.getState().seek(details.seekTime)
      }
    ]
  ]

  for (const [action, handler] of handlers) {
    try {
      navigator.mediaSession.setActionHandler(action, handler)
    } catch {
      // Some actions are not supported on every platform.
    }
  }
}

function getAudio(): HTMLAudioElement {
  if (audio) return audio

  audio = new Audio()
  audio.preload = 'auto'

  const storedVolume = Number(localStorage.getItem('toneglass:volume') ?? '0.8')
  audio.volume = Number.isFinite(storedVolume) ? Math.min(1, Math.max(0, storedVolume)) : 0.8
  usePlayer.setState({ volume: audio.volume })

  audio.addEventListener('timeupdate', () => {
    if (audio) {
      const state = usePlayer.getState()
      usePlayer.setState({ progress: state.isLive ? 0 : audio.currentTime })
    }
  })

  audio.addEventListener('durationchange', () => {
    if (audio) {
      const state = usePlayer.getState()
      usePlayer.setState({
        duration: state.isLive || !Number.isFinite(audio.duration) ? 0 : audio.duration
      })
    }
  })

  audio.addEventListener('play', () => {
    usePlayer.setState({ isPlaying: true, error: null })
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
  })

  audio.addEventListener('pause', () => {
    usePlayer.setState({ isPlaying: false })
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
  })

  audio.addEventListener('playing', () => usePlayer.setState({ isLoading: false }))
  audio.addEventListener('waiting', () => usePlayer.setState({ isLoading: true }))

  audio.addEventListener('ended', () => {
    usePlayer.getState().next()
  })

  audio.addEventListener('error', () => {
    if (!audio?.src) return
    usePlayer.setState({
      error: 'This track could not be played. Try another one.',
      isPlaying: false,
      isLoading: false
    })
  })

  setupMediaSession()
  if (import.meta.env.DEV) {
    Object.assign(window, { __toneglassAudio: audio })
  }
  return audio
}

export const usePlayer = create<PlayerState>((set, get) => ({
  current: null,
  queue: [],
  queueIndex: -1,
  queueSource: null,
  isPlaying: false,
  isLoading: false,
  isLive: false,
  progress: 0,
  duration: 0,
  volume: 0.8,
  muted: false,
  repeat: 'off',
  shuffle: false,
  error: null,

  playTrack: async (track, queue, source) => {
    if (!isPlayable(track)) return

    if (get().current?.id === track.id) {
      get().toggle()
      return
    }

    const nextQueue = (queue?.length ? queue : [track]).filter(isPlayable)
    const index = nextQueue.findIndex((item) => item.id === track.id)
    await get().playQueue(nextQueue, index >= 0 ? index : 0, source ?? null)
  },

  playQueue: async (queue, index, source = null) => {
    const playable = queue.filter(isPlayable)
    const track = playable[index]
    if (!track) return

    const player = getAudio()
    set({
      current: track,
      queue: playable,
      queueIndex: index,
      queueSource: source,
      isLoading: true,
      isPlaying: false,
      isLive: false,
      progress: 0,
      duration: track.duration ?? 0,
      error: null
    })

    try {
      const source = await window.api.playback.resolve(track.id)
      player.src = source.url
      player.currentTime = 0
      if (source.isLive) set({ isLive: true, duration: 0, progress: 0 })
      await player.play()
      updateMediaSession(track)
      set({ isPlaying: true })
    } catch (error) {
      set({
        error: formatError(error),
        isPlaying: false,
        isLoading: false
      })
    }
  },

  appendTracks: (tracks, source) => {
    const { queue, queueSource } = get()
    if (!queueSource || queueSource.kind !== source.kind || queueSource.id !== source.id) {
      return false
    }

    const playable = tracks.filter(isPlayable)
    if (playable.length === 0) return false

    set({ queue: [...queue, ...playable] })
    return true
  },

  toggle: () => {
    const { current, queue, queueIndex, queueSource } = get()
    if (!current) {
      if (queue.length > 0) {
        void get().playQueue(queue, Math.max(0, queueIndex), queueSource)
      }
      return
    }

    const player = getAudio()
    if (player.paused) {
      void player.play().catch((error) => set({ error: formatError(error) }))
    } else {
      player.pause()
    }
  },

  next: () => {
    const { queue, queueIndex, queueSource, repeat, shuffle } = get()
    if (queue.length === 0) return

    if (repeat === 'one') {
      const player = getAudio()
      player.currentTime = 0
      void player.play().catch(() => undefined)
      return
    }

    if (shuffle && queue.length > 1) {
      let index = queueIndex
      while (index === queueIndex) index = Math.floor(Math.random() * queue.length)
      void get().playQueue(queue, index, queueSource)
      return
    }

    if (queueIndex + 1 < queue.length) {
      void get().playQueue(queue, queueIndex + 1, queueSource)
      return
    }

    if (repeat === 'all') {
      void get().playQueue(queue, 0, queueSource)
      return
    }

    getAudio().pause()
    set({ isPlaying: false })
  },

  previous: () => {
    const { queue, queueIndex, queueSource, progress, isLive } = get()
    const player = getAudio()

    if (!isLive && (progress > 3 || queue.length === 0)) {
      player.currentTime = 0
      set({ progress: 0 })
      return
    }

    if (queueIndex > 0) {
      void get().playQueue(queue, queueIndex - 1, queueSource)
    } else if (!isLive) {
      player.currentTime = 0
      set({ progress: 0 })
    }
  },

  seek: (seconds) => {
    if (get().isLive) return
    const player = getAudio()
    if (!Number.isFinite(player.duration)) return
    const next = Math.min(player.duration, Math.max(0, seconds))
    player.currentTime = next
    set({ progress: next })
  },

  setVolume: (value) => {
    const player = getAudio()
    const next = Math.min(1, Math.max(0, value))
    player.volume = next
    player.muted = next === 0
    set({ volume: next, muted: next === 0 })
    localStorage.setItem('toneglass:volume', String(next))
  },

  toggleMute: () => {
    const player = getAudio()
    player.muted = !player.muted
    set({ muted: player.muted })
  },

  toggleShuffle: () => set((state) => ({ shuffle: !state.shuffle })),

  cycleRepeat: () =>
    set((state) => ({
      repeat: state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off'
    })),

  clearError: () => set({ error: null })
}))

if (import.meta.env.DEV) {
  Object.assign(window, { __toneglassPlayer: usePlayer })
}
