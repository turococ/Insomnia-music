import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
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
  radioSession: string | null
  isPlaying: boolean
  isLoading: boolean
  isLive: boolean
  progress: number
  duration: number
  volume: number
  muted: boolean
  repeat: RepeatMode
  shuffle: boolean
  autoplay: boolean
  queueOpen: boolean
  error: string | null
  playTrack: (track: MediaItem, queue?: MediaItem[], source?: QueueSource) => Promise<void>
  playQueue: (
    queue: MediaItem[],
    index: number,
    source?: QueueSource | null,
    radioSession?: string | null
  ) => Promise<void>
  appendTracks: (tracks: MediaItem[], source: QueueSource) => boolean
  playNext: (track: MediaItem) => void
  addToQueue: (track: MediaItem) => void
  removeFromQueue: (index: number) => void
  clearQueue: () => void
  moveInQueue: (from: number, to: number) => void
  jumpTo: (index: number) => void
  startRadio: (track: MediaItem) => Promise<void>
  toggleQueue: () => void
  setQueueOpen: (open: boolean) => void
  setAutoplay: (enabled: boolean) => void
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
let extensionTask: Promise<void> | null = null
let extensionRevision = -1
let queueRevision = 0

const QUEUE_AHEAD_THRESHOLD = 4
const MAX_QUEUE_LENGTH = 500

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

  const storedVolume = Number(localStorage.getItem('insomnia:volume') ?? '0.8')
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
    Object.assign(window, { __insomniaAudio: audio })
  }
  return audio
}

function stopPlayback(): void {
  getAudio().pause()
  usePlayer.setState({ isPlaying: false })
}

export const usePlayer = create<PlayerState>()(
  persist(
    (set, get) => ({
      current: null,
      queue: [],
      queueIndex: -1,
      queueSource: null,
      radioSession: null,
      isPlaying: false,
      isLoading: false,
      isLive: false,
      progress: 0,
      duration: 0,
      volume: 0.8,
      muted: false,
      repeat: 'off',
      shuffle: false,
      autoplay: true,
      queueOpen: false,
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

      playQueue: async (queue, index, source = null, radioSession = null) => {
        queueRevision += 1
        const playable = queue.filter(isPlayable)
        const track = playable[index]
        if (!track) return

        const player = getAudio()
        set({
          current: track,
          queue: playable,
          queueIndex: index,
          queueSource: source,
          radioSession,
          isLoading: true,
          isPlaying: false,
          isLive: false,
          progress: 0,
          duration: track.duration ?? 0,
          error: null
        })

        try {
          const resolved = await window.api.playback.resolve(track.id)
          player.src = resolved.url
          player.currentTime = 0
          if (resolved.isLive) set({ isLive: true, duration: 0, progress: 0 })
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

        void ensureQueueAhead()
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

      playNext: (track) => {
        if (!isPlayable(track)) return

        const { current, queue, queueIndex } = get()
        if (!current || queue.length === 0) {
          void get().playTrack(track)
          return
        }

        const nextQueue = [...queue]
        nextQueue.splice(Math.max(0, queueIndex) + 1, 0, track)
        set({ queue: nextQueue })
      },

      addToQueue: (track) => {
        if (!isPlayable(track)) return

        const { current, queue } = get()
        if (!current && queue.length === 0) {
          void get().playTrack(track)
          return
        }

        set({ queue: [...queue, track] })
      },

      removeFromQueue: (index) => {
        const { queue, queueIndex, queueSource, radioSession } = get()
        if (index < 0 || index >= queue.length) return

        if (index === queueIndex) {
          const nextQueue = queue.filter((_, position) => position !== index)
          if (nextQueue.length === 0) {
            queueRevision += 1
            getAudio().pause()
            set({
              queue: [],
              queueIndex: -1,
              queueSource: null,
              radioSession: null,
              current: null,
              isPlaying: false,
              progress: 0,
              duration: 0
            })
            return
          }

          const target = Math.min(index, nextQueue.length - 1)
          set({ queue: nextQueue })
          void get().playQueue(nextQueue, target, queueSource, radioSession)
          return
        }

        set({
          queue: queue.filter((_, position) => position !== index),
          queueIndex: index < queueIndex ? queueIndex - 1 : queueIndex
        })
      },

      clearQueue: () => {
        queueRevision += 1
        const { current } = get()
        set({
          queue: current ? [current] : [],
          queueIndex: current ? 0 : -1,
          queueSource: null,
          radioSession: null
        })
      },

      moveInQueue: (from, to) => {
        const { queue, queueIndex } = get()
        if (from === to) return
        if (from < 0 || to < 0 || from >= queue.length || to >= queue.length) return

        const nextQueue = [...queue]
        const [moved] = nextQueue.splice(from, 1)
        nextQueue.splice(to, 0, moved)

        let nextIndex = queueIndex
        if (from === queueIndex) {
          nextIndex = to
        } else if (from < queueIndex && to >= queueIndex) {
          nextIndex = queueIndex - 1
        } else if (from > queueIndex && to <= queueIndex) {
          nextIndex = queueIndex + 1
        }

        set({ queue: nextQueue, queueIndex: nextIndex })
      },

      jumpTo: (index) => {
        const { queue, queueSource, radioSession } = get()
        if (index < 0 || index >= queue.length) return
        void get().playQueue(queue, index, queueSource, radioSession)
      },

      startRadio: async (track) => {
        if (!isPlayable(track)) return

        set({ isLoading: true, error: null })
        try {
          const result = await window.api.music.upNext(track.id, true)
          const queue = [
            track,
            ...result.items.filter((item) => isPlayable(item) && item.id !== track.id)
          ]
          if (queue.length < 2) throw new Error('No radio tracks were found for this song.')
          await get().playQueue(queue, 0, null, result.sessionId)
        } catch (error) {
          set({ error: formatError(error), isLoading: false })
        }
      },

      toggleQueue: () => set((state) => ({ queueOpen: !state.queueOpen })),

      setQueueOpen: (open) => set({ queueOpen: open }),

      setAutoplay: (enabled) => set({ autoplay: enabled }),

      toggle: () => {
        const { current, queue, queueIndex, queueSource, radioSession } = get()
        if (!current) {
          if (queue.length > 0) {
            void get().playQueue(queue, Math.max(0, queueIndex), queueSource, radioSession)
          }
          return
        }

        const player = getAudio()
        // After a restart the queue is restored without a loaded stream, so
        // resolve the current track again on the first play.
        if (!player.src) {
          void get().playQueue(
            queue.length > 0 ? queue : [current],
            Math.max(0, queueIndex),
            queueSource,
            radioSession
          )
          return
        }

        if (player.paused) {
          void player.play().catch((error) => set({ error: formatError(error) }))
        } else {
          player.pause()
        }
      },

      next: () => {
        const { queue, queueIndex, queueSource, radioSession, repeat, shuffle, autoplay, current } =
          get()
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
          void get().playQueue(queue, index, queueSource, radioSession)
          return
        }

        if (queueIndex + 1 < queue.length) {
          void get().playQueue(queue, queueIndex + 1, queueSource, radioSession)
          return
        }

        if (repeat === 'all') {
          void get().playQueue(queue, 0, queueSource, radioSession)
          return
        }

        // Autoplay keeps the music going with similar tracks instead of
        // stopping dead when the queue runs out. The queue is normally
        // extended ahead of time; this is the last-resort path.
        if (autoplay && current) {
          void ensureQueueAhead().then(() => {
            const state = get()
            if (state.queueIndex + 1 < state.queue.length) {
              void state.playQueue(
                state.queue,
                state.queueIndex + 1,
                state.queueSource,
                state.radioSession
              )
              return
            }
            set({ radioSession: null })
            stopPlayback()
          })
          return
        }

        stopPlayback()
      },

      previous: () => {
        const { queue, queueIndex, queueSource, radioSession, progress, isLive } = get()
        const player = getAudio()

        if (!isLive && (progress > 3 || queue.length === 0)) {
          player.currentTime = 0
          set({ progress: 0 })
          return
        }

        if (queueIndex > 0) {
          void get().playQueue(queue, queueIndex - 1, queueSource, radioSession)
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
        localStorage.setItem('insomnia:volume', String(next))
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
    }),
    {
      name: 'insomnia:player',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        current: state.current,
        queue: state.queue,
        queueIndex: state.queueIndex,
        queueSource: state.queueSource,
        volume: state.volume,
        muted: state.muted,
        repeat: state.repeat,
        shuffle: state.shuffle,
        autoplay: state.autoplay
      }),
      // Restoring a queue must never start audio on its own; the first play
      // re-resolves the stream.
      merge: (persisted, current) => {
        const restored = { ...current, ...(persisted as Partial<PlayerState>) }
        restored.isPlaying = false
        restored.isLoading = false
        restored.progress = 0
        restored.isLive = false
        restored.duration = restored.current?.duration ?? 0
        return restored
      }
    }
  )
)

/**
 * Keeps the queue fed ahead of playback. Radio panels are paginated by
 * YouTube Music, so the continuation token is what makes listening endless.
 */
async function ensureQueueAhead(): Promise<void> {
  const revision = queueRevision
  if (extensionTask && extensionRevision === revision) return extensionTask

  const state = usePlayer.getState()
  if (
    !state.autoplay ||
    state.shuffle ||
    !state.current ||
    state.queue.length === 0 ||
    state.queueIndex < state.queue.length - QUEUE_AHEAD_THRESHOLD
  ) {
    return
  }

  extensionRevision = revision
  const task = extendQueue().finally(() => {
    if (extensionTask === task) {
      extensionTask = null
      extensionRevision = -1
    }
  })
  extensionTask = task
  return task
}

async function extendQueue(): Promise<void> {
  const revision = queueRevision

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const state = usePlayer.getState()
    if (!state.autoplay) return

    let items: MediaItem[]
    let hasMore: boolean

    try {
      if (state.radioSession) {
        const page = await window.api.music.upNextMore(state.radioSession)
        if (queueRevision !== revision) return
        items = page.items
        hasMore = page.hasMore
      } else {
        // Rotate the seed when a station is exhausted so the next station does
        // not simply repeat the same recommendations.
        const seed = state.queue[Math.max(0, state.queue.length - 1 - attempt)] ?? state.current
        if (!seed) return
        const started = await window.api.music.upNext(seed.id, true)
        if (queueRevision !== revision) return
        usePlayer.setState({ radioSession: started.sessionId })
        items = started.items
        hasMore = started.hasMore
      }
    } catch {
      if (queueRevision !== revision) return
      usePlayer.setState({ radioSession: null })
      continue
    }

    if (!hasMore) usePlayer.setState({ radioSession: null })

    const latest = usePlayer.getState()
    const known = new Set(latest.queue.map((item) => item.id))
    const fresh = items.filter((item) => isPlayable(item) && !known.has(item.id))
    if (fresh.length === 0) continue

    appendFreshTracks(fresh)
    return
  }
}

function appendFreshTracks(fresh: MediaItem[]): void {
  const { queue, queueIndex } = usePlayer.getState()
  const next = [...queue, ...fresh]
  let index = queueIndex

  const overflow = next.length - MAX_QUEUE_LENGTH
  if (overflow > 0) {
    // Never drop the track that is currently playing (or anything before it).
    const removable = Math.min(overflow, Math.max(0, index))
    if (removable > 0) {
      next.splice(0, removable)
      index -= removable
    }
  }

  usePlayer.setState({ queue: next, queueIndex: index })
}

if (import.meta.env.DEV) {
  Object.assign(window, { __insomniaPlayer: usePlayer })
}
