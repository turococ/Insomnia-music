import { create } from 'zustand'
import type { MediaItem } from '@shared/types'

interface PlaylistPickerState {
  item: MediaItem | null
  open: (item: MediaItem) => void
  close: () => void
}

export const usePlaylistPicker = create<PlaylistPickerState>((set) => ({
  item: null,
  open: (item) => set({ item }),
  close: () => set({ item: null })
}))
