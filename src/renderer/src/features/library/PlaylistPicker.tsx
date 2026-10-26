import { ChevronDown, ListMusic, Loader2, Plus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import type { MediaItem, PlaylistChoice } from '@shared/types'
import { toast } from '@renderer/features/toast/store'
import { cn } from '@renderer/lib/cn'
import { errorMessage } from '@renderer/lib/errors'
import { pickThumbnail } from '@renderer/lib/media'
import { queryClient } from '@renderer/lib/queryClient'
import { usePlaylistPicker } from './picker'

async function refreshLibraryViews(): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['collection'] }),
    queryClient.invalidateQueries({ queryKey: ['library'] }),
    queryClient.invalidateQueries({ queryKey: ['music', 'playlist-picker'] })
  ])
}

function PlaylistPickerDialog({ item }: { item: MediaItem }): React.JSX.Element {
  const close = usePlaylistPicker((state) => state.close)
  const [query, setQuery] = useState('')
  const [title, setTitle] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['music', 'playlist-picker'],
      queryFn: ({ pageParam }) => window.api.music.playlists(pageParam),
      initialPageParam: false,
      getNextPageParam: (lastPage) => (lastPage.hasMore ? true : undefined),
      staleTime: 30 * 1000
    })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close])

  const playlists = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data])
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return term
      ? playlists.filter((playlist) => playlist.title.toLowerCase().includes(term))
      : playlists
  }, [playlists, query])

  const addToPlaylist = async (playlist: PlaylistChoice): Promise<void> => {
    if (busyId) return
    setBusyId(playlist.id)
    try {
      await window.api.music.addToPlaylist(playlist.id, item.id)
      toast(`Added “${item.title}” to ${playlist.title}`)
      await refreshLibraryViews()
      close()
    } catch (error) {
      toast(errorMessage(error, 'Could not add the track to this playlist.'), 'error')
    } finally {
      setBusyId(null)
    }
  }

  const createPlaylist = async (): Promise<void> => {
    const name = title.trim()
    if (!name || creating) return

    setCreating(true)
    try {
      const playlist = await window.api.music.createPlaylist(name, item.id)
      toast(`Created ${playlist.title} and added “${item.title}”`)
      await refreshLibraryViews()
      close()
    } catch (error) {
      toast(errorMessage(error, 'Could not create the playlist.'), 'error')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[75] grid place-items-center bg-black/55 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add to playlist"
        className="flex max-h-[min(620px,86vh)] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-line/80 bg-surface shadow-2xl shadow-black/60"
      >
        <div className="flex items-start gap-3 border-b border-line/60 px-5 py-4">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
            <ListMusic className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-ink">Add to playlist</h2>
            <p className="mt-0.5 truncate text-[11px] text-faint">{item.title}</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="grid size-8 shrink-0 place-items-center rounded-full text-faint transition hover:bg-surface-2 hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 pt-4">
          <div className="flex items-center gap-2 rounded-xl border border-line/70 bg-canvas/40 px-3">
            <Search className="size-3.5 shrink-0 text-faint" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a playlist…"
              className="h-9 min-w-0 flex-1 border-0 bg-transparent text-[12px] text-ink outline-none placeholder:text-faint"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery('')}
                className="grid size-5 place-items-center rounded-full text-faint hover:text-ink"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-muted">
              <Loader2 className="size-4 animate-spin" />
              Loading your playlists…
            </div>
          )}

          {isError && !isLoading && (
            <div className="px-3 py-8 text-center">
              <p className="text-[12px] text-muted">Could not load your playlists.</p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="mt-3 rounded-full border border-line px-4 py-1.5 text-[11px] font-medium text-muted transition hover:text-ink"
              >
                Try again
              </button>
            </div>
          )}

          {!isLoading && !isError && filtered.length === 0 && (
            <div className="px-3 py-8 text-center">
              <p className="text-[12px] text-muted">
                {playlists.length === 0
                  ? 'You have no editable playlists yet.'
                  : 'No playlists match your search.'}
              </p>
              <p className="mt-1 text-[11px] text-faint">
                Create one below and the track will be added automatically.
              </p>
            </div>
          )}

          {filtered.map((playlist) => {
            const cover = pickThumbnail(playlist.thumbnails, 80)
            const busy = busyId === playlist.id
            return (
              <button
                key={playlist.id}
                type="button"
                disabled={Boolean(busyId) || creating}
                onClick={() => void addToPlaylist(playlist)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition',
                  'hover:bg-surface-2 disabled:cursor-wait disabled:opacity-60'
                )}
              >
                <div className="size-10 shrink-0 overflow-hidden rounded-lg border border-line/60 bg-surface-2">
                  {cover ? (
                    <img src={cover} alt="" draggable={false} className="size-full object-cover" />
                  ) : (
                    <div className="grid size-full place-items-center">
                      <ListMusic className="size-4 text-faint" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium text-ink">{playlist.title}</div>
                  {playlist.subtitle && (
                    <div className="mt-0.5 truncate text-[10px] text-faint">
                      {playlist.subtitle}
                    </div>
                  )}
                </div>
                {busy ? (
                  <Loader2 className="size-4 shrink-0 animate-spin text-accent" />
                ) : (
                  <Plus className="size-4 shrink-0 text-faint" />
                )}
              </button>
            )
          })}

          {hasNextPage && !query.trim() && (
            <div className="px-2 pt-1">
              <button
                type="button"
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-line/60 px-3 py-2 text-[11px] font-medium text-muted transition hover:text-ink disabled:cursor-wait disabled:opacity-60"
              >
                {isFetchingNextPage ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ChevronDown className="size-3.5" />
                )}
                {isFetchingNextPage ? 'Loading…' : 'Load more playlists'}
              </button>
            </div>
          )}
        </div>

        <div className="border-t border-line/60 bg-canvas/30 p-4">
          <div className="flex items-center gap-2">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void createPlaylist()
              }}
              maxLength={150}
              placeholder="New playlist name"
              className="h-9 min-w-0 flex-1 rounded-xl border border-line/70 bg-canvas/40 px-3 text-[12px] text-ink outline-none transition placeholder:text-faint focus:border-accent/40"
            />
            <button
              type="button"
              onClick={() => void createPlaylist()}
              disabled={!title.trim() || creating}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-[12px] font-semibold text-accent-ink transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {creating ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function PlaylistPicker(): React.JSX.Element | null {
  const item = usePlaylistPicker((state) => state.item)
  if (!item) return null
  return <PlaylistPickerDialog key={item.id} item={item} />
}
