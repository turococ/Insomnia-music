import type { MediaItem, Thumbnail } from '@shared/types'

export function formatTime(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return '0:00'
  const total = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${rest.toString().padStart(2, '0')}`
}

export function pickThumbnail(thumbnails: Thumbnail[], preferredWidth = 320): string | undefined {
  if (thumbnails.length === 0) return undefined
  const sorted = [...thumbnails].sort(
    (a, b) => Math.abs(a.width - preferredWidth) - Math.abs(b.width - preferredWidth)
  )
  return sorted[0]?.url
}

export function itemSubtitle(item: MediaItem): string {
  if (item.artists.length > 0) return item.artists.map((artist) => artist.name).join(', ')
  if (item.album?.name) return item.album.name
  if (item.year) return item.year
  return item.subtitle ?? ''
}

export function mergeTracks(items: MediaItem[]): MediaItem[] {
  return items.filter((item) => item.kind === 'song' || item.kind === 'video')
}
