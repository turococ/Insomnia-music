import { useEffect, useMemo, useRef, useState } from 'react'
import type { MediaItem } from '@shared/types'
import { sortTracks, type TrackSortKey } from '@renderer/lib/trackSort'

interface UseTrackSortOptions {
  initialSort?: TrackSortKey
}

export function useTrackSort(
  tracks: MediaItem[],
  { initialSort = 'popularity' }: UseTrackSortOptions = {}
): {
  sortKey: TrackSortKey
  sortedTracks: MediaItem[]
  loadingYears: boolean
  yearsError: boolean
  changeSort: (next: TrackSortKey) => void
} {
  const [sortKey, setSortKey] = useState<TrackSortKey>(initialSort)
  const [appliedSort, setAppliedSort] = useState<TrackSortKey>(initialSort)
  const [albumYears, setAlbumYears] = useState<Record<string, number>>({})
  const [loadingYears, setLoadingYears] = useState(false)
  const [yearsError, setYearsError] = useState(false)
  const request = useRef(0)
  const requestedYears = useRef<Set<string>>(new Set())

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
    if (appliedSort !== 'newest' && appliedSort !== 'oldest') return
    if (loadingYears) return

    const missing = albumIds.filter(
      (id) => albumYears[id] === undefined && !requestedYears.current.has(id)
    )
    if (missing.length === 0) return

    for (const id of missing) requestedYears.current.add(id)

    const requestId = request.current + 1
    request.current = requestId
    setLoadingYears(true)
    setYearsError(false)

    void window.api.music
      .albumYears(missing)
      .then((years) => {
        if (request.current !== requestId) return
        setAlbumYears((previous) => ({ ...previous, ...years }))
      })
      .catch(() => {
        if (request.current !== requestId) return
        for (const id of missing) requestedYears.current.delete(id)
        setYearsError(true)
      })
      .finally(() => {
        if (request.current === requestId) setLoadingYears(false)
      })
  }, [albumIds, albumYears, appliedSort, loadingYears])

  const changeSort = (next: TrackSortKey): void => {
    setSortKey(next)
    setAppliedSort(next)
    if (next !== 'newest' && next !== 'oldest') {
      setLoadingYears(false)
      setYearsError(false)
    }
  }

  return {
    sortKey,
    sortedTracks,
    loadingYears,
    yearsError,
    changeSort
  }
}
