import type { Innertube } from 'youtubei.js'
import type {
  AlbumRef,
  ArtistRef,
  CollectionData,
  CollectionKind,
  CollectionSection,
  CollectionTrackPage,
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

interface PageHeaderFields {
  title?: unknown
  subtitle?: unknown
  second_subtitle?: unknown
  description?: unknown
  thumbnails?: unknown
  thumbnail?: { contents?: unknown[] } | null
  strapline_text_one?: {
    endpoint?: { payload?: { browseId?: string } }
  }
  author?: { name?: string; channel_id?: string }
}

interface AlbumPage {
  header?: unknown
  contents?: unknown[]
  sections?: unknown[]
}

interface PlaylistPage {
  header?: unknown
  contents?: unknown[]
  has_continuation?: boolean
  getContinuation?: () => Promise<PlaylistPage>
  getRelated?: () => Promise<unknown>
}

interface ArtistPage {
  header?: unknown
  sections?: unknown[]
  getAllSongs?: () => Promise<MediaSection | undefined>
}

interface MediaSection {
  title?: unknown
  header?: { title?: unknown }
  contents?: unknown[]
}

interface PlaylistContext {
  page: PlaylistPage
  thumbnails: MediaItem['thumbnails']
}

class MusicService {
  private yt: Innertube | null = null
  private initPromise: Promise<Innertube> | null = null
  private sourceCache = new Map<string, CachedSource>()
  private pendingSources = new Map<string, Promise<PlaybackSource>>()
  private playlistContexts = new Map<string, PlaylistContext>()
  private pendingCollectionMore = new Map<string, Promise<CollectionTrackPage>>()

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

  async collection(kind: CollectionKind, id: string): Promise<CollectionData> {
    const music = await this.music()

    switch (kind) {
      case 'album':
        return this.mapAlbum(await music.getAlbum(id), id)
      case 'playlist': {
        const playlist = await music.getPlaylist(id)
        const data = await this.mapPlaylist(playlist, id)
        this.playlistContexts.set(id, { page: playlist, thumbnails: data.thumbnails })
        return data
      }
      case 'artist':
        return this.mapArtist(await music.getArtist(id), id)
    }
  }

  async collectionMore(kind: CollectionKind, id: string): Promise<CollectionTrackPage> {
    if (kind !== 'playlist') return { tracks: [], hasMore: false }

    const pending = this.pendingCollectionMore.get(id)
    if (pending) return pending

    const task = this.loadMorePlaylist(id).finally(() => {
      this.pendingCollectionMore.delete(id)
    })
    this.pendingCollectionMore.set(id, task)
    return task
  }

  private async loadMorePlaylist(id: string): Promise<CollectionTrackPage> {
    let context = this.playlistContexts.get(id)

    if (!context) {
      const playlist = await (await this.music()).getPlaylist(id)
      context = {
        page: playlist,
        thumbnails: this.headerThumbnails(playlist.header)
      }
      this.playlistContexts.set(id, context)
    }

    const page = context.page
    if (!page.has_continuation || !page.getContinuation) {
      return { tracks: [], hasMore: false }
    }

    const next = await this.getPlaylistContinuation(page)
    this.playlistContexts.set(id, { page: next, thumbnails: context.thumbnails })
    const tracks = this.mapTracks(next.contents, {
      thumbnails: context.thumbnails,
      forceSong: true
    })

    return { tracks, hasMore: Boolean(next.has_continuation) }
  }

  private async getPlaylistContinuation(page: PlaylistPage): Promise<PlaylistPage> {
    const continuation = page.getContinuation
    if (!continuation) throw new Error('Playlist continuation is unavailable')

    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await continuation.call(page)
      } catch (error) {
        lastError = error
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 700))
        }
      }
    }

    throw lastError
  }

  private mapAlbum(album: AlbumPage, id: string): CollectionData {
    const header = album.header
    const title = this.text(this.headerField(header, 'title')) ?? 'Album'
    const thumbnails = this.headerThumbnails(header)
    const author = this.headerAuthor(header)
    const meta = this.text(this.headerField(header, 'second_subtitle'))
    const tracks = this.mapTracks(album.contents, {
      album: { id, name: title },
      artist: author,
      thumbnails,
      forceSong: true
    })

    return {
      id,
      kind: 'album',
      title,
      subtitle: this.text(this.headerField(header, 'subtitle')),
      meta,
      description: this.headerDescription(header),
      author,
      thumbnails,
      tracks,
      sections: this.mapSections(album.sections),
      totalTracks: this.parseTrackCount(meta)
    }
  }

  private async mapPlaylist(playlist: PlaylistPage, id: string): Promise<CollectionData> {
    const header = playlist.header
    const title = this.text(this.headerField(header, 'title')) ?? 'Playlist'
    const thumbnails = this.headerThumbnails(header)
    const author = this.headerAuthor(header)
    const meta = this.text(this.headerField(header, 'second_subtitle'))
    const tracks = this.mapTracks(playlist.contents, {
      thumbnails,
      forceSong: true
    })

    let sections: CollectionSection[] = []
    try {
      const related = await playlist.getRelated?.()
      if (related) sections = this.mapSections([related])
    } catch (error) {
      console.warn(
        '[collection] could not load related playlists:',
        error instanceof Error ? error.message : error
      )
    }

    return {
      id,
      kind: 'playlist',
      title,
      subtitle: this.text(this.headerField(header, 'subtitle')),
      meta,
      description: this.headerDescription(header),
      author,
      thumbnails,
      tracks,
      sections,
      hasMore: Boolean(playlist.has_continuation),
      totalTracks: this.parseTrackCount(meta)
    }
  }

  private async mapArtist(artist: ArtistPage, id: string): Promise<CollectionData> {
    const header = artist.header
    const title = this.text(this.headerField(header, 'title')) ?? 'Artist'
    const thumbnails = this.headerThumbnails(header)
    const rawSections = artist.sections ?? []
    const topSongs = rawSections.find((section) =>
      this.sectionTitle(section)?.toLowerCase().includes('top songs')
    )
    const topSongsItems = (topSongs as MediaSection | undefined)?.contents ?? []
    const fallback = {
      artist: { id, name: title },
      thumbnails,
      forceSong: true
    }
    let tracks = this.mapTracks(topSongsItems, fallback)
    let allTracks: MediaItem[] = []

    try {
      const allSongs = await artist.getAllSongs?.()
      if (allSongs) allTracks = this.mapTracks(allSongs.contents, fallback)
    } catch (error) {
      console.warn(
        '[collection] could not load all artist songs:',
        error instanceof Error ? error.message : error
      )
    }

    if (allTracks.length > 0) {
      const fullById = new Map(allTracks.map((track) => [track.id, track]))
      tracks = tracks.map((track) => {
        const full = fullById.get(track.id)
        if (!full) return track
        return {
          ...track,
          duration: track.duration ?? full.duration,
          album: track.album ?? full.album,
          thumbnails: track.thumbnails.length > 0 ? track.thumbnails : full.thumbnails
        }
      })
    }

    return {
      id,
      kind: 'artist',
      title,
      subtitle: this.text(this.headerField(header, 'subtitle')),
      meta: allTracks.length > 0 ? `${allTracks.length} songs` : undefined,
      description: this.headerDescription(header),
      thumbnails,
      tracks,
      allTracks: allTracks.length > 0 ? allTracks : undefined,
      sections: this.mapSections(rawSections.filter((section) => section !== topSongs)),
      totalTracks: allTracks.length > 0 ? allTracks.length : undefined
    }
  }

  private headerField(header: unknown, field: keyof PageHeaderFields): unknown {
    return (header as PageHeaderFields | undefined)?.[field]
  }

  private text(value: unknown): string | undefined {
    if (value === null || value === undefined) return undefined
    if (typeof value === 'string') {
      const trimmed = value.trim()
      return trimmed && trimmed.toUpperCase() !== 'N/A' ? trimmed : undefined
    }
    if (typeof value !== 'object') return undefined

    const stringifier = (value as { toString?: () => string }).toString
    if (typeof stringifier !== 'function') return undefined

    const text = stringifier.call(value).trim()
    return text && text !== '[object Object]' && text.toUpperCase() !== 'N/A' ? text : undefined
  }

  private parseTrackCount(value: string | undefined): number | undefined {
    if (!value) return undefined
    const match = value.match(/([\d][\d,.]*)\s+(?:songs?|tracks?)/i)
    if (!match) return undefined

    const count = Number(match[1].replace(/[^\d]/g, ''))
    return Number.isFinite(count) && count > 0 ? count : undefined
  }

  private headerThumbnails(header: unknown): MediaItem['thumbnails'] {
    const value = header as PageHeaderFields | undefined
    return this.mapThumbnails(value?.thumbnails ?? value?.thumbnail?.contents)
  }

  private headerDescription(header: unknown): string | undefined {
    const description = (header as PageHeaderFields | undefined)?.description
    if (!description) return undefined

    if (typeof description === 'object' && 'description' in description) {
      return this.text((description as { description?: unknown }).description)
    }

    return this.text(description)
  }

  private headerAuthor(header: unknown): ArtistRef | undefined {
    const value = header as PageHeaderFields | undefined
    const name = this.text(value?.strapline_text_one) ?? value?.author?.name
    if (!name) return undefined

    return {
      id: value?.strapline_text_one?.endpoint?.payload?.browseId ?? value?.author?.channel_id,
      name
    }
  }

  private sectionTitle(section: unknown): string | undefined {
    const value = section as MediaSection | undefined
    return this.text(value?.title) ?? this.text(value?.header?.title)
  }

  private mapSections(rawSections: unknown[] | undefined): CollectionSection[] {
    const sections: CollectionSection[] = []
    const seenTitles = new Set<string>()

    for (const raw of rawSections ?? []) {
      const title = this.sectionTitle(raw)
      if (!title || seenTitles.has(title)) continue

      const section = raw as MediaSection
      const seenItems = new Set<string>()
      const items = (section.contents ?? [])
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
    }

    return sections
  }

  private mapTracks(
    rawItems: unknown[] | undefined,
    fallback: {
      album?: AlbumRef
      artist?: ArtistRef
      thumbnails?: MediaItem['thumbnails']
      forceSong?: boolean
    } = {}
  ): MediaItem[] {
    return (rawItems ?? [])
      .map((raw) => this.mapTrack(raw, fallback))
      .filter((item): item is MediaItem => item !== null)
  }

  private mapTrack(
    raw: unknown,
    fallback: {
      album?: AlbumRef
      artist?: ArtistRef
      thumbnails?: MediaItem['thumbnails']
      forceSong?: boolean
    } = {}
  ): MediaItem | null {
    const item = this.mapItem(raw)
    if (!item || (item.kind !== 'song' && item.kind !== 'video')) return null

    return {
      ...item,
      kind: fallback.forceSong ? 'song' : item.kind,
      artists: item.artists.length > 0 ? item.artists : fallback.artist ? [fallback.artist] : [],
      album: item.album ?? fallback.album,
      thumbnails: item.thumbnails.length > 0 ? item.thumbnails : (fallback.thumbnails ?? [])
    }
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
      authors?: Array<{ channel_id?: string; name: string }>
      author?: { channel_id?: string; name: string }
      album?: { id?: string; name: string }
      flex_columns?: Array<{
        title?: {
          runs?: Array<{
            text?: string
            endpoint?: { payload?: { browseId?: string } }
          }>
        }
      }>
    }

    if (!item || (item.type !== 'MusicResponsiveListItem' && item.type !== 'MusicTwoRowItem')) {
      return null
    }

    const kind = item.item_type as MediaKind | undefined
    if (!kind || !['song', 'video', 'album', 'playlist', 'artist', 'podcast'].includes(kind)) {
      return null
    }

    const id = item.id
    const title = this.text(item.title) ?? item.name ?? ''
    if (!id || !title) return null

    const thumbnails = this.mapThumbnails(item.thumbnails ?? item.thumbnail)
    const artists =
      item.artists?.map((artist) => ({ id: artist.channel_id, name: artist.name })) ??
      item.authors?.map((artist) => ({ id: artist.channel_id, name: artist.name })) ??
      (item.author ? [{ id: item.author.channel_id, name: item.author.name }] : [])
    const flexAlbum = item.flex_columns
      ?.flatMap((column) => column.title?.runs ?? [])
      .find((run) => run.text && run.endpoint?.payload?.browseId?.startsWith('MPR'))
    const album = item.album
      ? { id: item.album.id, name: item.album.name }
      : flexAlbum?.text
        ? { id: flexAlbum.endpoint?.payload?.browseId, name: flexAlbum.text }
        : undefined
    const subtitle = this.text(item.subtitle)

    return {
      id,
      kind,
      title,
      subtitle: subtitle ?? artists.map((artist) => artist.name).join(' • '),
      artists,
      album,
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
