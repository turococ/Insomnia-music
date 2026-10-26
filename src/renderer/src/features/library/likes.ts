import { create } from 'zustand'
import type { MediaItem } from '@shared/types'
import { errorMessage } from '@renderer/lib/errors'
import { queryClient } from '@renderer/lib/queryClient'
import { toast } from '@renderer/features/toast/store'

interface LikesState {
  status: Record<string, boolean>
  known: Record<string, boolean>
  pending: Record<string, boolean>
  ensure: (id: string, force?: boolean) => Promise<boolean>
  setLiked: (id: string, liked: boolean, title?: string) => Promise<boolean>
  toggle: (item: MediaItem) => Promise<boolean>
  reset: () => void
}

const requests = new Map<string, Promise<boolean>>()

export const useLikes = create<LikesState>((set, get) => ({
  status: {},
  known: {},
  pending: {},

  ensure: async (id, force = false) => {
    if (!force && get().known[id]) return get().status[id] ?? false

    const existing = requests.get(id)
    if (existing) return existing

    const request = window.api.music
      .likeStatus(id)
      .then((liked) => {
        set((state) => ({
          status: { ...state.status, [id]: liked },
          known: { ...state.known, [id]: true }
        }))
        return liked
      })
      .catch(() => false)
      .finally(() => requests.delete(id))

    requests.set(id, request)
    return request
  },

  setLiked: async (id, liked, title) => {
    const previous = get().known[id] ? (get().status[id] ?? false) : await get().ensure(id)

    set((state) => ({
      status: { ...state.status, [id]: liked },
      known: { ...state.known, [id]: true },
      pending: { ...state.pending, [id]: true }
    }))

    try {
      const confirmed = await window.api.music.setLiked(id, liked)
      set((state) => ({ status: { ...state.status, [id]: confirmed } }))
      await queryClient.invalidateQueries({ queryKey: ['library', 'liked-songs'] })
      toast(
        title
          ? `${confirmed ? 'Added' : 'Removed'} “${title}” ${confirmed ? 'to' : 'from'} Liked Music`
          : confirmed
            ? 'Added to Liked Music'
            : 'Removed from Liked Music'
      )
      return confirmed
    } catch (error) {
      set((state) => ({ status: { ...state.status, [id]: previous } }))
      toast(errorMessage(error, 'Could not update Liked Music.'), 'error')
      return false
    } finally {
      set((state) => ({ pending: { ...state.pending, [id]: false } }))
    }
  },

  toggle: async (item) => {
    if (get().pending[item.id]) return get().status[item.id] ?? false
    const current = get().known[item.id]
      ? (get().status[item.id] ?? false)
      : await get().ensure(item.id)
    return get().setLiked(item.id, !current, item.title)
  },

  reset: () => {
    requests.clear()
    set({ status: {}, known: {}, pending: {} })
  }
}))
