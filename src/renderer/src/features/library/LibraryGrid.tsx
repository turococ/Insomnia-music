import { ChevronDown, Loader2, RotateCcw, Search, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import type { LibraryListKind, MediaItem } from '@shared/types'
import { MediaCard } from '@renderer/components/MediaCard'
import { collectionPath } from '@renderer/lib/media'
import { filterTracks } from '@renderer/lib/trackFilter'

const LABELS: Record<
  LibraryListKind,
  { singular: string; plural: string; empty: string; placeholder: string }
> = {
  playlists: {
    singular: 'playlist',
    plural: 'playlists',
    empty: 'No playlists in your library yet.',
    placeholder: 'Filter playlists…'
  },
  albums: {
    singular: 'album',
    plural: 'albums',
    empty: 'No saved albums in your library yet.',
    placeholder: 'Filter albums…'
  },
  artists: {
    singular: 'artist',
    plural: 'artists',
    empty: 'No library artists yet.',
    placeholder: 'Filter artists…'
  }
}

interface ExtraItems {
  items: MediaItem[]
  hasMore: boolean
}

function LibraryGridSkeleton(): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {Array.from({ length: 12 }).map((_, index) => (
        <div key={index} className="space-y-3">
          <div className="aspect-square animate-pulse rounded-xl bg-surface-2" />
          <div className="h-3 w-3/4 animate-pulse rounded-full bg-surface-2" />
          <div className="h-2.5 w-1/2 animate-pulse rounded-full bg-surface-2" />
        </div>
      ))}
    </div>
  )
}

export function LibraryGrid({ kind }: { kind: LibraryListKind }): React.JSX.Element {
  const navigate = useNavigate()
  const labels = LABELS[kind]
  const [query, setQuery] = useState('')
  const [extra, setExtra] = useState<ExtraItems | null>(null)
  const [bulkLoading, setBulkLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const bulkRequest = useRef(0)
  const bulkLoadingRef = useRef(false)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['library', kind],
    queryFn: () => window.api.library.list(kind),
    staleTime: 5 * 60 * 1000
  })

  const loadMore = useMutation({
    mutationFn: () => window.api.library.more(kind),
    onSuccess: (page) => {
      setLoadError(false)
      setExtra((previous) => ({
        items: [...(previous?.items ?? []), ...page.items],
        hasMore: page.hasMore
      }))
    },
    onError: () => setLoadError(true)
  })

  const loadedItems = useMemo(() => {
    if (!data) return []
    return [...data.items, ...(extra?.items ?? [])]
  }, [data, extra])

  const hasMore = Boolean(extra ? extra.hasMore : data?.hasMore)
  const filteredItems = useMemo(() => filterTracks(loadedItems, query), [loadedItems, query])

  const loadAll = async (): Promise<void> => {
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
        const page = await window.api.library.more(kind)
        if (bulkRequest.current !== requestId) return

        setExtra((previous) => ({
          items: [...(previous?.items ?? []), ...page.items],
          hasMore: page.hasMore
        }))

        if (page.items.length === 0) {
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
    if (value.trim() && hasMore) void loadAll()
  }

  if (isLoading) return <LibraryGridSkeleton />

  if (isError || !data) {
    return (
      <div className="rounded-3xl border border-line bg-surface p-8 text-center">
        <h2 className="text-base font-semibold">Could not load your {labels.plural}</h2>
        <p className="mx-auto mt-2 max-w-sm text-[12px] leading-relaxed text-muted">
          YouTube Music did not return this part of your library. Check your connection and try
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

  const countLabel = query.trim()
    ? `${filteredItems.length} of ${loadedItems.length}${hasMore ? '+' : ''} ${labels.plural}`
    : `${loadedItems.length}${hasMore ? '+' : ''} ${
        loadedItems.length === 1 ? labels.singular : labels.plural
      }`

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] text-faint">{countLabel}</p>
        <div className="relative w-full max-w-[260px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <input
            type="text"
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            placeholder={labels.placeholder}
            aria-label={`Filter ${labels.plural}`}
            className="h-9 w-full rounded-full border border-line/70 bg-surface/50 pl-9 pr-8 text-[12px] text-ink outline-none transition placeholder:text-faint focus:border-accent/40 focus:ring-2 focus:ring-accent/10"
          />
          {query && (
            <button
              type="button"
              onClick={() => handleQueryChange('')}
              aria-label={`Clear ${labels.plural} filter`}
              className="absolute right-2 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-full text-faint transition hover:bg-surface-2 hover:text-ink"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>

      {filteredItems.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {filteredItems.map((item) => (
            <MediaCard
              key={`${item.kind}:${item.id}`}
              item={item}
              onSelect={(selected) => {
                const path = collectionPath(selected)
                if (path) navigate(path)
              }}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-line p-10 text-center">
          <p className="text-sm text-muted">
            {query.trim() ? `No ${labels.plural} match your filter.` : labels.empty}
          </p>
        </div>
      )}

      {(hasMore || bulkLoading) && (
        <div>
          {bulkLoading ? (
            <div className="flex w-full items-center justify-center gap-2 rounded-xl border border-line/60 bg-surface/30 px-4 py-3 text-[12px] font-medium text-muted">
              <Loader2 className="size-4 animate-spin" />
              Loading all {labels.plural}… {loadedItems.length}
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
                {loadMore.isPending
                  ? `Loading more ${labels.plural}…`
                  : `Load more ${labels.plural}`}
              </button>
              <button
                type="button"
                onClick={() => void loadAll()}
                disabled={loadMore.isPending}
                className="flex items-center justify-center gap-2 rounded-xl border border-line/60 bg-surface/30 px-4 py-3 text-[12px] font-medium text-muted transition hover:border-accent/30 hover:text-ink disabled:cursor-wait disabled:opacity-60"
              >
                Load all
              </button>
            </div>
          )}
          {loadError && (
            <p className="mt-2 text-center text-[11px] text-red-300/90">
              Could not load more {labels.plural}. Try again.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
