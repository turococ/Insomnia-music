export type MediaKind = 'song' | 'video' | 'album' | 'playlist' | 'artist' | 'podcast'
export type CollectionKind = 'album' | 'playlist' | 'artist'

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

export interface SearchResult {
  query: string
  items: MediaItem[]
}

export interface PlaybackSource {
  url: string
  client: string
  expiresAt: number
  isLive?: boolean
  headers?: Record<string, string>
}

export interface AppApi {
  music: {
    home: (filter?: string) => Promise<HomeData>
    search: (query: string) => Promise<SearchResult>
    collection: (kind: CollectionKind, id: string) => Promise<CollectionData>
    collectionMore: (kind: CollectionKind, id: string) => Promise<CollectionTrackPage>
    albumYears: (ids: string[]) => Promise<Record<string, number>>
    track: (id: string) => Promise<MediaItem | null>
    lyrics: (id: string) => Promise<string | null>
  }
  playback: {
    resolve: (videoId: string) => Promise<PlaybackSource>
  }
}
