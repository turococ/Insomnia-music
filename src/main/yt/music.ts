import type { Innertube, Misc } from 'youtubei.js'
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
  SearchFilter,
  SearchMoreResult,
  SearchResult
} from '@shared/types'
import { APP_USER_AGENT } from './constants'
import { poTokenProvider } from './po-token'

const PLAYBACK_CLIENTS = ['YTMUSIC', 'IOS', 'ANDROID_VR'] as const
const STREAM_TTL_MS = 5 * 60 * 1000

type YtMusic = Innertube['music']
type YtSearch = Awaited<ReturnType<YtMusic['search']>>
type YtSearchContinuation = Awaited<ReturnType<YtSearch['getContinuation']>>
type SearchContext = YtSearch | YtSearchContinuation

interface CachedSource {
  source: PlaybackSource
  expiresAt: number
}

interface SearchCardFields {
  type?: string
  title?: unknown
  subtitle?: unknown
  thumbnail?: { contents?: unknown[] } | null
  on_tap?: {
    payload?: {
      browseId?: string
      videoId?: string
    }
  }
}

interface PageHeaderFields {
  title?: unknown
  subtitle?: unknown
  second_subtitle?: unknown
  year?: unknown
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
  private searchContexts = new Map<string, SearchContext>()
  private pendingSearchMore = new Map<string, Promise<SearchMoreResult>>()
  private albumYearCache = new Map<string, number>()

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

  async search(query: string, filter: SearchFilter = 'all'): Promise<SearchResult> {
    const trimmed = query.trim()
    if (!trimmed) return { query: '', filter, items: [], hasMore: false }

    const music = await this.music()
    const search = await music.search(trimmed, filter === 'all' ? undefined : { type: filter })
    const { topResult, items } = this.mapSearch(search)
    const key = this.searchKey(trimmed, filter)

    if (filter !== 'all') this.rememberSearchContext(key, search)

    return {
      query: trimmed,
      filter,
      topResult,
      items,
      hasMore: filter !== 'all' && search.has_continuation
    }
  }

  async searchMore(query: string, filter: SearchFilter): Promise<SearchMoreResult> {
    const trimmed = query.trim()
    if (!trimmed || filter === 'all') return { items: [], hasMore: false }

    const key = this.searchKey(trimmed, filter)
    const pending = this.pendingSearchMore.get(key)
    if (pending) return pending

    const task = this.loadMoreSearch(trimmed, filter, key).finally(() => {
      this.pendingSearchMore.delete(key)
    })
    this.pendingSearchMore.set(key, task)
    return task
  }

  private searchKey(query: string, filter: SearchFilter): string {
    return `${filter}:${query}`
  }

  private rememberSearchContext(key: string, context: SearchContext): void {
    this.searchContexts.delete(key)
    this.searchContexts.set(key, context)
    if (this.searchContexts.size <= 24) return

    const oldestKey = this.searchContexts.keys().next().value
    if (oldestKey) this.searchContexts.delete(oldestKey)
  }

  private async loadMoreSearch(
    query: string,
    filter: SearchFilter,
    key: string
  ): Promise<SearchMoreResult> {
    const context = this.searchContexts.get(key)

    if (!context) {
      // The main process may have restarted since the first page was loaded.
      // Recover the context, then let the renderer deduplicate the repeated items.
      const initial = await this.search(query, filter)
      return { items: initial.items, hasMore: initial.hasMore }
    }

    if (!context.has_continuation) return { items: [], hasMore: false }

    const next = await context.getContinuation()
    this.rememberSearchContext(key, next)

    const contents = (next.contents as { contents?: unknown[] } | undefined)?.contents
    return {
      items: this.mapSearchItems(contents),
      hasMore: next.has_continuation
    }
  }

  private mapSearch(search: YtSearch): { topResult?: MediaItem; items: MediaItem[] } {
    let topResult: MediaItem | undefined
    const rawItems: unknown[] = []

    for (const section of search.contents ?? []) {
      const value = section as { type?: string; contents?: unknown[] }

      if (value.type === 'MusicCardShelf') {
        if (!topResult) topResult = this.mapSearchCard(section)
        continue
      }

      if (value.type === 'MusicShelf' || value.type === 'ItemSection') {
        rawItems.push(...(value.contents ?? []))
      }
    }

    const items = this.mapSearchItems(rawItems)

    if (!topResult) return { items }

    const match = items.find((item) => item.kind === topResult?.kind && item.id === topResult?.id)
    if (match) {
      topResult = {
        ...topResult,
        artists: topResult.artists.length > 0 ? topResult.artists : match.artists,
        album: topResult.album ?? match.album,
        year: topResult.year ?? match.year,
        plays: topResult.plays ?? match.plays,
        duration: topResult.duration ?? match.duration,
        thumbnails: topResult.thumbnails.length > 0 ? topResult.thumbnails : match.thumbnails
      }
    }

    const topKey = `${topResult.kind}:${topResult.id}`
    return {
      topResult,
      items: items.filter((item) => `${item.kind}:${item.id}` !== topKey)
    }
  }

  private mapSearchItems(rawItems: unknown[] | undefined): MediaItem[] {
    const seen = new Set<string>()
    const items: MediaItem[] = []

    for (const raw of rawItems ?? []) {
      const item = this.mapItem(raw)
      if (!item) continue

      // YouTube Music mixes user profiles into artist searches. They are not
      // artist pages and cannot be opened by the artist route.
      if (item.kind === 'artist' && item.subtitle?.toLowerCase().startsWith('profile')) continue

      const key = `${item.kind}:${item.id}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
    }

    return items
  }

  private mapSearchCard(raw: unknown): MediaItem | undefined {
    const card = raw as SearchCardFields
    const title = this.text(card.title)
    const subtitle = this.text(card.subtitle)
    const payload = card.on_tap?.payload
    const browseId = payload?.browseId
    const videoId = payload?.videoId
    const kind = this.searchCardKind(subtitle, browseId, videoId)

    if (!kind || !title) return undefined
    if (kind === 'artist' && subtitle?.toLowerCase().startsWith('profile')) return undefined

    const id = kind === 'song' || kind === 'video' ? videoId : browseId
    if (!id) return undefined

    const parts =
      subtitle
        ?.split('•')
        .map((part) => part.trim())
        .filter(Boolean) ?? []
    const artistName = parts[1]
    const artists =
      artistName &&
      kind !== 'artist' &&
      !/^[\d.,]+\s*[KMB]?\s+(?:views|plays|subscribers)/i.test(artistName)
        ? [{ name: artistName }]
        : []
    const year = this.parseYear(parts.at(-1))
    const plays = parts
      .map((part) => this.parseCompactNumber(part))
      .find((value): value is number => value !== undefined)

    return {
      id,
      kind,
      title,
      subtitle,
      artists,
      year: year ? String(year) : undefined,
      plays,
      duration: this.parseDurationText(subtitle),
      thumbnails: this.mapThumbnails(card.thumbnail?.contents)
    }
  }

  private searchCardKind(
    subtitle: string | undefined,
    browseId: string | undefined,
    videoId: string | undefined
  ): MediaKind | undefined {
    const type = subtitle?.split('•')[0]?.trim().toLowerCase() ?? ''

    if (type.startsWith('artist')) return 'artist'
    if (type.startsWith('album') || type.startsWith('single') || type === 'ep') return 'album'
    if (type.startsWith('playlist')) return 'playlist'
    if (type.startsWith('song')) return 'song'
    if (type.startsWith('video')) return 'video'
    if (type.startsWith('podcast')) return 'podcast'

    if (videoId) return 'video'
    if (browseId?.startsWith('UC')) return 'artist'
    if (browseId?.startsWith('MPR')) return 'album'
    if (browseId?.startsWith('VL')) return 'playlist'
    return undefined
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

  async albumYears(ids: string[]): Promise<Record<string, number>> {
    const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))].slice(
      0,
      300
    )
    const result: Record<string, number> = {}
    const missing: string[] = []

    for (const id of unique) {
      const cached = this.albumYearCache.get(id)
      if (cached) result[id] = cached
      else missing.push(id)
    }

    if (missing.length === 0) return result

    const music = await this.music()
    let cursor = 0
    const worker = async (): Promise<void> => {
      while (cursor < missing.length) {
        const id = missing[cursor]
        cursor += 1

        try {
          const album = await music.getAlbum(id)
          const year = this.albumYear(album.header)
          if (year) {
            this.albumYearCache.set(id, year)
            result[id] = year
          }
        } catch (error) {
          console.warn(
            `[collection] could not load album year for ${id}:`,
            error instanceof Error ? error.message : error
          )
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(4, missing.length) }, () => worker()))
    return result
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
    const sectionAlbumYears = this.sectionAlbumYears(rawSections)
    const fallback = {
      artist: { id, name: title },
      thumbnails,
      forceSong: true
    }
    let tracks = this.applyTrackYears(this.mapTracks(topSongsItems, fallback), sectionAlbumYears)
    let allTracks: MediaItem[] = []

    try {
      const allSongs = await artist.getAllSongs?.()
      if (allSongs) {
        allTracks = this.applyTrackYears(
          this.mapTracks(allSongs.contents, fallback),
          sectionAlbumYears
        )
      }
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
          year: track.year ?? full.year,
          plays: track.plays ?? full.plays,
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

  private parseYear(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value !== 'string') return undefined

    const match = value.match(/\b(19|20)\d{2}\b/)
    if (!match) return undefined

    const year = Number(match[0])
    return year >= 1900 && year <= new Date().getFullYear() + 1 ? year : undefined
  }

  private parseCompactNumber(value: string | undefined): number | undefined {
    if (!value) return undefined

    const match = value.trim().match(/^([\d.,]+)\s*([KMB])?\s+plays?$/i)
    if (!match) return undefined

    const amount = Number(match[1].replace(/,/g, ''))
    if (!Number.isFinite(amount)) return undefined

    const suffix = match[2]?.toUpperCase()
    const multiplier =
      suffix === 'B' ? 1_000_000_000 : suffix === 'M' ? 1_000_000 : suffix === 'K' ? 1_000 : 1
    return Math.round(amount * multiplier)
  }

  private parseDurationText(value: string | undefined): number | undefined {
    if (!value) return undefined

    const match = value.match(/\b(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)\b/)
    if (!match) return undefined

    const hours = match[1] ? Number(match[1]) : 0
    const minutes = Number(match[2])
    const seconds = Number(match[3])
    return hours * 3600 + minutes * 60 + seconds
  }

  private albumYear(header: unknown): number | undefined {
    const direct = this.parseYear(this.headerField(header, 'year'))
    if (direct) return direct

    return this.parseYear(this.text(this.headerField(header, 'subtitle')))
  }

  private sectionAlbumYears(sections: unknown[]): Map<string, number> {
    const years = new Map<string, number>()

    for (const section of sections) {
      for (const item of (section as MediaSection | undefined)?.contents ?? []) {
        const value = item as { item_type?: string; id?: string; year?: unknown }
        if (value.item_type !== 'album' || !value.id) continue

        const year = this.parseYear(value.year)
        if (year) years.set(value.id, year)
      }
    }

    return years
  }

  private applyTrackYears(tracks: MediaItem[], years: Map<string, number>): MediaItem[] {
    return tracks.map((track) => {
      if (track.year || !track.album?.id) return track

      const year = years.get(track.album.id)
      return year ? { ...track, year: String(year) } : track
    })
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

  private chooseAudioFormat(info: Awaited<ReturnType<Innertube['getInfo']>>): Misc.Format {
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
    const plays = item.flex_columns
      ?.flatMap((column) => column.title?.runs ?? [])
      .map((run) => this.parseCompactNumber(run.text))
      .find((value): value is number => value !== undefined)
    const subtitle = this.text(item.subtitle)

    return {
      id,
      kind,
      title,
      subtitle: subtitle ?? artists.map((artist) => artist.name).join(' • '),
      artists,
      album,
      year: item.year,
      plays,
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
