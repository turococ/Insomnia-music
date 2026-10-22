import type { Innertube } from 'youtubei.js'
import type {
  MediaItem,
  MediaKind,
  PlaybackSource,
  HomeData,
  HomeSection,
  SearchResult
} from '@shared/types'
import { APP_USER_AGENT } from './constants'
import { poTokenProvider } from './po-token'

const PLAYBACK_CLIENTS = ['YTMUSIC', 'IOS', 'ANDROID_VR'] as const
const STREAM_TTL_MS = 5 * 60 * 1000

type YtMusic = Innertube['music']

interface CachedSource {
  source: PlaybackSource
  expiresAt: number
}

class MusicService {
  private yt: Innertube | null = null
  private initPromise: Promise<Innertube> | null = null
  private sourceCache = new Map<string, CachedSource>()
  private pendingSources = new Map<string, Promise<PlaybackSource>>()

  async init(): Promise<Innertube> {
    if (this.yt) return this.yt
    if (this.initPromise) return this.initPromise

    this.initPromise = (async () => {
      const mod = await import('youtubei.js')

      // youtubei.js needs an evaluator to decipher the player's signature.
      mod.Platform.shim.eval = async (data: { output: string }) => new Function(data.output)()
      // The parser JIT logs every unknown renderer as an error even though it
      // recovers automatically. Keep the console clean for now.
      mod.Log.setLevel(mod.Log.Level.NONE)

      const yt = await mod.Innertube.create({
        lang: 'en',
        location: 'US',
        user_agent: APP_USER_AGENT,
        retrieve_player: true
      })

      this.yt = yt
      return yt
    })()

    return this.initPromise
  }

  private async getYt(): Promise<Innertube> {
    return this.yt ?? this.init()
  }

  private async music(): Promise<YtMusic> {
    return (await this.getYt()).music
  }

  async home(filter?: string): Promise<HomeData> {
    const music = await this.music()
    let feed = await music.getHomeFeed()
    const filters = feed.filters

    if (filter) {
      try {
        feed = await feed.applyFilter(filter)
      } catch (error) {
        console.warn(
          `[home] could not apply filter "${filter}":`,
          error instanceof Error ? error.message : error
        )
      }
    }

    const sections: HomeSection[] = []
    const seenTitles = new Set<string>()

    for (let page = 0; page < 3 && sections.length < 8; page++) {
      for (const section of feed.sections ?? []) {
        if (section.type === 'MusicTasteBuilderShelf') continue

        const shelf = section as unknown as {
          header?: { title?: { toString(): string } }
          contents?: unknown[]
        }
        const title = shelf.header?.title?.toString() ?? ''
        if (!title || seenTitles.has(title)) continue

        const seenItems = new Set<string>()
        const items = (shelf.contents ?? [])
          .map((item) => this.mapItem(item))
          .filter((item): item is MediaItem => {
            if (!item) return false
            const key = `${item.kind}:${item.id}`
            if (seenItems.has(key)) return false
            seenItems.add(key)
            return true
          })

        if (items.length > 0) {
          seenTitles.add(title)
          sections.push({ title, items })
        }

        if (sections.length >= 8) break
      }

      if (!feed.has_continuation) break

      try {
        feed = await feed.getContinuation()
      } catch {
        break
      }
    }

    return { filters, sections }
  }

  async search(query: string): Promise<SearchResult> {
    const trimmed = query.trim()
    if (!trimmed) return { query: '', items: [] }

    const music = await this.music()
    const search = await music.search(trimmed)
    const seen = new Set<string>()
    const items: MediaItem[] = []

    for (const section of search.contents ?? []) {
      // The top result card is often a radio/playlist; the regular sections
      // below it contain the actual songs, albums and artists.
      if (section.type === 'MusicCardShelf') continue

      for (const raw of section.contents ?? []) {
        const item = this.mapItem(raw)
        if (!item) continue
        const key = `${item.kind}:${item.id}`
        if (seen.has(key)) continue
        seen.add(key)
        items.push(item)
      }
    }

    return { query: trimmed, items }
  }

  async track(id: string): Promise<MediaItem | null> {
    try {
      const music = await this.music()
      const info = await music.getInfo(id)
      const basic = info.basic_info
      const thumbnails = this.mapThumbnails(
        (basic as unknown as { thumbnail?: { thumbnails?: unknown[] } }).thumbnail?.thumbnails
      )

      return {
        id,
        kind: 'song',
        title: basic.title ?? id,
        artists: basic.author ? [{ id: basic.channel_id, name: basic.author }] : [],
        duration: basic.duration,
        thumbnails
      }
    } catch {
      return null
    }
  }

  async lyrics(id: string): Promise<string | null> {
    try {
      const music = await this.music()
      const lyrics = await music.getLyrics(id)
      return lyrics?.description?.toString() ?? null
    } catch {
      return null
    }
  }

  async resolve(videoId: string, force = false): Promise<PlaybackSource> {
    if (force) {
      this.sourceCache.delete(videoId)
      this.pendingSources.delete(videoId)
    }

    const cached = this.sourceCache.get(videoId)
    if (cached && cached.expiresAt > Date.now()) return cached.source

    const pending = this.pendingSources.get(videoId)
    if (pending) return pending

    const promise = this.resolveUncached(videoId).finally(() => {
      this.pendingSources.delete(videoId)
    })
    this.pendingSources.set(videoId, promise)
    return promise
  }

  private async resolveUncached(videoId: string): Promise<PlaybackSource> {
    const yt = await this.getYt()
    const errors: string[] = []

    for (const client of PLAYBACK_CLIENTS) {
      try {
        const info = await yt.getInfo(videoId, { client })
        if (info.playability_status?.status !== 'OK' || !info.streaming_data) {
          errors.push(`${client}: ${info.playability_status?.reason ?? 'no streams'}`)
          continue
        }

        const format = this.chooseAudioFormat(info)
        let url = await format.decipher(yt.session.player)
        if (!url) {
          errors.push(`${client}: empty URL`)
          continue
        }

        try {
          const poToken = await poTokenProvider.getToken(yt, videoId)
          const parsed = new URL(url)
          parsed.searchParams.set('pot', poToken)
          url = parsed.toString()
        } catch (error) {
          console.warn(
            `[po-token] could not mint a token for ${videoId}:`,
            error instanceof Error ? error.message : error
          )
        }

        const expire = Number(new URL(url).searchParams.get('expire'))
        const expiresAt =
          Number.isFinite(expire) && expire > 0 ? expire * 1000 : Date.now() + STREAM_TTL_MS

        const source: PlaybackSource = {
          url,
          client,
          expiresAt,
          isLive: Boolean(info.basic_info.is_live)
        }

        this.sourceCache.set(videoId, {
          source,
          expiresAt: Math.min(expiresAt, Date.now() + STREAM_TTL_MS)
        })

        return source
      } catch (error) {
        errors.push(`${client}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    throw new Error(`Could not resolve playback for ${videoId}. ${errors.join(' | ')}`)
  }

  private chooseAudioFormat(info: Awaited<ReturnType<Innertube['getInfo']>>) {
    try {
      // Electron's bundled Chromium may not decode AAC. Opus in WebM is
      // universally supported and usually has the best available bitrate too.
      return info.chooseFormat({ type: 'audio', quality: 'best', codec: 'opus', format: 'webm' })
    } catch {
      return info.chooseFormat({ type: 'audio', quality: 'best' })
    }
  }

  private mapItem(raw: unknown): MediaItem | null {
    const item = raw as {
      type?: string
      item_type?: string
      id?: string
      title?: { toString(): string }
      name?: string
      subtitle?: { toString(): string }
      thumbnails?: Array<{ url: string; width: number; height: number }>
      thumbnail?: Array<{ url: string; width: number; height: number }>
      duration?: { seconds: number }
      year?: string
      artists?: Array<{ channel_id?: string; name: string }>
      author?: { channel_id?: string; name: string }
      album?: { id?: string; name: string }
    }

    if (!item || (item.type !== 'MusicResponsiveListItem' && item.type !== 'MusicTwoRowItem')) {
      return null
    }

    const kind = item.item_type as MediaKind | undefined
    if (!kind || !['song', 'video', 'album', 'playlist', 'artist', 'podcast'].includes(kind)) {
      return null
    }

    const id = item.id
    const title = item.title?.toString() ?? item.name ?? ''
    if (!id || !title) return null

    const thumbnails = this.mapThumbnails(item.thumbnails ?? item.thumbnail)
    const artists =
      item.artists?.map((artist) => ({ id: artist.channel_id, name: artist.name })) ??
      (item.author ? [{ id: item.author.channel_id, name: item.author.name }] : [])

    return {
      id,
      kind,
      title,
      subtitle: item.subtitle?.toString() ?? artists.map((artist) => artist.name).join(' • '),
      artists,
      album: item.album ? { id: item.album.id, name: item.album.name } : undefined,
      year: item.year,
      duration: item.duration?.seconds,
      thumbnails
    }
  }

  private mapThumbnails(raw: unknown): MediaItem['thumbnails'] {
    if (!Array.isArray(raw)) return []
    return raw
      .map((thumbnail) => {
        const value = thumbnail as { url?: string; width?: number; height?: number }
        if (!value.url) return null
        return {
          url: value.url,
          width: value.width ?? 0,
          height: value.height ?? 0
        }
      })
      .filter((thumbnail): thumbnail is MediaItem['thumbnails'][number] => thumbnail !== null)
  }
}

export const musicService = new MusicService()
