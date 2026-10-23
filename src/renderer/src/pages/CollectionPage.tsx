import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Disc3,
  Loader2,
  Play,
  Shuffle,
  UserRound
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { CollectionKind, MediaItem } from '@shared/types'
import { MediaShelf } from '@renderer/components/MediaShelf'
import { TrackList } from '@renderer/components/TrackList'
import { TrackToolbar } from '@renderer/components/TrackToolbar'
import { usePlayer, type QueueSource } from '@renderer/features/player/store'
import { useTrackSort } from '@renderer/features/tracks/useTrackSort'
import { cn } from '@renderer/lib/cn'
import { collectionPath, isPlayable, mergeTracks, pickThumbnail } from '@renderer/lib/media'
import { filterTracks } from '@renderer/lib/trackFilter'

interface CollectionPageProps {
  kind: CollectionKind
}

interface ExtraTrackState {
  key: string
  tracks: MediaItem[]
  hasMore: boolean
}

const KIND_LABELS: Record<CollectionKind, string> = {
  album: 'Album',
  playlist: 'Playlist',
  artist: 'Artist'
}

function CollectionSkeleton(): React.JSX.Element {
  return (
    <div className="p-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
        <div className="size-44 shrink-0 animate-pulse rounded-2xl bg-surface-2" />
        <div className="flex-1 space-y-4 pb-2">
          <div className="h-3 w-20 animate-pulse rounded-full bg-surface-2" />
          <div className="h-10 w-2/3 animate-pulse rounded-full bg-surface-2" />
          <div className="h-3 w-1/2 animate-pulse rounded-full bg-surface-2" />
          <div className="h-10 w-48 animate-pulse rounded-full bg-surface-2" />
        </div>
      </div>
      <div className="mt-10 space-y-1">
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

export function CollectionPage({ kind }: CollectionPageProps): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const playTrack = usePlayer((state) => state.playTrack)
  const appendTracks = usePlayer((state) => state.appendTracks)
  const [failedCovers, setFailedCovers] = useState<Set<string>>(() => new Set())
  const [extraTracks, setExtraTracks] = useState<ExtraTrackState | null>(null)
  const [loadMoreError, setLoadMoreError] = useState(false)
  const [query, setQuery] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)
  const bulkRequest = useRef(0)
  const bulkLoadingRef = useRef(false)
  const collectionKey = `${kind}:${id ?? ''}`

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['collection', kind, id],
    queryFn: () => window.api.music.collection(kind, id ?? ''),
    enabled: Boolean(id),
    staleTime: 5 * 60 * 1000
  })

  const loadMore = useMutation({
    mutationFn: () => window.api.music.collectionMore(kind, id ?? ''),
    onSuccess: (page) => {
      setLoadMoreError(false)
      if (id && page.tracks.length > 0) {
        appendTracks(page.tracks, { kind, id })
      }

      setExtraTracks((previous) => ({
        key: collectionKey,
        tracks: [...(previous?.key === collectionKey ? previous.tracks : []), ...page.tracks],
        hasMore: page.hasMore
      }))
    },
    onError: () => setLoadMoreError(true)
  })

  useEffect(() => {
    document.querySelector('main')?.scrollTo({ top: 0 })
  }, [collectionKey])

  const loadedTracks = useMemo(() => {
    if (!data) return []
    if (kind === 'playlist' && extraTracks?.key === collectionKey) {
      return [...data.tracks, ...extraTracks.tracks]
    }
    return data.tracks
  }, [collectionKey, data, extraTracks, kind])

  const hasMore = Boolean(
    kind === 'playlist' &&
    (extraTracks?.key === collectionKey ? extraTracks.hasMore : data?.hasMore)
  )

  const filteredPlaylistTracks = useMemo(
    () => (kind === 'playlist' ? filterTracks(loadedTracks, query) : []),
    [kind, loadedTracks, query]
  )

  const { sortKey, sortedTracks, loadingYears, yearsError, changeSort } = useTrackSort(
    filteredPlaylistTracks,
    { initialSort: 'default' }
  )

  const loadAllTracks = async (): Promise<void> => {
    if (kind !== 'playlist' || !id || !hasMore || bulkLoadingRef.current) return

    const requestId = bulkRequest.current + 1
    bulkRequest.current = requestId
    bulkLoadingRef.current = true
    setBulkLoading(true)
    setLoadMoreError(false)

    try {
      let more = true
      let pages = 0

      while (more && pages < 200) {
        pages += 1
        const page = await window.api.music.collectionMore('playlist', id)
        if (bulkRequest.current !== requestId) return

        if (page.tracks.length > 0) {
          appendTracks(page.tracks, { kind: 'playlist', id })
        }

        setExtraTracks((previous) => ({
          key: collectionKey,
          tracks: [...(previous?.key === collectionKey ? previous.tracks : []), ...page.tracks],
          hasMore: page.hasMore
        }))

        if (page.tracks.length === 0) {
          if (page.hasMore) setLoadMoreError(true)
          break
        }

        more = page.hasMore
      }

      if (more) setLoadMoreError(true)
    } catch {
      if (bulkRequest.current === requestId) setLoadMoreError(true)
    } finally {
      if (bulkRequest.current === requestId) {
        bulkLoadingRef.current = false
        setBulkLoading(false)
      }
    }
  }

  const handleQueryChange = (value: string): void => {
    setQuery(value)
    if (kind === 'playlist' && value.trim() && hasMore) void loadAllTracks()
  }

  const handleSortChange = (next: Parameters<typeof changeSort>[0]): void => {
    changeSort(next)
    if (kind === 'playlist' && hasMore) void loadAllTracks()
  }

  if (isLoading) return <CollectionSkeleton />

  if (isError || !data) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-md rounded-3xl border border-line bg-surface p-8 text-center">
          <Disc3 className="mx-auto size-8 text-accent" />
          <h2 className="mt-4 text-lg font-semibold">Could not load this {kind}</h2>
          <p className="mt-2 text-sm text-muted">
            YouTube Music did not return this page. It may be unavailable in your region.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => void refetch()}
              className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-accent-ink"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="rounded-full border border-line px-5 py-2 text-sm font-medium text-muted transition hover:text-ink"
            >
              Go back
            </button>
          </div>
        </div>
      </div>
    )
  }

  const headerCover = pickThumbnail(data.thumbnails, 640)
  const fallbackCover = data.tracks
    .map((track) => pickThumbnail(track.thumbnails, 640))
    .find((url): url is string => Boolean(url))
  const coverCandidates = [headerCover, fallbackCover].filter((url): url is string => Boolean(url))
  const cover = coverCandidates.find((url) => !failedCovers.has(url))
  const showCover = Boolean(cover)
  const artistTracks = kind === 'artist' ? (data.allTracks ?? []) : []
  const playlistTracks = kind === 'playlist' ? sortedTracks : []
  const queueTracks =
    kind === 'playlist' ? playlistTracks : artistTracks.length > 0 ? artistTracks : loadedTracks
  const displayTracks =
    kind === 'playlist' ? sortedTracks : kind === 'artist' ? data.tracks : loadedTracks
  const tracksTitle = kind === 'artist' ? 'Top songs' : kind === 'album' ? 'Tracklist' : 'Songs'
  const details = [data.subtitle, data.meta].filter(Boolean).join(' • ')
  const source: QueueSource | undefined = id ? { kind, id } : undefined
  const totalTracks = data.totalTracks
  const loadedCountLabel =
    hasMore && totalTracks && totalTracks > loadedTracks.length
      ? `${loadedTracks.length} of ${totalTracks} tracks`
      : `${loadedTracks.length} ${loadedTracks.length === 1 ? 'track' : 'tracks'}`
  const countLabel =
    kind === 'playlist' && query.trim()
      ? `${sortedTracks.length} of ${loadedTracks.length}${hasMore ? '+' : ''} tracks`
      : loadedCountLabel
  const topSongsLabel = `${data.tracks.length} ${data.tracks.length === 1 ? 'track' : 'tracks'}`

  const playAll = (): void => {
    if (queueTracks.length > 0) void playTrack(queueTracks[0], queueTracks, source)
  }

  const shufflePlay = (): void => {
    if (queueTracks.length === 0) return
    const shuffled = [...queueTracks].sort(() => Math.random() - 0.5)
    void playTrack(shuffled[0], shuffled, source)
  }

  const playCollectionTrack = (track: MediaItem): void => {
    void playTrack(track, queueTracks, source)
  }

  const handleSectionSelect = (item: MediaItem, sectionItems: MediaItem[]): void => {
    if (isPlayable(item)) {
      const queue = mergeTracks(sectionItems)
      if (queue.some((track) => track.id === item.id)) void playTrack(item, queue)
      return
    }

    const path = collectionPath(item)
    if (path) navigate(path)
  }

  return (
    <div className="pb-10">
      <div className="relative overflow-hidden border-b border-line/60">
        {showCover && cover && (
          <div
            className="absolute inset-0 scale-110 bg-cover bg-center opacity-[0.16] blur-3xl"
            style={{ backgroundImage: `url(${cover})` }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-canvas/10 via-canvas/40 to-canvas" />

        <div className="relative px-8 pb-7 pt-6">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 rounded-full border border-line/70 bg-surface/40 px-3 py-1.5 text-[11px] font-medium text-muted backdrop-blur transition hover:border-line hover:text-ink"
          >
            <ArrowLeft className="size-3.5" />
            Back
          </button>

          <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-end">
            <div
              className={cn(
                'relative size-44 shrink-0 overflow-hidden border border-line/60 bg-surface-2 shadow-2xl shadow-black/35',
                kind === 'artist' ? 'rounded-full' : 'rounded-2xl'
              )}
            >
              {showCover && cover ? (
                <img
                  src={cover}
                  alt=""
                  draggable={false}
                  onError={() =>
                    setFailedCovers((previous) => {
                      const next = new Set(previous)
                      next.add(cover)
                      return next
                    })
                  }
                  className="size-full object-cover"
                />
              ) : (
                <div className="grid size-full place-items-center bg-gradient-to-br from-surface-3 to-surface">
                  {kind === 'artist' ? (
                    <UserRound className="size-16 text-faint" />
                  ) : (
                    <Disc3 className="size-16 text-faint" />
                  )}
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1 pb-1">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
                <Disc3 className="size-3" />
                {KIND_LABELS[kind]}
              </div>
              <h1 className="mt-2 text-[32px] font-semibold leading-tight tracking-[-0.04em] text-ink sm:text-[40px]">
                {data.title}
              </h1>

              {(data.author?.name || details) && (
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-faint">
                  {data.author?.name &&
                    (data.author.id ? (
                      <button
                        type="button"
                        onClick={() => navigate(`/artist/${data.author?.id}`)}
                        className="font-medium text-muted transition hover:text-accent"
                      >
                        {data.author.name}
                      </button>
                    ) : (
                      <span className="font-medium text-muted">{data.author.name}</span>
                    ))}
                  {data.author?.name && details && <span>•</span>}
                  {details && <span>{details}</span>}
                </div>
              )}

              {data.description && (
                <p
                  className="mt-3 line-clamp-3 max-w-2xl whitespace-pre-line text-[12px] leading-relaxed text-muted"
                  title={data.description}
                >
                  {data.description}
                </p>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={playAll}
                  disabled={queueTracks.length === 0}
                  className="flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[13px] font-semibold text-accent-ink shadow-lg shadow-accent/15 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Play className="size-4 fill-current" />
                  Play
                </button>
                <button
                  type="button"
                  onClick={shufflePlay}
                  disabled={queueTracks.length === 0}
                  className="flex items-center gap-2 rounded-full border border-line bg-surface-2/60 px-5 py-2.5 text-[13px] font-medium text-muted transition hover:border-accent/30 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Shuffle className="size-4" />
                  Shuffle
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-10 px-8 pt-8">
        {yearsError && (
          <p className="-mb-6 text-right text-[11px] text-red-300/90">
            Could not load release years. Try again.
          </p>
        )}
        <TrackList
          title={tracksTitle}
          tracks={displayTracks}
          countLabel={kind === 'artist' ? topSongsLabel : countLabel}
          onPlay={playCollectionTrack}
          emptyText={
            kind === 'playlist' && query.trim()
              ? 'No tracks match your filter.'
              : 'No tracks were found here.'
          }
          action={
            kind === 'playlist' ? (
              <TrackToolbar
                query={query}
                onQueryChange={handleQueryChange}
                sort={sortKey}
                onSortChange={handleSortChange}
                sortLoading={loadingYears}
                disabled={loadedTracks.length === 0}
              />
            ) : kind === 'artist' && id && artistTracks.length > 0 ? (
              <button
                type="button"
                onClick={() => navigate(`/artist/${id}/songs`)}
                className="flex items-center gap-1 rounded-full border border-line/70 bg-surface/40 px-3.5 py-2 text-[12px] font-medium text-muted transition hover:border-accent/30 hover:text-ink"
              >
                All songs
                <ChevronRight className="size-3.5" />
              </button>
            ) : undefined
          }
          footer={
            hasMore || bulkLoading ? (
              <div>
                {bulkLoading ? (
                  <div className="flex w-full items-center justify-center gap-2 rounded-xl border border-line/60 bg-surface/30 px-4 py-3 text-[12px] font-medium text-muted">
                    <Loader2 className="size-4 animate-spin" />
                    Loading all tracks… {loadedTracks.length}
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
                      {loadMore.isPending ? 'Loading more tracks…' : 'Load more tracks'}
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
                {loadMoreError && (
                  <p className="mt-2 text-center text-[11px] text-red-300/90">
                    Could not load more tracks. Try again.
                  </p>
                )}
              </div>
            ) : undefined
          }
        />

        {data.sections.map((section) => (
          <MediaShelf
            key={section.title}
            title={section.title}
            items={section.items}
            onSelect={handleSectionSelect}
          />
        ))}
      </div>
    </div>
  )
}
