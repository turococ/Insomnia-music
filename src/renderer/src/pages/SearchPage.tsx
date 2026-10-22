import {
  ChevronDown,
  ChevronRight,
  Disc3,
  Loader2,
  Music2,
  Play,
  SearchX,
  Sparkles,
  UserRound
} from 'lucide-react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { MediaItem, MediaKind, SearchFilter, SearchResult } from '@shared/types'
import { MediaCard } from '@renderer/components/MediaCard'
import { MediaRow } from '@renderer/components/MediaRow'
import { MediaShelf } from '@renderer/components/MediaShelf'
import { usePlayer } from '@renderer/features/player/store'
import { cn } from '@renderer/lib/cn'
import {
  collectionPath,
  isPlayable,
  itemSubtitle,
  mergeTracks,
  pickThumbnail
} from '@renderer/lib/media'

const suggestions = ['Lofi beats', 'Jazz', 'Synthwave', 'Focus', '90s hip hop', 'Ambient']

const SEARCH_TABS: Array<{ value: SearchFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'song', label: 'Songs' },
  { value: 'album', label: 'Albums' },
  { value: 'artist', label: 'Artists' },
  { value: 'playlist', label: 'Playlists' },
  { value: 'video', label: 'Videos' }
]

const KIND_LABELS: Record<MediaKind, string> = {
  song: 'Song',
  video: 'Video',
  album: 'Album',
  playlist: 'Playlist',
  artist: 'Artist',
  podcast: 'Podcast'
}

function parseSearchFilter(value: string | null): SearchFilter {
  return SEARCH_TABS.find((tab) => tab.value === value)?.value ?? 'all'
}

function dedupeItems(items: MediaItem[]): MediaItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.kind}:${item.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function topResultMeta(item: MediaItem): string | undefined {
  const parts =
    item.subtitle
      ?.split('•')
      .map((part) => part.trim())
      .filter(Boolean) ?? []
  if (parts.length > 1) return parts.slice(1).join(' • ')
  return item.subtitle ?? itemSubtitle(item) ?? undefined
}

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

function CardSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-3">
      <div className="aspect-square animate-pulse rounded-xl bg-surface-2" />
      <div className="h-3 w-2/3 animate-pulse rounded-full bg-surface-2" />
      <div className="h-2.5 w-1/2 animate-pulse rounded-full bg-surface-2" />
    </div>
  )
}

function SeeAllButton({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-full border border-line/70 bg-surface-2/40 px-3 py-1.5 text-[11px] font-medium text-muted transition hover:border-accent/30 hover:text-ink"
    >
      See all
      <ChevronRight className="size-3.5" />
    </button>
  )
}

function SearchSectionHeader({
  title,
  meta,
  onSeeAll
}: {
  title: string
  meta?: string
  onSeeAll?: () => void
}): React.JSX.Element {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">{title}</h2>
        {meta && <p className="mt-0.5 text-[11px] text-faint">{meta}</p>}
      </div>
      {onSeeAll && <SeeAllButton onClick={onSeeAll} />}
    </div>
  )
}

function TopResultCard({
  item,
  onSelect
}: {
  item: MediaItem
  onSelect: () => void
}): React.JSX.Element {
  const [imageFailed, setImageFailed] = useState(false)
  const cover = imageFailed ? undefined : pickThumbnail(item.thumbnails, 640)
  const playable = isPlayable(item)
  const label = KIND_LABELS[item.kind]
  const meta = topResultMeta(item)
  const isVideo = item.kind === 'video'

  return (
    <section>
      <h2 className="mb-3 text-[20px] font-semibold tracking-[-0.02em] text-ink">Top result</h2>
      <button
        type="button"
        onClick={onSelect}
        className="group flex w-full flex-col gap-4 rounded-3xl border border-line/60 bg-surface/30 p-4 text-left transition hover:border-line hover:bg-surface/50 sm:flex-row sm:items-center sm:p-5"
      >
        <div
          className={cn(
            'relative shrink-0 overflow-hidden border border-line/50 bg-surface-2 shadow-xl shadow-black/20',
            isVideo ? 'aspect-video w-56 rounded-2xl sm:w-72' : 'size-32 rounded-2xl sm:size-40',
            item.kind === 'artist' && 'rounded-full'
          )}
        >
          {cover ? (
            <img
              src={cover}
              alt=""
              draggable={false}
              onError={() => setImageFailed(true)}
              className="size-full object-cover transition duration-500 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="grid size-full place-items-center bg-gradient-to-br from-surface-3 to-surface">
              {item.kind === 'artist' ? (
                <UserRound className="size-12 text-faint" />
              ) : (
                <Music2 className="size-12 text-faint" />
              )}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
            {label}
          </div>
          <div className="mt-2 line-clamp-2 text-[26px] font-semibold leading-tight tracking-[-0.03em] text-ink sm:text-[32px]">
            {item.title}
          </div>
          {meta && <div className="mt-1.5 line-clamp-2 text-[12px] text-faint">{meta}</div>}
          <span className="mt-4 inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-[12px] font-semibold text-accent-ink shadow-lg shadow-accent/10 transition group-hover:brightness-105">
            {playable ? (
              <Play className="size-3.5 fill-current" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            {playable ? 'Play' : `Open ${label.toLowerCase()}`}
          </span>
        </div>
      </button>
    </section>
  )
}

export function SearchPage(): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const playTrack = usePlayer((state) => state.playTrack)
  const query = searchParams.get('q')?.trim() ?? ''
  const activeFilter = parseSearchFilter(searchParams.get('type'))

  const searchQuery = useInfiniteQuery({
    queryKey: ['search', query, activeFilter],
    queryFn: ({ pageParam }) =>
      pageParam === 0
        ? window.api.music.search(query, activeFilter)
        : window.api.music.searchMore(query, activeFilter),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length : undefined),
    enabled: query.length > 0,
    staleTime: 5 * 60 * 1000
  })

  const items = useMemo(
    () => dedupeItems(searchQuery.data?.pages.flatMap((page) => page.items) ?? []),
    [searchQuery.data]
  )
  const firstPage = searchQuery.data?.pages[0] as SearchResult | undefined
  const topResult = firstPage?.topResult
  const isLoading = searchQuery.isLoading
  const initialError = searchQuery.isError && !searchQuery.data
  const hasNextPage = searchQuery.hasNextPage
  const resultCount = items.length + (topResult ? 1 : 0)
  const activeTab = SEARCH_TABS.find((tab) => tab.value === activeFilter) ?? SEARCH_TABS[0]

  const songs = items.filter((item) => item.kind === 'song')
  const videos = items.filter((item) => item.kind === 'video')
  const albums = items.filter((item) => item.kind === 'album')
  const artists = items.filter((item) => item.kind === 'artist')
  const playlists = items.filter((item) => item.kind === 'playlist')

  useEffect(() => {
    document.querySelector('main')?.scrollTo({ top: 0 })
  }, [query, activeFilter])

  const setFilter = (next: SearchFilter): void => {
    const nextParams = new URLSearchParams(searchParams)
    if (next === 'all') nextParams.delete('type')
    else nextParams.set('type', next)
    setSearchParams(nextParams)
  }

  const selectItem = (item: MediaItem, sectionItems: MediaItem[] = items): void => {
    if (isPlayable(item)) {
      const queue = mergeTracks(sectionItems)
      if (!queue.some((track) => track.kind === item.kind && track.id === item.id)) {
        queue.unshift(item)
      }
      void playTrack(item, queue)
      return
    }

    const path = collectionPath(item)
    if (path) navigate(path)
  }

  const loadMore = (): void => {
    void searchQuery.fetchNextPage()
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
    <div className="space-y-8 p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
            <Sparkles className="size-3" />
            Search
          </div>
          <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.03em]">
            Results for “{query}”
          </h1>
          <p className="mt-1 text-[12px] text-faint">
            {isLoading
              ? 'Looking through YouTube Music…'
              : `${resultCount}${hasNextPage ? '+' : ''} ${resultCount === 1 ? 'result' : 'results'} found`}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {SEARCH_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            aria-pressed={activeFilter === tab.value}
            onClick={() => setFilter(tab.value)}
            className={cn(
              'rounded-full border px-4 py-2 text-[12px] font-medium transition',
              activeFilter === tab.value
                ? 'border-accent bg-accent text-accent-ink shadow-lg shadow-accent/10'
                : 'border-line/70 bg-surface-2/40 text-muted hover:border-line hover:text-ink'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {initialError && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center">
          <SearchX className="mx-auto size-6 text-red-300" />
          <p className="mt-3 text-sm text-red-200">Search failed. YouTube may be rate-limiting.</p>
          <button
            type="button"
            onClick={() => void searchQuery.refetch()}
            className="mt-4 rounded-full border border-red-400/30 px-4 py-2 text-[12px] font-medium text-red-100 transition hover:bg-red-500/10"
          >
            Try again
          </button>
        </div>
      )}

      {isLoading && (
        <div className="space-y-8">
          <div className="space-y-1">
            {Array.from({ length: 5 }).map((_, index) => (
              <TrackSkeleton key={index} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <CardSkeleton key={index} />
            ))}
          </div>
        </div>
      )}

      {!isLoading && !initialError && resultCount === 0 && (
        <div className="rounded-3xl border border-line bg-surface p-10 text-center">
          <SearchX className="mx-auto size-7 text-faint" />
          <h2 className="mt-4 text-lg font-semibold">Nothing found</h2>
          <p className="mt-2 text-sm text-muted">
            Try a different spelling, or search for a song, artist or album.
          </p>
        </div>
      )}

      {!isLoading && !initialError && resultCount > 0 && activeFilter === 'all' && (
        <>
          {topResult && (
            <TopResultCard
              key={`${topResult.kind}:${topResult.id}`}
              item={topResult}
              onSelect={() => selectItem(topResult)}
            />
          )}

          {songs.length > 0 && (
            <section>
              <SearchSectionHeader
                title="Songs"
                meta={`${songs.length} ${songs.length === 1 ? 'track' : 'tracks'}`}
                onSeeAll={() => setFilter('song')}
              />
              <div className="space-y-0.5">
                {songs.map((track, index) => (
                  <MediaRow
                    key={`${track.kind}:${track.id}`}
                    item={track}
                    index={index}
                    onPlay={(selected) => selectItem(selected)}
                  />
                ))}
              </div>
            </section>
          )}

          {albums.length > 0 && (
            <MediaShelf
              title="Albums"
              items={albums}
              onSelect={selectItem}
              action={<SeeAllButton onClick={() => setFilter('album')} />}
            />
          )}

          {artists.length > 0 && (
            <MediaShelf
              title="Artists"
              items={artists}
              onSelect={selectItem}
              action={<SeeAllButton onClick={() => setFilter('artist')} />}
            />
          )}

          {playlists.length > 0 && (
            <MediaShelf
              title="Playlists"
              items={playlists}
              onSelect={selectItem}
              action={<SeeAllButton onClick={() => setFilter('playlist')} />}
            />
          )}

          {videos.length > 0 && (
            <MediaShelf
              title="Videos"
              items={videos}
              onSelect={selectItem}
              action={<SeeAllButton onClick={() => setFilter('video')} />}
            />
          )}
        </>
      )}

      {!isLoading && !initialError && resultCount > 0 && activeFilter !== 'all' && (
        <section>
          <SearchSectionHeader
            title={activeTab.label}
            meta={
              activeFilter === 'song' || activeFilter === 'video'
                ? `${items.length}${hasNextPage ? '+' : ''} ${activeFilter === 'song' ? 'tracks' : 'videos'}`
                : `${items.length}${hasNextPage ? '+' : ''} ${items.length === 1 ? 'result' : 'results'}`
            }
          />

          {activeFilter === 'song' || activeFilter === 'video' ? (
            <div className="space-y-0.5">
              {items.map((item, index) => (
                <MediaRow
                  key={`${item.kind}:${item.id}`}
                  item={item}
                  index={index}
                  onPlay={(selected) => selectItem(selected)}
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {items.map((item) => (
                <MediaCard
                  key={`${item.kind}:${item.id}`}
                  item={item}
                  onSelect={(selected) => selectItem(selected)}
                />
              ))}
            </div>
          )}

          {hasNextPage && (
            <div className="flex flex-col items-center gap-2 pt-7">
              <button
                type="button"
                onClick={loadMore}
                disabled={searchQuery.isFetchingNextPage}
                className="flex items-center gap-2 rounded-full border border-line/70 bg-surface-2/50 px-5 py-2.5 text-[12px] font-medium text-muted transition hover:border-accent/30 hover:text-ink disabled:cursor-wait disabled:opacity-60"
              >
                {searchQuery.isFetchingNextPage ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ChevronDown className="size-4" />
                )}
                {searchQuery.isFetchNextPageError ? 'Try again' : 'Load more'}
              </button>
              {searchQuery.isFetchNextPageError && (
                <p className="text-[11px] text-red-300/90">Could not load more results.</p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
