import type { MediaItem } from '@shared/types'

function normalize(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .trim()
}

export function filterTracks(tracks: MediaItem[], query: string): MediaItem[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return tracks

  return tracks.filter((track) => {
    const haystack = normalize(
      [
        track.title,
        track.subtitle,
        ...track.artists.map((artist) => artist.name),
        track.album?.name,
        track.year
      ]
        .filter(Boolean)
        .join(' ')
    )

    return terms.every((term) => haystack.includes(term))
  })
}
