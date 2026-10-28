import { randomUUID } from 'node:crypto'
import type { Innertube, Misc, YTNodes } from 'youtubei.js'
import type {
  AccountProfile,
  AlbumRef,
  ArtistRef,
  AudioQuality,
  CollectionData,
  CollectionKind,
  CollectionLibraryState,
  CollectionSection,
  CollectionTrackPage,
  CreatedPlaylist,
  LibraryListData,
  LibraryListKind,
  LyricsQuery,
  LyricsResult,
  MediaItem,
  MediaKind,
  PlaybackSource,
  PlaylistChoice,
  PlaylistChoices,
  HomeData,
  HomeSection,
  SearchFilter,
  SearchMoreResult,
  SearchResult,
  SearchTopAction,
  SearchTopActionKind,
  SearchTopActionQueue,
  SearchTopResult,
  UpNextPage,
  UpNextQueue
} from '@shared/types'
import { authService } from '../auth'
import { fetchLrclibLyrics } from '../lyrics'
import { getSettings } from '../settings'
import { APP_USER_AGENT } from './constants'
import { poTokenProvider } from './po-token'

const PLAYBACK_CLIENTS = ['YTMUSIC', 'IOS', 'ANDROID_VR'] as const
const STREAM_TTL_MS = 5 * 60 * 1000
const MAX_ARTIST_PAGES = 100
const LIBRARY_BROWSE_IDS: Record<LibraryListKind, string> = {
  playlists: 'FEmusic_liked_playlists',
  albums: 'FEmusic_liked_albums',
  artists: 'FEmusic_library_corpus_track_artists'
}
const LIBRARY_ITEM_KINDS: Record<LibraryListKind, MediaKind> = {
  playlists: 'playlist',
  albums: 'album',
  artists: 'artist'
}

type YtMusic = Innertube['music']
type YtSearch = Awaited<ReturnType<YtMusic['search']>>
type YtSearchContinuation = Awaited<ReturnType<YtSearch['getContinuation']>>
type SearchContext = YtSearch | YtSearchContinuation
type YtEndpoint = Parameters<YtMusic['getInfo']>[0]
type YtTrackInfo = Awaited<ReturnType<YtMusic['getInfo']>>
type YtPlaylistPanel = Awaited<ReturnType<YtTrackInfo['getUpNext']>>
type YtPlaylistPanelContinuation = Awaited<ReturnType<YtTrackInfo['getUpNextContinuation']>>

interface UpNextSession {
  info: YtTrackInfo
  panel: YtPlaylistPanel | YtPlaylistPanelContinuation
  endpoint: YTNodes.NavigationEndpoint | null
  continuation: string | null
}

interface CachedSource {
  source: PlaybackSource
  expiresAt: number
}

interface SearchCardFields {
  type?: string
  title?: unknown
  subtitle?: unknown
  thumbnail?: { contents?: unknown[] } | null
  contents?: unknown[]
  buttons?: Array<{
    text?: unknown
    icon_type?: string
    endpoint?: unknown
  }>
  on_tap?: {
    payload?: {
      browseId?: string
      videoId?: string
    }
  }
}

interface PlaylistPanelVideoFields {
  type?: string
  video_id?: string
  title?: unknown
  thumbnail?: unknown[]
  duration?: { seconds?: number }
  author?: string
  album?: { id?: string; name: string; year?: string }
  artists?: Array<{ name: string; channel_id?: string }>
  endpoint?: { payload?: { videoId?: string } }
}

interface TopActionEndpoint {
  endpoint: YtEndpoint
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
  continuation?: unknown
}

interface ContinuationItemNode {
  type?: string
  endpoint?: {
    payload?: {
      token?: string
    }
  }
}

interface ArtistContinuationResponse {
  on_response_received_actions?: Array<{
    contents?: unknown[]
  }>
  continuation_contents?: {
    contents?: unknown[]
    continuation?: unknown
  }
}

interface PlaylistContext {
  page: PlaylistPage
  thumbnails: MediaItem['thumbnails']
}

interface CollectionSaveContext {
  saved: boolean
  canSave: boolean
  canEdit: boolean
  targetPlaylistId?: string
  channelId?: string
}

interface HeaderButtonNode {
  icon_type?: string
  is_toggled?: boolean
  endpoint?: {
    name?: string
    payload?: { target?: { playlistId?: string } }
  }
  toggled_endpoint?: {
    name?: string
    payload?: { target?: { playlistId?: string } }
  }
  menu?: { items?: unknown[] }
}

interface SubscriptionNode {
  subscribed?: boolean
  channel_id?: string
}

interface EditableHeaderNode {
  constructor?: { name?: string }
  header?: unknown
  edit_header?: unknown
  buttons?: unknown[]
  subscription_button?: SubscriptionNode
}

interface LibraryBrowseResponse {
  contents_memo?: Map<string, unknown[]>
  continuation_contents?: {
    contents?: unknown[] | null
    items?: unknown[] | null
    continuation?: string | null
  } | null
}

interface LibraryListContext {
  continuation?: string
}

interface AccountItemFields {
  account_name?: unknown
  account_photo?: Array<{ url?: string }>
  channel_handle?: unknown
  is_selected?: boolean
  endpoint?: {
    payload?: {
      browseId?: string
    }
  }
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
  private topActionEndpoints = new Map<string, TopActionEndpoint>()
  private albumYearCache = new Map<string, number>()
  private accountProfile: AccountProfile | null | undefined
  private libraryContexts = new Map<LibraryListKind, LibraryListContext>()
  private pendingLibraryMore = new Map<LibraryListKind, Promise<LibraryListData>>()
  private collectionSaveContexts = new Map<string, CollectionSaveContext>()
  private playlistPickerContext: LibraryListContext = {}
  private upNextSessions = new Map<string, UpNextSession>()

  async init(): Promise<Innertube> {
    if (this.yt) return this.yt
    if (this.initPromise) return this.initPromise

    const task = (async () => {
      const mod = await import('youtubei.js')

      // youtubei.js needs an evaluator to decipher the player's signature.
      mod.Platform.shim.eval = async (data: { output: string }) => new Function(data.output)()
      // The parser JIT logs every unknown renderer as an error even though it
      // recovers automatically. Keep the console clean for now.
      mod.Log.setLevel(mod.Log.Level.NONE)

      const cookie = await authService.cookieHeader()
      const yt = await mod.Innertube.create({
        lang: 'en',
        location: 'US',
        user_agent: APP_USER_AGENT,
        retrieve_player: true,
        cookie
      })

      this.yt = yt
      return yt
    })()

    this.initPromise = task.catch((error) => {
      this.initPromise = null
      throw error
    })
    return this.initPromise
  }

  async reloadSession(): Promise<void> {
    this.yt = null
    this.initPromise = null
    this.accountProfile = undefined
    this.sourceCache.clear()
    this.pendingSources.clear()
    this.playlistContexts.clear()
    this.pendingCollectionMore.clear()
    this.searchContexts.clear()
    this.pendingSearchMore.clear()
    this.topActionEndpoints.clear()
    this.albumYearCache.clear()
    this.libraryContexts.clear()
    this.pendingLibraryMore.clear()
    this.collectionSaveContexts.clear()
    this.playlistPickerContext = {}
    this.upNextSessions.clear()

    await this.init()
  }

  private async getYt(): Promise<Innertube> {
    return this.yt ?? this.init()
  }

  private async music(): Promise<YtMusic> {
    return (await this.getYt()).music
  }

  async isSignedIn(): Promise<boolean> {
    return (await this.getYt()).session.logged_in
  }

  async account(): Promise<AccountProfile | null> {
    if (this.accountProfile !== undefined) return this.accountProfile

    const yt = await this.getYt()
    if (!yt.session.logged_in) {
      this.accountProfile = null
      return null
    }

    let fallback: AccountProfile | null = null

    try {
      const items = await yt.account.getInfo(true)
      for (const item of items) {
        const profile = this.mapAccountItem(item)
        if (!profile) continue
        if ((item as AccountItemFields).is_selected) {
          this.accountProfile = profile
          return profile
        }
        fallback ??= profile
      }
    } catch (error) {
      console.warn(
        '[auth] could not load the account switcher:',
        error instanceof Error ? error.message : error
      )
    }

    if (fallback) {
      this.accountProfile = fallback
      return fallback
    }

    try {
      const info = await yt.account.getInfo()
      for (const item of info.contents?.contents ?? []) {
        const profile = this.mapAccountItem(item)
        if (!profile) continue
        if ((item as AccountItemFields).is_selected) {
          this.accountProfile = profile
          return profile
        }
        fallback ??= profile
      }
    } catch (error) {
      console.warn(
        '[auth] could not load account details:',
        error instanceof Error ? error.message : error
      )
    }

    this.accountProfile = fallback
    return fallback
  }

  private mapAccountItem(raw: unknown): AccountProfile | null {
    const item = raw as AccountItemFields
    const name = this.text(item.account_name)
    if (!name) return null

    const avatarUrl = item.account_photo?.find((photo) => photo.url)?.url
    const handle = this.text(item.channel_handle)
    const browseId = item.endpoint?.payload?.browseId

    return {
      name,
      handle,
      avatarUrl,
      channelId: browseId?.startsWith('UC') ? browseId : undefined
    }
  }

  async libraryList(kind: LibraryListKind): Promise<LibraryListData> {
    const yt = await this.requireSignedIn()
    const response = (await yt.actions.execute('/browse', {
      browseId: LIBRARY_BROWSE_IDS[kind],
      client: 'YTMUSIC',
      parse: true
    })) as unknown as LibraryBrowseResponse

    const result = this.mapLibraryResponse(response, kind)
    this.libraryContexts.set(kind, { continuation: result.continuation })

    return { items: result.items, hasMore: Boolean(result.continuation) }
  }

  async libraryMore(kind: LibraryListKind): Promise<LibraryListData> {
    const pending = this.pendingLibraryMore.get(kind)
    if (pending) return pending

    const task = this.loadMoreLibrary(kind).finally(() => {
      this.pendingLibraryMore.delete(kind)
    })
    this.pendingLibraryMore.set(kind, task)
    return task
  }

  private async loadMoreLibrary(kind: LibraryListKind): Promise<LibraryListData> {
    const context = this.libraryContexts.get(kind)
    if (!context?.continuation) return { items: [], hasMore: false }

    const yt = await this.requireSignedIn()
    const response = (await yt.actions.execute('/browse', {
      client: 'YTMUSIC',
      continuation: context.continuation,
      parse: true
    })) as unknown as LibraryBrowseResponse

    const result = this.mapLibraryResponse(response, kind)
    this.libraryContexts.set(kind, { continuation: result.continuation })

    return { items: result.items, hasMore: Boolean(result.continuation) }
  }

  private async requireSignedIn(): Promise<Innertube> {
    const yt = await this.getYt()
    if (!yt.session.logged_in) {
      throw new Error('Sign in to YouTube Music to view your library.')
    }
    return yt
  }

  private libraryRawItems(response: LibraryBrowseResponse): unknown[] {
    const memo = response.contents_memo
    const rawItems: unknown[] = []
    const seenRaw = new Set<unknown>()

    for (const listType of ['Grid', 'MusicShelf', 'MusicCarouselShelf']) {
      for (const list of memo?.get(listType) ?? []) {
        const value = list as { contents?: unknown[] | null; items?: unknown[] | null }
        for (const item of value.contents ?? value.items ?? []) {
          if (seenRaw.has(item)) continue
          seenRaw.add(item)
          rawItems.push(item)
        }
      }
    }

    if (rawItems.length === 0) {
      const continuation = response.continuation_contents
      for (const item of continuation?.contents ?? continuation?.items ?? []) {
        if (seenRaw.has(item)) continue
        seenRaw.add(item)
        rawItems.push(item)
      }
    }

    if (rawItems.length === 0 && memo) {
      for (const itemType of ['MusicTwoRowItem', 'MusicResponsiveListItem']) {
        for (const item of memo.get(itemType) ?? []) {
          if (seenRaw.has(item)) continue
          seenRaw.add(item)
          rawItems.push(item)
        }
      }
    }

    return rawItems
  }

  private mapLibraryResponse(
    response: LibraryBrowseResponse,
    kind: LibraryListKind
  ): { items: MediaItem[]; continuation?: string } {
    const rawItems = this.libraryRawItems(response)
    const expectedKind = LIBRARY_ITEM_KINDS[kind]
    const seen = new Set<string>()
    const items: MediaItem[] = []

    for (const raw of rawItems) {
      const item = this.mapItem(raw)
      if (!item || item.kind !== expectedKind) continue

      const key = `${item.kind}:${item.id}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
    }

    return { items, continuation: this.libraryContinuation(response) }
  }

  private libraryContinuation(response: LibraryBrowseResponse): string | undefined {
    const continuation = response.continuation_contents?.continuation
    if (typeof continuation === 'string' && continuation.length > 0) return continuation

    const memo = response.contents_memo
    for (const listType of ['Grid', 'MusicShelf', 'MusicCarouselShelf']) {
      for (const list of memo?.get(listType) ?? []) {
        const token = (list as { continuation?: unknown }).continuation
        if (typeof token === 'string' && token.length > 0) return token
      }
    }

    return this.continuationToken(memo?.get('ContinuationItem'))
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

  async topResultAction(actionId: string): Promise<SearchTopActionQueue> {
    const action = this.topActionEndpoints.get(actionId)
    if (!action) throw new Error('This top result action expired. Search again.')

    const music = await this.music()
    const info = await music.getInfo(action.endpoint)
    const panel = await info.getUpNext()
    const items = this.mapPlaylistPanel(panel.contents)

    if (items.length === 0) throw new Error('Could not start this mix.')

    return { items, title: this.text(panel.title) }
  }

  /**
   * Recommendations for a track. Used to keep playback going when the queue
   * runs out and to start a radio station from the current song.
   */
  async upNext(videoId: string, automix = false): Promise<UpNextQueue> {
    const yt = await this.getYt()
    const music = yt.music
    const info = await music.getInfo(videoId)
    const panel = await info.getUpNext(false)

    let resolved: YtPlaylistPanel = panel
    let endpoint: YTNodes.NavigationEndpoint | null = null

    // The watch-next panel is a finite snapshot. Automix exposes the actual
    // radio station, and keeping its endpoint is what lets us page it forever.
    if (automix && !panel.playlist_id) {
      const automixVideo = panel.contents.find((item) => item.type === 'AutomixPreviewVideo') as
        { playlist_video?: { endpoint?: YTNodes.NavigationEndpoint } } | undefined
      const automixEndpoint = automixVideo?.playlist_video?.endpoint
      if (!automixEndpoint) throw new Error('Automix item not found')

      const page = await automixEndpoint.call(yt.actions, {
        videoId,
        client: 'YTMUSIC',
        parse: true
      })
      const automixPanel = page.contents_memo?.get('PlaylistPanel')?.[0] as
        YtPlaylistPanel | undefined
      if (!automixPanel) throw new Error('Could not fetch automix')

      resolved = automixPanel
      endpoint = automixEndpoint
    }

    const items = this.mapPlaylistPanel(resolved.contents)
    const sessionId = randomUUID()

    this.upNextSessions.set(sessionId, {
      info,
      panel: resolved,
      endpoint,
      continuation: resolved.continuation || null
    })
    this.pruneUpNextSessions()

    return {
      items,
      sessionId,
      title: this.text(resolved.title) || undefined,
      hasMore: Boolean(resolved.continuation)
    }
  }

  /** Next page of an up-next radio started by {@link upNext}. */
  async upNextMore(sessionId: string): Promise<UpNextPage> {
    const session = this.upNextSessions.get(sessionId)
    if (!session) throw new Error('This radio session expired. Start the radio again.')
    if (!session.continuation) return { items: [], hasMore: false }

    try {
      let items: MediaItem[]
      let continuation: string | null

      if (session.endpoint) {
        // Continue the automix station through the same endpoint that produced
        // it. TrackInfo's watch-next continuation expects a different playlist.
        const yt = await this.getYt()
        const page = await session.endpoint.call(yt.actions, {
          continuation: session.continuation,
          client: 'YTMUSIC',
          parse: true
        })
        const node = page.continuation_contents
        if (!node || node.type !== 'playlistPanelContinuation') {
          throw new Error('No playlist continuation available.')
        }

        const next = node as YtPlaylistPanelContinuation
        items = this.mapPlaylistPanel(next.contents)
        continuation = next.continuation || null
        session.panel = next
      } else {
        const next = await session.info.getUpNextContinuation(session.panel)
        items = this.mapPlaylistPanel(next.contents)
        continuation = next.continuation || null
        session.panel = next
      }

      session.continuation = continuation
      return { items, hasMore: Boolean(continuation) }
    } catch (error) {
      this.upNextSessions.delete(sessionId)
      throw error
    }
  }

  private pruneUpNextSessions(): void {
    while (this.upNextSessions.size > 24) {
      const oldest = this.upNextSessions.keys().next().value
      if (!oldest) break
      this.upNextSessions.delete(oldest)
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

  private mapSearch(search: YtSearch): { topResult?: SearchTopResult; items: MediaItem[] } {
    let topResult: SearchTopResult | undefined
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

    const { item } = topResult
    const match = items.find(
      (candidate) => candidate.kind === item.kind && candidate.id === item.id
    )
    if (match) {
      topResult = {
        ...topResult,
        item: {
          ...item,
          artists: item.artists.length > 0 ? item.artists : match.artists,
          album: item.album ?? match.album,
          year: item.year ?? match.year,
          plays: item.plays ?? match.plays,
          duration: item.duration ?? match.duration,
          thumbnails: item.thumbnails.length > 0 ? item.thumbnails : match.thumbnails
        }
      }
    }

    const topKey = `${item.kind}:${item.id}`
    return {
      topResult,
      items: items.filter((candidate) => `${candidate.kind}:${candidate.id}` !== topKey)
    }
  }

  private rememberTopAction(actionId: string, endpoint: YtEndpoint): void {
    this.topActionEndpoints.delete(actionId)
    this.topActionEndpoints.set(actionId, { endpoint })
    if (this.topActionEndpoints.size <= 64) return

    const oldestKey = this.topActionEndpoints.keys().next().value
    if (oldestKey) this.topActionEndpoints.delete(oldestKey)
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

  private mapSearchCard(raw: unknown): SearchTopResult | undefined {
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
    const item: MediaItem = {
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

    const topTracks =
      kind === 'artist'
        ? this.mapSearchItems(card.contents)
            .filter((track) => track.kind === 'song' || track.kind === 'video')
            .slice(0, 3)
            .map((track) =>
              track.artists.length > 0 ? track : { ...track, artists: [{ id, name: title }] }
            )
        : []

    return {
      item,
      tracks: topTracks,
      actions: this.mapSearchActions(card.buttons)
    }
  }

  private mapSearchActions(buttons: SearchCardFields['buttons']): SearchTopAction[] {
    const actions: SearchTopAction[] = []
    const seen = new Set<SearchTopActionKind>()

    for (const button of buttons ?? []) {
      const kind = this.searchActionKind(button)
      if (!kind || seen.has(kind) || !button.endpoint) continue

      const actionId = randomUUID()
      this.rememberTopAction(actionId, button.endpoint as YtEndpoint)
      seen.add(kind)
      actions.push({ id: actionId, kind })
    }

    return actions
  }

  private searchActionKind(button: {
    text?: unknown
    icon_type?: string
  }): SearchTopActionKind | undefined {
    const icon = button.icon_type?.toUpperCase()
    const text = this.text(button.text)?.toLowerCase()

    if (icon === 'MUSIC_SHUFFLE' || text === 'shuffle') return 'shuffle'
    if (icon === 'MIX' || text === 'mix') return 'mix'
    return undefined
  }

  private mapPlaylistPanel(contents: unknown[] | undefined): MediaItem[] {
    const items: MediaItem[] = []

    for (const raw of contents ?? []) {
      const value = raw as { type?: string; primary?: unknown }
      if (value.type === 'PlaylistPanelVideoWrapper') {
        const item = this.mapPlaylistPanelVideo(value.primary)
        if (item) items.push(item)
        continue
      }

      const item = this.mapPlaylistPanelVideo(raw)
      if (item) items.push(item)
    }

    return items
  }

  private mapPlaylistPanelVideo(raw: unknown): MediaItem | null {
    const value = raw as PlaylistPanelVideoFields
    if (value.type !== 'PlaylistPanelVideo') return null

    const id = value.video_id ?? value.endpoint?.payload?.videoId
    const title = this.text(value.title)
    if (!id || !title) return null

    const artists =
      value.artists?.map((artist) => ({ id: artist.channel_id, name: artist.name })) ??
      (value.author ? [{ name: value.author }] : [])
    const album = value.album ? { id: value.album.id, name: value.album.name } : undefined

    return {
      id,
      kind: 'song',
      title,
      subtitle: artists.map((artist) => artist.name).join(' • ') || value.author,
      artists,
      album,
      year: value.album?.year,
      duration: value.duration?.seconds,
      thumbnails: this.mapThumbnails(value.thumbnail)
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
        if (id.startsWith('MPLAU')) return this.mapLibraryArtist(id)
        return this.mapArtist(await music.getArtist(id), id)
    }
  }

  private async mapLibraryArtist(id: string): Promise<CollectionData> {
    const yt = await this.requireSignedIn()
    const response = (await yt.actions.execute('/browse', {
      browseId: id,
      client: 'YTMUSIC',
      parse: true
    })) as unknown as LibraryBrowseResponse

    const shelves = response.contents_memo?.get('MusicShelf') ?? []
    const shelf = shelves[0] as
      | {
          contents?: unknown[]
          bottom_button?: { endpoint?: { payload?: { browseId?: string } } }
        }
      | undefined
    const tracks = (shelf?.contents ?? [])
      .map((item) => this.mapItem(item))
      .filter(
        (item): item is MediaItem =>
          item !== null && (item.kind === 'song' || item.kind === 'video')
      )

    const channelId = shelf?.bottom_button?.endpoint?.payload?.browseId
    const artistName =
      tracks
        .flatMap((track) => track.artists)
        .find((artist) => (channelId ? artist.id === channelId : Boolean(artist.name)))?.name ??
      tracks[0]?.artists[0]?.name ??
      'Artist'

    return {
      id,
      kind: 'artist',
      title: artistName,
      subtitle: `${tracks.length} ${tracks.length === 1 ? 'song' : 'songs'} in your library`,
      meta: 'From your library',
      description: 'Songs from this artist in your YouTube Music library.',
      author: channelId ? { id: channelId, name: artistName } : { name: artistName },
      thumbnails: [],
      tracks,
      allTracks: tracks,
      sections: [],
      hasMore: false,
      totalTracks: tracks.length
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
      totalTracks: this.parseTrackCount(meta),
      library: this.mapCollectionSave('album', id, header)
    }
  }

  private async mapPlaylist(playlist: PlaylistPage, id: string): Promise<CollectionData> {
    const header = playlist.header
    const title =
      this.text(this.headerField(header, 'title')) ?? (id === 'LM' ? 'Liked Music' : 'Playlist')
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
      totalTracks: this.parseTrackCount(meta),
      library: this.mapCollectionSave('playlist', id, header)
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
    let allTracksHasMore = false

    try {
      const allSongs = await artist.getAllSongs?.()
      if (allSongs) {
        const result = await this.loadAllArtistSongs(allSongs, fallback)
        allTracks = this.applyTrackYears(result.tracks, sectionAlbumYears)
        allTracksHasMore = result.hasMore
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
      hasMore: allTracksHasMore,
      totalTracks: allTracks.length > 0 ? allTracks.length : undefined,
      library: this.mapCollectionSave('artist', id, header)
    }
  }

  private async loadAllArtistSongs(
    shelf: MediaSection,
    fallback: {
      album?: AlbumRef
      artist?: ArtistRef
      thumbnails?: MediaItem['thumbnails']
      forceSong?: boolean
    }
  ): Promise<{ tracks: MediaItem[]; hasMore: boolean }> {
    const tracks = this.mapTracks(shelf.contents, fallback)
    const seen = new Set(tracks.map((track) => track.id))
    let continuation = this.continuationToken(shelf.contents, shelf.continuation)
    let pages = 0

    while (continuation && pages < MAX_ARTIST_PAGES) {
      pages += 1

      let response: ArtistContinuationResponse
      try {
        response = await this.fetchArtistContinuation(continuation)
      } catch (error) {
        console.warn(
          `[collection] artist songs continuation failed after ${pages} page(s):`,
          error instanceof Error ? error.message : error
        )
        return { tracks, hasMore: true }
      }

      const contents = this.artistContinuationContents(response)
      for (const track of this.mapTracks(contents, fallback)) {
        if (seen.has(track.id)) continue
        seen.add(track.id)
        tracks.push(track)
      }

      continuation =
        this.continuationToken(contents, response.continuation_contents?.continuation) ?? undefined
    }

    return { tracks, hasMore: Boolean(continuation) }
  }

  private async fetchArtistContinuation(token: string): Promise<ArtistContinuationResponse> {
    const yt = await this.getYt()
    let lastError: unknown

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return (await yt.actions.execute('/browse', {
          client: 'YTMUSIC',
          continuation: token,
          parse: true
        })) as ArtistContinuationResponse
      } catch (error) {
        lastError = error
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 700))
      }
    }

    throw lastError
  }

  private artistContinuationContents(response: ArtistContinuationResponse): unknown[] {
    const fromActions = (response.on_response_received_actions ?? []).flatMap(
      (action) => action.contents ?? []
    )
    const fromContinuation = response.continuation_contents?.contents ?? []
    return [...fromActions, ...fromContinuation]
  }

  private continuationToken(
    contents: unknown[] | undefined,
    fallback?: unknown
  ): string | undefined {
    if (typeof fallback === 'string' && fallback.length > 0) return fallback

    for (const raw of contents ?? []) {
      const item = raw as ContinuationItemNode
      if (item.type !== 'ContinuationItem') continue

      const token = item.endpoint?.payload?.token
      if (typeof token === 'string' && token.length > 0) return token
    }

    return undefined
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

  private mapCollectionSave(
    kind: CollectionKind,
    id: string,
    header: unknown
  ): CollectionLibraryState {
    const raw = header as EditableHeaderNode | undefined
    const wrapper = raw?.constructor?.name === 'MusicEditablePlaylistDetailHeader'
    const nodes = (wrapper ? [raw?.header, raw?.edit_header] : [raw]).filter(
      (node): node is EditableHeaderNode => Boolean(node)
    )
    const buttons = nodes.flatMap((node) =>
      Array.isArray(node.buttons) ? (node.buttons as HeaderButtonNode[]) : []
    )
    const subscription = nodes
      .map((node) => node.subscription_button)
      .find((button): button is SubscriptionNode => Boolean(button?.channel_id))

    let saved = false
    let canSave = false
    let canEdit = wrapper
    let targetPlaylistId: string | undefined

    for (const button of buttons) {
      if (!button) continue
      if (button.icon_type === 'EDIT') canEdit = true
      if (button.icon_type !== 'BOOKMARK_BORDER' && button.icon_type !== 'BOOKMARK') continue

      const target =
        button.endpoint?.payload?.target?.playlistId ??
        button.toggled_endpoint?.payload?.target?.playlistId
      if (!target) continue

      canSave = true
      saved = Boolean(button.is_toggled)
      targetPlaylistId = target
    }

    if (kind === 'artist' && subscription) {
      canSave = true
      saved = Boolean(subscription.subscribed)
    }

    this.collectionSaveContexts.set(`${kind}:${id}`, {
      saved,
      canSave,
      canEdit,
      targetPlaylistId,
      channelId: kind === 'artist' ? subscription?.channel_id : undefined
    })

    return { saved, canSave, canEdit }
  }

  private async collectionSaveContext(
    kind: CollectionKind,
    id: string
  ): Promise<CollectionSaveContext> {
    const key = `${kind}:${id}`
    const cached = this.collectionSaveContexts.get(key)
    if (cached) return cached

    const music = await this.music()
    const page =
      kind === 'album'
        ? await music.getAlbum(id)
        : kind === 'playlist'
          ? await music.getPlaylist(id)
          : await music.getArtist(id)

    this.mapCollectionSave(kind, id, page.header)
    const context = this.collectionSaveContexts.get(key)
    if (!context) throw new Error('This page does not expose library actions.')
    return context
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

  async lyrics(query: LyricsQuery): Promise<LyricsResult | null> {
    const [youtube, lrclib] = await Promise.all([
      this.youtubeLyrics(query.id),
      fetchLrclibLyrics(query)
    ])

    // LRCLIB is the only source with timed lines, so it wins whenever a
    // synced match exists. Otherwise YouTube Music's plain lyrics are the
    // preferred fallback, then LRCLIB's plain text.
    if (lrclib?.synced) {
      return {
        source: 'lrclib',
        synced: lrclib.synced,
        plain: lrclib.plain ?? youtube,
        instrumental: false
      }
    }

    if (youtube) {
      return { source: 'youtube-music', synced: null, plain: youtube, instrumental: false }
    }

    if (lrclib?.plain) {
      return { source: 'lrclib', synced: null, plain: lrclib.plain, instrumental: false }
    }

    if (lrclib?.instrumental) {
      return { source: 'lrclib', synced: null, plain: null, instrumental: true }
    }

    return null
  }

  private async youtubeLyrics(id: string): Promise<string | null> {
    try {
      const music = await this.music()
      const lyrics = await music.getLyrics(id)
      return lyrics?.description?.toString().trim() || null
    } catch {
      return null
    }
  }

  async likeStatus(id: string): Promise<boolean> {
    try {
      const music = await this.music()
      const info = await music.getInfo(id)
      const likeButton = info.player_overlays?.actions?.find(
        (action) => action.type === 'LikeButton'
      ) as { like_status?: string } | undefined

      if (likeButton) return likeButton.like_status === 'LIKE'
      return Boolean(info.basic_info.is_liked)
    } catch {
      return false
    }
  }

  async setLiked(id: string, liked: boolean): Promise<boolean> {
    if (!(await this.isSignedIn())) {
      throw new Error('Sign in to save liked songs.')
    }

    const yt = await this.getYt()
    await yt.actions.execute(liked ? '/like/like' : '/like/removelike', {
      target: { videoId: id },
      client: 'YTMUSIC'
    })

    return liked
  }

  async setCollectionSaved(kind: CollectionKind, id: string, saved: boolean): Promise<boolean> {
    const yt = await this.requireSignedIn()
    const context = await this.collectionSaveContext(kind, id)

    if (!context.canSave) {
      throw new Error(
        kind === 'artist'
          ? 'This artist cannot be subscribed to.'
          : 'This collection cannot be saved to your library.'
      )
    }

    if (kind === 'artist') {
      if (!context.channelId) throw new Error('This artist has no subscription channel.')
      if (saved) await yt.interact.subscribe(context.channelId)
      else await yt.interact.unsubscribe(context.channelId)
    } else {
      if (!context.targetPlaylistId) throw new Error('This collection has no library target.')
      await yt.actions.execute(saved ? '/like/like' : '/like/removelike', {
        target: { playlistId: context.targetPlaylistId }
      })
    }

    context.saved = saved
    this.collectionSaveContexts.set(`${kind}:${id}`, context)
    return saved
  }

  async playlists(more = false): Promise<PlaylistChoices> {
    const yt = await this.requireSignedIn()
    const continuation = more ? this.playlistPickerContext.continuation : undefined
    if (more && !continuation) return { items: [], hasMore: false }

    const response = (await yt.actions.execute('/browse', {
      ...(continuation ? { continuation } : { browseId: 'FEmusic_liked_playlists' }),
      client: 'YTMUSIC',
      parse: true
    })) as unknown as LibraryBrowseResponse

    const account = await this.account()
    const items: PlaylistChoice[] = []
    const seen = new Set<string>()

    for (const raw of this.libraryRawItems(response)) {
      const item = this.mapItem(raw)
      if (!item || item.kind !== 'playlist') continue
      if (item.id === 'VLLM' || item.id === 'VLRDPN') continue
      if (seen.has(item.id)) continue
      if (!this.isEditablePlaylistItem(raw, item.subtitle, account?.name)) continue

      seen.add(item.id)
      items.push({
        id: item.id,
        title: item.title,
        subtitle: item.subtitle,
        thumbnails: item.thumbnails
      })
    }

    const next = this.libraryContinuation(response)
    this.playlistPickerContext = { continuation: next }
    return { items, hasMore: Boolean(next) }
  }

  async addToPlaylist(playlistId: string, videoId: string): Promise<void> {
    const yt = await this.requireSignedIn()
    const id = playlistId.replace(/^VL/, '')
    if (!id) throw new Error('Invalid playlist id')

    await yt.playlist.addVideos(id, [videoId])
  }

  async createPlaylist(title: string, videoId: string): Promise<CreatedPlaylist> {
    const yt = await this.requireSignedIn()
    const result = await yt.playlist.create(title, [videoId])

    if (!result.success || !result.playlist_id) {
      throw new Error('YouTube Music could not create the playlist.')
    }

    return { id: `VL${result.playlist_id}`, title }
  }

  private isEditablePlaylistItem(
    raw: unknown,
    subtitle: string | undefined,
    accountName: string | undefined
  ): boolean {
    const menu = (raw as { menu?: { items?: unknown[] } }).menu
    for (const entry of menu?.items ?? []) {
      const value = entry as HeaderButtonNode
      if (value.icon_type === 'EDIT') return true
      if (value.endpoint?.name === 'playlistEditorEndpoint') return true
    }

    if (!accountName) return false
    const author = subtitle?.split('•')[0]?.trim()
    return author === accountName
  }

  async resolve(videoId: string, force = false): Promise<PlaybackSource> {
    const quality = getSettings().audioQuality
    const cacheKey = `${videoId}:${quality}`

    if (force) {
      this.sourceCache.delete(cacheKey)
      this.pendingSources.delete(cacheKey)
    }

    const cached = this.sourceCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.source

    const pending = this.pendingSources.get(cacheKey)
    if (pending) return pending

    const promise = this.resolveUncached(videoId, quality).finally(() => {
      this.pendingSources.delete(cacheKey)
    })
    this.pendingSources.set(cacheKey, promise)
    return promise
  }

  clearSourceCache(): void {
    this.sourceCache.clear()
    this.pendingSources.clear()
  }

  private async resolveUncached(videoId: string, quality: AudioQuality): Promise<PlaybackSource> {
    const yt = await this.getYt()
    const errors: string[] = []

    for (const client of PLAYBACK_CLIENTS) {
      try {
        const info = await yt.getInfo(videoId, { client })
        if (info.playability_status?.status !== 'OK' || !info.streaming_data) {
          errors.push(`${client}: ${info.playability_status?.reason ?? 'no streams'}`)
          continue
        }

        const format = this.chooseAudioFormat(info, quality)
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

  private chooseAudioFormat(
    info: Awaited<ReturnType<Innertube['getInfo']>>,
    quality: AudioQuality
  ): Misc.Format {
    // 'best' keeps the highest bitrate; 'bestefficiency' makes chooseFormat
    // sort audio formats ascending, so it doubles as the data-saver mode.
    const youtubeQuality = quality === 'data-saver' ? 'bestefficiency' : 'best'

    try {
      // Electron's bundled Chromium may not decode AAC. Opus in WebM is
      // universally supported and usually has the best available bitrate too.
      return info.chooseFormat({
        type: 'audio',
        quality: youtubeQuality,
        codec: 'opus',
        format: 'webm'
      })
    } catch {
      try {
        return info.chooseFormat({ type: 'audio', quality: youtubeQuality })
      } catch {
        return info.chooseFormat({ type: 'audio', quality: 'bestefficiency' })
      }
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
      endpoint?: { payload?: { browseId?: string } }
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

    const kind =
      item.item_type === 'library_artist' ? 'artist' : (item.item_type as MediaKind | undefined)
    if (!kind || !['song', 'video', 'album', 'playlist', 'artist', 'podcast'].includes(kind)) {
      return null
    }

    const id = item.id ?? (kind === 'artist' ? item.endpoint?.payload?.browseId : undefined)
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
