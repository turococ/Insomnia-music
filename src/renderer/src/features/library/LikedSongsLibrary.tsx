import { ChevronDown, Heart, Loader2, Music2, Play, RotateCcw, Shuffle } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { MediaItem } from '@shared/types'
import { TrackList } from '@renderer/components/TrackList'
import { TrackToolbar } from '@renderer/components/TrackToolbar'
import { usePlayer, type QueueSource } from '@renderer/features/player/store'
import { useTrackSort } from '@renderer/features/tracks/useTrackSort'
import { filterTracks } from '@renderer/lib/trackFilter'
import { pickThumbnail } from '@renderer/lib/media'

const LIKED_MUSIC_ID = 'LM'
const LIKED_SOURCE: QueueSource = { kind: 'playlist', id: LIKED_MUSIC_ID }

interface ExtraTracks {
  tracks: MediaItem[]
  hasMore: boolean
}

function LikedSongsSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-5 rounded-3xl border border-line/70 bg-surface/40 p-5">
        <div className="size-28 shrink-0 animate-pulse rounded-2xl bg-surface-2" />
        <div className="flex-1 space-y-3">
          <div className="h-3 w-24 animate-pulse rounded-full bg-surface-2" />
          <div className="h-8 w-48 animate-pulse rounded-full bg-surface-2" />
          <div className="h-3 w-36 animate-pulse rounded-full bg-surface-2" />
        </div>
      </div>
      <div className="space-y-1 rounded-2xl border border-line/60 bg-surface/30 p-3">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="flex items-center gap-3 rounded-xl px-3 py-2">
            <div className="size-3 rounded-full bg-surface-2" />
            <div className="size-11 animate-pulse rounded-lg bg-surface-2" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-1/3 animate-pulse rounded-full bg-surface-2" />
              <div className="h-2.5 w-1/5 animate-pulse rounded-full bg-surface-2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function LikedSongsLibrary(): React.JSX.Element {
  const playTrack = usePlayer((state) => state.playTrack)
  const appendTracks = usePlayer((state) => state.appendTracks)
  const [query, setQuery] = useState('')
  const [extra, setExtra] = useState<ExtraTracks | null>(null)
  const [bulkLoading, setBulkLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const bulkRequest = useRef(0)
  const bulkLoadingRef = useRef(false)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['library', 'liked-songs'],
    queryFn: () => window.api.music.collection('playlist', LIKED_MUSIC_ID),
    staleTime: 5 * 60 * 1000
  })

  const loadMore = useMutation({
    mutationFn: () => window.api.music.collectionMore('playlist', LIKED_MUSIC_ID),
    onSuccess: (page) => {
      setLoadError(false)
      if (page.tracks.length > 0) appendTracks(page.tracks, LIKED_SOURCE)
      setExtra((previous) => ({
        tracks: [...(previous?.tracks ?? []), ...page.tracks],
        hasMore: page.hasMore
      }))
    },
    onError: () => setLoadError(true)
  })

  const loadedTracks = useMemo(() => {
    if (!data) return []
    return [...data.tracks, ...(extra?.tracks ?? [])]
  }, [data, extra])

  const hasMore = Boolean(extra ? extra.hasMore : data?.hasMore)
  const filteredTracks = useMemo(() => filterTracks(loadedTracks, query), [loadedTracks, query])
  const { sortKey, sortedTracks, loadingYears, yearsError, changeSort } = useTrackSort(
    filteredTracks,
    { initialSort: 'default' }
  )

  const loadAllTracks = async (): Promise<void> => {
    if (!hasMore || bulkLoadingRef.current) return

    const requestId = bulkRequest.current + 1
    bulkRequest.current = requestId
    bulkLoadingRef.current = true
    setBulkLoading(true)
    setLoadError(false)

    try {
      let more = true
      let pages = 0

      while (more && pages < 200) {
        pages += 1
        const page = await window.api.music.collectionMore('playlist', LIKED_MUSIC_ID)
        if (bulkRequest.current !== requestId) return

        if (page.tracks.length > 0) appendTracks(page.tracks, LIKED_SOURCE)

        setExtra((previous) => ({
          tracks: [...(previous?.tracks ?? []), ...page.tracks],
          hasMore: page.hasMore
        }))

        if (page.tracks.length === 0) {
          if (page.hasMore) setLoadError(true)
          break
        }

        more = page.hasMore
      }

      if (more) setLoadError(true)
    } catch {
      if (bulkRequest.current === requestId) setLoadError(true)
    } finally {
      if (bulkRequest.current === requestId) {
        bulkLoadingRef.current = false
        setBulkLoading(false)
      }
    }
  }

  const handleQueryChange = (value: string): void => {
    setQuery(value)
    if (value.trim() && hasMore) void loadAllTracks()
  }

  const handleSortChange = (next: Parameters<typeof changeSort>[0]): void => {
    changeSort(next)
    if (hasMore) void loadAllTracks()
  }

  if (isLoading) return <LikedSongsSkeleton />

  if (isError || !data) {
    return (
      <div className="rounded-3xl border border-line bg-surface p-8 text-center">
        <Heart className="mx-auto size-7 text-accent" />
        <h2 className="mt-4 text-base font-semibold">Could not load your liked songs</h2>
        <p className="mx-auto mt-2 max-w-sm text-[12px] leading-relaxed text-muted">
          YouTube Music did not return the Liked Music playlist. Check your connection and try
          again.
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-[12px] font-semibold text-accent-ink"
        >
          <RotateCcw className="size-3.5" />
          Retry
        </button>
      </div>
    )
  }

  const headerCover = pickThumbnail(data.thumbnails, 320)
  const fallbackCover = loadedTracks
    .map((track) => pickThumbnail(track.thumbnails, 320))
    .find((url): url is string => Boolean(url))
  const cover = headerCover ?? fallbackCover
  const totalTracks = data.totalTracks
  const countLabel = query.trim()
    ? `${sortedTracks.length} of ${loadedTracks.length}${hasMore ? '+' : ''} songs`
    : hasMore && totalTracks && totalTracks > loadedTracks.length
      ? `${loadedTracks.length} of ${totalTracks} songs`
      : `${loadedTracks.length} ${loadedTracks.length === 1 ? 'song' : 'songs'}`

  const playAll = (): void => {
    if (sortedTracks.length > 0) void playTrack(sortedTracks[0], sortedTracks, LIKED_SOURCE)
  }

  const shufflePlay = (): void => {
    if (sortedTracks.length === 0) return
    const shuffled = [...sortedTracks].sort(() => Math.random() - 0.5)
    void playTrack(shuffled[0], shuffled, LIKED_SOURCE)
  }

  return (
    <div className="space-y-7">
      <div className="relative overflow-hidden rounded-3xl border border-line/70 bg-gradient-to-br from-accent/[0.13] via-surface-2/70 to-surface p-5">
        <div className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="relative size-28 shrink-0 overflow-hidden rounded-2xl border border-line/60 bg-surface-2 shadow-xl shadow-black/25">
            {cover ? (
              <img src={cover} alt="" draggable={false} className="size-full object-cover" />
            ) : (
              <div className="grid size-full place-items-center bg-gradient-to-br from-accent/20 to-surface-3">
                <Heart className="size-10 fill-current text-accent/80" />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
              <Heart className="size-3 fill-current" />
              Liked music
            </div>
            <h2 className="mt-2 text-[26px] font-semibold tracking-[-0.03em] text-ink">
              {data.title || 'Liked songs'}
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-faint">
              <span>{countLabel}</span>
              {hasMore && <span>•</span>}
              {hasMore && <span>More songs load as you browse</span>}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={playAll}
                disabled={sortedTracks.length === 0}
                className="flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[12px] font-semibold text-accent-ink shadow-lg shadow-accent/15 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Play className="size-3.5 fill-current" />
                Play
              </button>
              <button
                type="button"
                onClick={shufflePlay}
                disabled={sortedTracks.length === 0}
                className="flex items-center gap-2 rounded-full border border-line bg-surface-2/60 px-5 py-2.5 text-[12px] font-medium text-muted transition hover:border-accent/30 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Shuffle className="size-3.5" />
                Shuffle
              </button>
            </div>
          </div>
        </div>
      </div>

      {yearsError && (
        <p className="-mb-3 text-right text-[11px] text-red-300/90">
          Could not load release years. Try again.
        </p>
      )}

      <TrackList
        title="Liked songs"
        tracks={sortedTracks}
        countLabel={countLabel}
        onPlay={(track) => void playTrack(track, sortedTracks, LIKED_SOURCE)}
        emptyText={
          query.trim()
            ? 'No liked songs match your filter.'
            : 'Songs you like in YouTube Music will appear here.'
        }
        action={
          <TrackToolbar
            query={query}
            onQueryChange={handleQueryChange}
            sort={sortKey}
            onSortChange={handleSortChange}
            sortLoading={loadingYears}
            disabled={loadedTracks.length === 0}
            placeholder="Filter liked songs…"
          />
        }
        footer={
          hasMore || bulkLoading ? (
            <div>
              {bulkLoading ? (
                <div className="flex w-full items-center justify-center gap-2 rounded-xl border border-line/60 bg-surface/30 px-4 py-3 text-[12px] font-medium text-muted">
                  <Loader2 className="size-4 animate-spin" />
                  Loading all liked songs… {loadedTracks.length}
                  {totalTracks ? ` of ${totalTracks}` : ''}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void loadMore.mutate()}
                    disabled={loadMore.isPending}
                    className="flex min-w-[160px] flex-1 items-center justify-center gap-2 rounded-xl border border-line/60 bg-surface/30 px-4 py-3 text-[12px] font-medium text-muted transition hover:border-accent/30 hover:text-ink disabled:cursor-wait disabled:opacity-60"
                  >
                    {loadMore.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ChevronDown className="size-4" />
                    )}
                    {loadMore.isPending ? 'Loading more songs…' : 'Load more songs'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void loadAllTracks()}
                    disabled={loadMore.isPending}
                    className="flex items-center justify-center gap-2 rounded-xl border border-line/60 bg-surface/30 px-4 py-3 text-[12px] font-medium text-muted transition hover:border-accent/30 hover:text-ink disabled:cursor-wait disabled:opacity-60"
                  >
                    Load all
                    {totalTracks ? ` (${totalTracks})` : ''}
                  </button>
                </div>
              )}
              {loadError && (
                <p className="mt-2 text-center text-[11px] text-red-300/90">
                  Could not load more liked songs. Try again.
                </p>
              )}
            </div>
          ) : undefined
        }
      />

      {loadedTracks.length === 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-dashed border-line px-4 py-3 text-[11px] text-faint">
          <Music2 className="size-4 shrink-0" />
          Like a song in YouTube Music and it will show up here automatically.
        </div>
      )}
    </div>
  )
}
