export type MediaKind = 'song' | 'video' | 'album' | 'playlist' | 'artist' | 'podcast'
export type CollectionKind = 'album' | 'playlist' | 'artist'
export type LibraryListKind = 'playlists' | 'albums' | 'artists'
export type SearchFilter = 'all' | 'song' | 'album' | 'artist' | 'playlist' | 'video'

export interface Thumbnail {
  url: string
  width: number
  height: number
}

export interface ArtistRef {
  id?: string
  name: string
}

export interface AlbumRef {
  id?: string
  name: string
}

export interface MediaItem {
  id: string
  kind: MediaKind
  title: string
  subtitle?: string
  artists: ArtistRef[]
  album?: AlbumRef
  year?: string
  plays?: number
  duration?: number
  thumbnails: Thumbnail[]
  explicit?: boolean
}

export interface HomeSection {
  title: string
  items: MediaItem[]
}

export interface HomeData {
  filters: string[]
  sections: HomeSection[]
}

export interface CollectionSection {
  title: string
  items: MediaItem[]
}

export interface CollectionData {
  id: string
  kind: CollectionKind
  title: string
  subtitle?: string
  meta?: string
  description?: string
  author?: ArtistRef
  thumbnails: Thumbnail[]
  tracks: MediaItem[]
  allTracks?: MediaItem[]
  sections: CollectionSection[]
  hasMore?: boolean
  totalTracks?: number
}

export interface CollectionTrackPage {
  tracks: MediaItem[]
  hasMore: boolean
}

export interface LibraryListData {
  items: MediaItem[]
  hasMore: boolean
}

export interface AccountProfile {
  name: string
  handle?: string
  avatarUrl?: string
  channelId?: string
}

export interface AuthStatus {
  authenticated: boolean
  account?: AccountProfile
}

/** How a sign-in attempt ended. `blocked` means Google refused the in-app window. */
export type SignInOutcome = 'signed-in' | 'canceled' | 'blocked'

export interface SignInResult {
  status: AuthStatus
  outcome: SignInOutcome
}

export type SearchTopActionKind = 'shuffle' | 'mix'

export interface SearchTopAction {
  id: string
  kind: SearchTopActionKind
}

export interface SearchTopResult {
  item: MediaItem
  tracks: MediaItem[]
  actions: SearchTopAction[]
}

export interface SearchTopActionQueue {
  items: MediaItem[]
  title?: string
}

export interface SearchResult {
  query: string
  filter: SearchFilter
  topResult?: SearchTopResult
  items: MediaItem[]
  hasMore: boolean
}

export interface SearchMoreResult {
  items: MediaItem[]
  hasMore: boolean
}

export interface PlaybackSource {
  url: string
  client: string
  expiresAt: number
  isLive?: boolean
  headers?: Record<string, string>
}

export interface LyricsQuery {
  id: string
  title: string
  artist?: string
  album?: string
  duration?: number
}

export interface LyricLine {
  time: number
  text: string
}

export interface LyricsResult {
  source: 'youtube-music' | 'lrclib'
  synced: LyricLine[] | null
  plain: string | null
  instrumental: boolean
}

export interface AppApi {
  music: {
    home: (filter?: string) => Promise<HomeData>
    search: (query: string, filter?: SearchFilter) => Promise<SearchResult>
    searchMore: (query: string, filter: SearchFilter) => Promise<SearchMoreResult>
    topResultAction: (actionId: string) => Promise<SearchTopActionQueue>
    collection: (kind: CollectionKind, id: string) => Promise<CollectionData>
    collectionMore: (kind: CollectionKind, id: string) => Promise<CollectionTrackPage>
    albumYears: (ids: string[]) => Promise<Record<string, number>>
    track: (id: string) => Promise<MediaItem | null>
    lyrics: (query: LyricsQuery) => Promise<LyricsResult | null>
    upNext: (videoId: string, automix?: boolean) => Promise<MediaItem[]>
    likeStatus: (id: string) => Promise<boolean>
    setLiked: (id: string, liked: boolean) => Promise<boolean>
  }
  library: {
    list: (kind: LibraryListKind) => Promise<LibraryListData>
    more: (kind: LibraryListKind) => Promise<LibraryListData>
  }
  auth: {
    status: () => Promise<AuthStatus>
    signIn: () => Promise<SignInResult>
    cancelSignIn: () => Promise<void>
    signOut: () => Promise<AuthStatus>
  }
  playback: {
    resolve: (videoId: string) => Promise<PlaybackSource>
  }
}
