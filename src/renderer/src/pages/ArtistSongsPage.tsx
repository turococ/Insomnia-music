import { ArrowLeft, Disc3, Play, Shuffle, UserRound } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { MediaItem } from '@shared/types'
import { TrackList } from '@renderer/components/TrackList'
import { TrackSortMenu } from '@renderer/components/TrackSortMenu'
import { usePlayer, type QueueSource } from '@renderer/features/player/store'
import { pickThumbnail } from '@renderer/lib/media'
import { sortTracks, type TrackSortKey } from '@renderer/lib/trackSort'

function ArtistSongsSkeleton(): React.JSX.Element {
  return (
    <div className="p-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
        <div className="size-36 shrink-0 animate-pulse rounded-full bg-surface-2" />
        <div className="flex-1 space-y-4 pb-2">
          <div className="h-3 w-24 animate-pulse rounded-full bg-surface-2" />
          <div className="h-9 w-1/2 animate-pulse rounded-full bg-surface-2" />
          <div className="h-3 w-32 animate-pulse rounded-full bg-surface-2" />
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

export function ArtistSongsPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const playTrack = usePlayer((state) => state.playTrack)
  const [sortKey, setSortKey] = useState<TrackSortKey>('popularity')
  const [appliedSort, setAppliedSort] = useState<TrackSortKey>('popularity')
  const [albumYears, setAlbumYears] = useState<Record<string, number>>({})
  const [yearsLoaded, setYearsLoaded] = useState(false)
  const [loadingYears, setLoadingYears] = useState(false)
  const [yearsError, setYearsError] = useState(false)
  const [failedCovers, setFailedCovers] = useState<Set<string>>(() => new Set())
  const yearsRequest = useRef(0)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['collection', 'artist', id],
    queryFn: () => window.api.music.collection('artist', id ?? ''),
    enabled: Boolean(id),
    staleTime: 5 * 60 * 1000
  })

  const tracks = useMemo(() => {
    if (!data) return []
    return data.allTracks?.length ? data.allTracks : data.tracks
  }, [data])

  const albumIds = useMemo(() => {
    const ids = new Set<string>()
    for (const track of tracks) {
      if (!track.year && track.album?.id) ids.add(track.album.id)
    }
    return [...ids]
  }, [tracks])

  const sortedTracks = useMemo(
    () => sortTracks(tracks, appliedSort, { albumYears }),
    [tracks, appliedSort, albumYears]
  )

  useEffect(() => {
    document.querySelector('main')?.scrollTo({ top: 0 })
    yearsRequest.current += 1
    setSortKey('popularity')
    setAppliedSort('popularity')
    setAlbumYears({})
    setYearsLoaded(false)
    setLoadingYears(false)
    setYearsError(false)
    setFailedCovers(new Set())
  }, [id])

  const handleSortChange = (next: TrackSortKey): void => {
    if (next !== 'newest' && next !== 'oldest') {
      setSortKey(next)
      setAppliedSort(next)
      return
    }

    if (yearsLoaded || albumIds.length === 0) {
      setSortKey(next)
      setAppliedSort(next)
      return
    }

    const requestId = yearsRequest.current + 1
    yearsRequest.current = requestId
    setSortKey(next)
    setLoadingYears(true)
    setYearsError(false)

    void window.api.music
      .albumYears(albumIds)
      .then((years) => {
        if (yearsRequest.current !== requestId) return
        setAlbumYears((previous) => ({ ...previous, ...years }))
        setYearsLoaded(true)
        setAppliedSort(next)
      })
      .catch(() => {
        if (yearsRequest.current !== requestId) return
        setYearsError(true)
        setSortKey(appliedSort)
      })
      .finally(() => {
        if (yearsRequest.current === requestId) setLoadingYears(false)
      })
  }

  if (isLoading) return <ArtistSongsSkeleton />

  if (isError || !data) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-md rounded-3xl border border-line bg-surface p-8 text-center">
          <Disc3 className="mx-auto size-8 text-accent" />
          <h2 className="mt-4 text-lg font-semibold">Could not load this artist</h2>
          <p className="mt-2 text-sm text-muted">
            YouTube Music did not return this artist. It may be unavailable in your region.
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
  const fallbackCover = tracks
    .map((track) => pickThumbnail(track.thumbnails, 640))
    .find((url): url is string => Boolean(url))
  const coverCandidates = [headerCover, fallbackCover].filter((url): url is string => Boolean(url))
  const cover = coverCandidates.find((url) => !failedCovers.has(url))
  const source: QueueSource | undefined = id ? { kind: 'artist', id } : undefined
  const countLabel = `${tracks.length} ${tracks.length === 1 ? 'song' : 'songs'}`

  const playAll = (): void => {
    if (sortedTracks.length > 0) void playTrack(sortedTracks[0], sortedTracks, source)
  }

  const shufflePlay = (): void => {
    if (sortedTracks.length === 0) return
    const shuffled = [...sortedTracks].sort(() => Math.random() - 0.5)
    void playTrack(shuffled[0], shuffled, source)
  }

  const playTrackFromList = (track: MediaItem): void => {
    void playTrack(track, sortedTracks, source)
  }

  return (
    <div className="pb-10">
      <div className="relative overflow-hidden border-b border-line/60">
        {cover && (
          <div
            className="absolute inset-0 scale-110 bg-cover bg-center opacity-[0.16] blur-3xl"
            style={{ backgroundImage: `url(${cover})` }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-canvas/10 via-canvas/40 to-canvas" />

        <div className="relative px-8 pb-7 pt-6">
          <button
            type="button"
            onClick={() => (id ? navigate(`/artist/${id}`) : navigate(-1))}
            className="flex items-center gap-2 rounded-full border border-line/70 bg-surface/40 px-3 py-1.5 text-[11px] font-medium text-muted backdrop-blur transition hover:border-line hover:text-ink"
          >
            <ArrowLeft className="size-3.5" />
            Back to artist
          </button>

          <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-end">
            <div className="relative size-36 shrink-0 overflow-hidden rounded-full border border-line/60 bg-surface-2 shadow-2xl shadow-black/35">
              {cover ? (
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
                  <UserRound className="size-14 text-faint" />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1 pb-1">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
                <Disc3 className="size-3" />
                Artist
              </div>
              <h1 className="mt-2 text-[32px] font-semibold leading-tight tracking-[-0.04em] text-ink sm:text-[40px]">
                All songs
              </h1>
              <p className="mt-2 text-[12px] text-faint">
                <button
                  type="button"
                  onClick={() => id && navigate(`/artist/${id}`)}
                  className="font-medium text-muted transition hover:text-accent"
                >
                  {data.title}
                </button>
                <span className="mx-1.5">•</span>
                <span>{countLabel}</span>
              </p>

              <div className="mt-5 flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={playAll}
                  disabled={sortedTracks.length === 0}
                  className="flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[13px] font-semibold text-accent-ink shadow-lg shadow-accent/15 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Play className="size-4 fill-current" />
                  Play
                </button>
                <button
                  type="button"
                  onClick={shufflePlay}
                  disabled={sortedTracks.length === 0}
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

      <div className="px-8 pt-8">
        {yearsError && (
          <p className="mb-3 text-right text-[11px] text-red-300/90">
            Could not load release years. Try again.
          </p>
        )}
        <TrackList
          title="All songs"
          tracks={sortedTracks}
          countLabel={countLabel}
          onPlay={playTrackFromList}
          action={
            <TrackSortMenu
              value={sortKey}
              onChange={handleSortChange}
              loading={loadingYears}
              disabled={tracks.length === 0}
            />
          }
        />
      </div>
    </div>
  )
}
