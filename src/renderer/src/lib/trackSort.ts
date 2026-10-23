import type { MediaItem } from '@shared/types'

export type TrackSortKey =
  'default' | 'popularity' | 'title' | 'artist' | 'album' | 'newest' | 'oldest'

export interface TrackSortOption {
  key: TrackSortKey
  label: string
}

export const TRACK_SORT_OPTIONS: TrackSortOption[] = [
  { key: 'default', label: 'Default order' },
  { key: 'popularity', label: 'Popularity' },
  { key: 'title', label: 'Title A-Z' },
  { key: 'artist', label: 'Artist A-Z' },
  { key: 'album', label: 'Album A-Z' },
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' }
]

export interface TrackSortOptions {
  albumYears?: Record<string, number>
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

function compareText(
  leftValue: string | undefined,
  rightValue: string | undefined,
  emptyLast = false
): number {
  const left = leftValue?.trim() ?? ''
  const right = rightValue?.trim() ?? ''

  if (!left && !right) return 0
  if (!left) return emptyLast ? 1 : -1
  if (!right) return emptyLast ? -1 : 1
  return collator.compare(left, right)
}

function primaryArtist(track: MediaItem): string | undefined {
  return track.artists[0]?.name
}

function albumName(track: MediaItem): string | undefined {
  return track.album?.name
}

function trackYear(track: MediaItem, options: TrackSortOptions): number | undefined {
  if (track.year) {
    const year = Number(track.year)
    if (Number.isFinite(year)) return year
  }

  const albumId = track.album?.id
  if (!albumId) return undefined

  const year = options.albumYears?.[albumId]
  return Number.isFinite(year) ? year : undefined
}

function comparePopularity(left: MediaItem, right: MediaItem): number {
  const leftPlays = left.plays ?? -1
  const rightPlays = right.plays ?? -1
  if (leftPlays !== rightPlays) return rightPlays - leftPlays
  return compareText(left.title, right.title)
}

function compareYear(
  left: MediaItem,
  right: MediaItem,
  options: TrackSortOptions,
  direction: 'newest' | 'oldest'
): number {
  const leftYear = trackYear(left, options)
  const rightYear = trackYear(right, options)

  if (leftYear === undefined && rightYear === undefined) {
    return compareText(left.title, right.title)
  }
  if (leftYear === undefined) return 1
  if (rightYear === undefined) return -1
  if (leftYear === rightYear) return compareText(left.title, right.title)

  return direction === 'newest' ? rightYear - leftYear : leftYear - rightYear
}

export function sortTracks(
  tracks: MediaItem[],
  key: TrackSortKey,
  options: TrackSortOptions = {}
): MediaItem[] {
  return tracks
    .map((track, index) => ({ track, index }))
    .sort((left, right) => {
      let result = 0

      switch (key) {
        case 'default':
          result = 0
          break
        case 'popularity':
          result = comparePopularity(left.track, right.track)
          break
        case 'title':
          result = compareText(left.track.title, right.track.title)
          break
        case 'artist':
          result =
            compareText(primaryArtist(left.track), primaryArtist(right.track), true) ||
            compareText(albumName(left.track), albumName(right.track), true) ||
            compareText(left.track.title, right.track.title)
          break
        case 'album':
          result =
            compareText(albumName(left.track), albumName(right.track), true) ||
            compareText(primaryArtist(left.track), primaryArtist(right.track), true) ||
            compareText(left.track.title, right.track.title)
          break
        case 'newest':
        case 'oldest':
          result = compareYear(left.track, right.track, options, key)
          break
      }

      return result || left.index - right.index
    })
    .map(({ track }) => track)
}
