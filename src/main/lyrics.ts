import type { LyricLine, LyricsQuery } from '@shared/types'

const LRCLIB_API = 'https://lrclib.net/api'
const REQUEST_TIMEOUT_MS = 8_000
const REQUEST_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Insomnia/2.0.0 (desktop YouTube Music client)'
}

interface LrclibRecord {
  id?: number
  trackName?: string
  artistName?: string
  albumName?: string
  duration?: number
  instrumental?: boolean
  plainLyrics?: string | null
  syncedLyrics?: string | null
}

export interface LrclibLyrics {
  synced: LyricLine[] | null
  plain: string | null
  instrumental: boolean
}

function normalize(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      // Drop edition/version markers that streaming services and lyric
      // databases spell differently.
      .replace(
        /[([][^)\]]*(?:feat|ft\.?|remaster|live|edit|mix|version|deluxe|bonus|mono|stereo|explicit|from)[^)\]]*[)\]]/gi,
        ' '
      )
      .replace(
        /\s+-\s+(?:feat|ft\.?|remaster|live|edit|mix|version|deluxe|bonus|mono|stereo|explicit|from)\b.*$/gi,
        ' '
      )
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  )
}

function scoreCandidate(record: LrclibRecord, query: LyricsQuery): number {
  if (!record.trackName || !record.artistName) return -1

  const title = normalize(query.title)
  const artist = normalize(query.artist ?? '')
  const candidateTitle = normalize(record.trackName)
  const candidateArtist = normalize(record.artistName)
  if (!title || !candidateTitle || !artist || !candidateArtist) return -1

  let score = 0

  if (candidateTitle === title) score += 8
  else if (candidateTitle.includes(title) || title.includes(candidateTitle)) score += 4
  else return -1

  if (candidateArtist === artist) score += 6
  else if (candidateArtist.includes(artist) || artist.includes(candidateArtist)) score += 3
  else return -1

  if (query.album && record.albumName) {
    const album = normalize(query.album)
    const candidateAlbum = normalize(record.albumName)
    if (album && candidateAlbum.includes(album)) score += 2
  }

  if (query.duration && typeof record.duration === 'number') {
    const delta = Math.abs(query.duration - record.duration)
    if (delta <= 2) score += 3
    else if (delta <= 7) score += 1
    else if (delta > 20) score -= 2
  }

  if (record.syncedLyrics) score += 2

  return score
}

async function requestJson<T>(url: URL): Promise<T | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url, { headers: REQUEST_HEADERS, signal: controller.signal })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function exactUrl(query: LyricsQuery): URL | null {
  if (!query.artist || !query.album || !query.duration) return null

  const url = new URL(`${LRCLIB_API}/get`)
  url.searchParams.set('artist_name', query.artist)
  url.searchParams.set('track_name', query.title)
  url.searchParams.set('album_name', query.album)
  url.searchParams.set('duration', String(Math.round(query.duration)))
  return url
}

function searchUrl(query: LyricsQuery): URL {
  const url = new URL(`${LRCLIB_API}/search`)
  url.searchParams.set('track_name', query.title)
  if (query.artist) url.searchParams.set('artist_name', query.artist)
  if (query.album) url.searchParams.set('album_name', query.album)
  return url
}

/**
 * Parses standard LRC (and enhanced LRC with word timestamps) into sorted
 * timed lines. Metadata tags such as [ar:...] and [offset:...] are handled
 * separately instead of being rendered as lyrics.
 */
export function parseLrc(input: string): LyricLine[] {
  const offsetMatch = input.match(/\[offset:\s*([+-]?\d+)\s*\]/i)
  const offset = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0
  const lines: LyricLine[] = []

  for (const rawLine of input.split(/\r?\n/)) {
    const stamps = [...rawLine.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)]
    if (stamps.length === 0) continue

    const text = rawLine
      .replace(/\[[^\]]*\]/g, '')
      .replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, '')
      .replace(/\s+/g, ' ')
      .trim()

    for (const stamp of stamps) {
      const minutes = Number(stamp[1])
      const seconds = Number(stamp[2])
      const fraction = stamp[3] ?? ''
      const milliseconds =
        fraction.length === 3
          ? Number(fraction) / 1000
          : fraction.length === 2
            ? Number(fraction) / 100
            : fraction.length === 1
              ? Number(fraction) / 10
              : 0
      const time = Math.max(0, minutes * 60 + seconds + milliseconds - offset)
      lines.push({ time, text })
    }
  }

  return lines.sort((a, b) => a.time - b.time)
}

/**
 * Looks up synced lyrics on LRCLIB. The exact endpoint is tried alongside the
 * search endpoint because playful titles often differ between services; all
 * candidates are scored by title, artist, album, duration and sync data.
 */
export async function fetchLrclibLyrics(query: LyricsQuery): Promise<LrclibLyrics | null> {
  if (!query.artist) return null

  const exact = exactUrl(query)
  const [exactRecord, searchResults] = await Promise.all([
    exact ? requestJson<LrclibRecord>(exact) : Promise.resolve(null),
    requestJson<unknown>(searchUrl(query))
  ])

  const candidates: LrclibRecord[] = []
  if (exactRecord) candidates.push(exactRecord)
  if (Array.isArray(searchResults)) {
    for (const item of searchResults) {
      if (item && typeof item === 'object') candidates.push(item as LrclibRecord)
    }
  }

  const seen = new Set<string>()
  let best: LrclibRecord | null = null
  let bestScore = 10

  for (const candidate of candidates) {
    const key = `${candidate.id ?? ''}:${candidate.trackName ?? ''}:${candidate.artistName ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)

    const score = scoreCandidate(candidate, query)
    if (score < bestScore) continue
    if (!candidate.syncedLyrics && !candidate.plainLyrics && !candidate.instrumental) continue

    best = candidate
    bestScore = score
  }

  if (!best) return null

  const synced = best.syncedLyrics ? parseLrc(best.syncedLyrics) : []
  return {
    synced: synced.length > 0 ? synced : null,
    plain: best.plainLyrics?.trim() || null,
    instrumental: Boolean(best.instrumental)
  }
}
