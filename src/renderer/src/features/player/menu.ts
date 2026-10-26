import { create } from 'zustand'
import type { MediaItem } from '@shared/types'

interface TrackMenuState {
  item: MediaItem | null
  x: number
  y: number
  open: (item: MediaItem, x: number, y: number) => void
  close: () => void
}

export const useTrackMenu = create<TrackMenuState>((set) => ({
  item: null,
  x: 0,
  y: 0,
  open: (item, x, y) => set({ item, x, y }),
  close: () => set({ item: null })
}))
