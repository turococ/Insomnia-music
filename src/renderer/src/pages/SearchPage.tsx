import { Disc3, SearchX, Sparkles } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { MediaItem } from '@shared/types'
import { MediaCard } from '@renderer/components/MediaCard'
import { MediaRow } from '@renderer/components/MediaRow'
import { usePlayer } from '@renderer/features/player/store'
import { collectionPath, isPlayable, mergeTracks } from '@renderer/lib/media'

const suggestions = ['Lofi beats', 'Jazz', 'Synthwave', 'Focus', '90s hip hop', 'Ambient']

function TrackSkeleton(): React.JSX.Element {
  return (
    <div className="flex items-center gap-4 rounded-xl px-3 py-2">
      <div className="size-3 rounded-full bg-surface-2" />
      <div className="size-11 animate-pulse rounded-lg bg-surface-2" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-1/3 animate-pulse rounded-full bg-surface-2" />
        <div className="h-2.5 w-1/5 animate-pulse rounded-full bg-surface-2" />
      </div>
    </div>
  )
}

export function SearchPage(): React.JSX.Element {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const playTrack = usePlayer((state) => state.playTrack)
  const query = searchParams.get('q')?.trim() ?? ''

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['search', query],
    queryFn: () => window.api.music.search(query),
    enabled: query.length > 0
  })

  const items = data?.items ?? []
  const tracks = items.filter((item) => item.kind === 'song' || item.kind === 'video')
  const albums = items.filter((item) => item.kind === 'album' || item.kind === 'playlist')
  const artists = items.filter((item) => item.kind === 'artist')

  const play = (item: MediaItem): void => {
    const queue = mergeTracks(items)
    void playTrack(item, queue)
  }

  const openItem = (item: MediaItem): void => {
    if (isPlayable(item)) {
      play(item)
      return
    }

    const path = collectionPath(item)
    if (path) navigate(path)
  }

  if (!query) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="w-full max-w-xl text-center">
          <div className="mx-auto grid size-16 place-items-center rounded-3xl border border-line bg-surface-2 text-accent">
            <Disc3 className="size-7" />
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">Find something to play</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
            Search across songs, albums, playlists and artists. Your queue is built from the results
            automatically.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => navigate(`/search?q=${encodeURIComponent(suggestion)}`)}
                className="rounded-full border border-line bg-surface-2/70 px-4 py-2 text-[12px] text-muted transition hover:border-accent/30 hover:text-ink"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-9 p-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
            <Sparkles className="size-3" />
            Search
          </div>
          <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.03em]">
            Results for “{query}”
          </h1>
          <p className="mt-1 text-[12px] text-faint">
            {isLoading ? 'Looking through YouTube Music…' : `${items.length} results found`}
          </p>
        </div>
      </div>

      {isError && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center">
          <SearchX className="mx-auto size-6 text-red-300" />
          <p className="mt-3 text-sm text-red-200">Search failed. YouTube may be rate-limiting.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-4 rounded-full border border-red-400/30 px-4 py-2 text-[12px] font-medium text-red-100 transition hover:bg-red-500/10"
          >
            Try again
          </button>
        </div>
      )}

      {isLoading && (
        <div className="space-y-1">
          {Array.from({ length: 8 }).map((_, index) => (
            <TrackSkeleton key={index} />
          ))}
        </div>
      )}

      {!isLoading && !isError && items.length === 0 && (
        <div className="rounded-3xl border border-line bg-surface p-10 text-center">
          <SearchX className="mx-auto size-7 text-faint" />
          <h2 className="mt-4 text-lg font-semibold">Nothing found</h2>
          <p className="mt-2 text-sm text-muted">
            Try a different spelling, or search for a song, artist or album.
          </p>
        </div>
      )}

      {tracks.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold tracking-tight">Songs</h2>
            <span className="text-[11px] text-faint">{tracks.length} tracks</span>
          </div>
          <div className="space-y-0.5">
            {tracks.map((track, index) => (
              <MediaRow
                key={`${track.kind}:${track.id}`}
                item={track}
                index={index}
                onPlay={play}
              />
            ))}
          </div>
        </section>
      )}

      {(albums.length > 0 || artists.length > 0) && (
        <section>
          <h2 className="mb-4 text-[15px] font-semibold tracking-tight">More results</h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {[...artists, ...albums].slice(0, 10).map((item) => (
              <MediaCard key={`${item.kind}:${item.id}`} item={item} onSelect={openItem} />
            ))}
          </div>
          <p className="mt-4 text-[11px] text-faint">
            Open an album, playlist or artist to see the full tracklist.
          </p>
        </section>
      )}
    </div>
  )
}
