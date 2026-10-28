import { Pause, Play, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import type { MediaItem } from '@shared/types'
import { MediaShelf } from '@renderer/components/MediaShelf'
import { usePlayer } from '@renderer/features/player/store'
import { cn } from '@renderer/lib/cn'
import { greetingFor, useDayPeriod } from '@renderer/lib/timeOfDay'
import {
  collectionPath,
  isPlayable,
  itemSubtitle,
  mergeTracks,
  pickThumbnail
} from '@renderer/lib/media'

function QuickPick({
  item,
  onPlay
}: {
  item: MediaItem
  onPlay: (item: MediaItem) => void
}): React.JSX.Element {
  const current = usePlayer((state) => state.current)
  const isPlaying = usePlayer((state) => state.isPlaying)
  const [imageFailed, setImageFailed] = useState(false)
  const active = current?.id === item.id
  const cover = imageFailed ? undefined : pickThumbnail(item.thumbnails, 160)

  return (
    <button
      type="button"
      onClick={() => onPlay(item)}
      className={cn(
        'group flex min-w-0 items-center gap-3 rounded-xl p-2 text-left transition',
        active ? 'bg-accent/[0.07]' : 'hover:bg-surface-2/80'
      )}
    >
      <div className="relative size-14 shrink-0 overflow-hidden rounded-lg border border-line/50 bg-surface-2">
        {cover ? (
          <img
            src={cover}
            alt=""
            draggable={false}
            loading="lazy"
            onError={() => setImageFailed(true)}
            className={cn(
              'size-full object-cover transition duration-300 group-hover:scale-[1.04]',
              active && 'brightness-[0.7]'
            )}
          />
        ) : (
          <div className="grid size-full place-items-center text-faint">♪</div>
        )}
        <span
          className={cn(
            'absolute inset-0 grid place-items-center bg-black/35 text-accent transition',
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
        >
          {active && isPlaying ? (
            <Pause className="size-4 fill-current" />
          ) : (
            <Play className="ml-0.5 size-4 fill-current" />
          )}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'truncate text-[13px] font-medium leading-5',
            active ? 'text-accent' : 'text-ink'
          )}
        >
          {item.title}
        </div>
        <div className="truncate text-[11px] leading-4 text-faint">
          {itemSubtitle(item) || item.kind}
        </div>
      </div>
    </button>
  )
}

function QuickPicks({
  title,
  items,
  onPlay
}: {
  title: string
  items: MediaItem[]
  onPlay: (item: MediaItem, sectionItems: MediaItem[]) => void
}): React.JSX.Element {
  const tracks = mergeTracks(items)

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">{title}</h2>
        {tracks.length > 0 && (
          <button
            type="button"
            onClick={() => onPlay(tracks[0], items)}
            className="flex items-center gap-2 rounded-full border border-line/80 bg-surface-2/60 px-3.5 py-1.5 text-[11px] font-medium text-muted transition hover:border-accent/30 hover:text-ink"
          >
            <Play className="size-3 fill-current" />
            Play all
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-2 gap-y-1 xl:grid-cols-4">
        {tracks.slice(0, 8).map((item) => (
          <QuickPick
            key={`${item.kind}:${item.id}`}
            item={item}
            onPlay={(track) => onPlay(track, items)}
          />
        ))}
      </div>
    </section>
  )
}

function HomeSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-9 p-8">
      <div className="space-y-5">
        <div className="space-y-2">
          <div className="h-3 w-24 animate-pulse rounded-full bg-surface-2" />
          <div className="h-8 w-52 animate-pulse rounded-full bg-surface-2" />
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-9 w-24 animate-pulse rounded-full bg-surface-2" />
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <div className="h-6 w-36 animate-pulse rounded-full bg-surface-2" />
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3 p-2">
              <div className="size-14 animate-pulse rounded-lg bg-surface-2" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-3/4 animate-pulse rounded-full bg-surface-2" />
                <div className="h-2.5 w-1/2 animate-pulse rounded-full bg-surface-2" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {[0, 1].map((row) => (
        <div key={row} className="space-y-3">
          <div className="h-6 w-36 animate-pulse rounded-full bg-surface-2" />
          <div className="flex gap-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="w-[156px] shrink-0 space-y-3 sm:w-[168px] xl:w-[180px]">
                <div className="aspect-square animate-pulse rounded-xl bg-surface-2" />
                <div className="h-3 w-3/4 animate-pulse rounded-full bg-surface-2" />
                <div className="h-2.5 w-1/2 animate-pulse rounded-full bg-surface-2" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function HomePage(): React.JSX.Element {
  const playTrack = usePlayer((state) => state.playTrack)
  const navigate = useNavigate()
  const period = useDayPeriod()
  const [filter, setFilter] = useState<string | null>(null)

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['home', filter],
    queryFn: () => window.api.music.home(filter ?? undefined),
    placeholderData: keepPreviousData
  })

  const sections = data?.sections ?? []
  const filters = ['All', ...(data?.filters ?? [])]

  const handlePlay = (item: MediaItem, sectionItems: MediaItem[]): void => {
    const tracks = mergeTracks(sectionItems)
    if (tracks.some((track) => track.id === item.id)) {
      void playTrack(item, tracks)
    }
  }

  const handleSelect = (item: MediaItem, sectionItems: MediaItem[]): void => {
    if (isPlayable(item)) {
      handlePlay(item, sectionItems)
      return
    }

    const path = collectionPath(item)
    if (path) navigate(path)
  }

  if (isLoading) return <HomeSkeleton />

  if (isError || !data) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-md rounded-3xl border border-line bg-surface p-8 text-center">
          <Sparkles className="mx-auto size-8 text-accent" />
          <h2 className="mt-4 text-lg font-semibold">Could not load your home feed</h2>
          <p className="mt-2 text-sm text-muted">
            YouTube Music did not return any sections. Check your connection and try again.
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-5 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-accent-ink"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-9 p-8">
      <div className="space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
              <Sparkles className="size-3" />
              Home
            </div>
            <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.03em] text-ink">
              {greetingFor(period)}
            </h1>
          </div>
          {isFetching && (
            <div className="flex items-center gap-2 text-[10px] text-faint">
              <span className="size-1.5 animate-pulse rounded-full bg-accent" />
              Updating
            </div>
          )}
        </div>

        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {filters.map((label) => {
            const value = label === 'All' ? null : label
            const active = filter === value

            return (
              <button
                key={label}
                type="button"
                onClick={() => setFilter(value)}
                className={cn(
                  'shrink-0 rounded-full border px-4 py-2 text-[12px] font-medium transition',
                  active
                    ? 'border-accent/40 bg-accent/15 text-accent'
                    : 'border-line/80 bg-surface-2/50 text-muted hover:border-line hover:text-ink'
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      <div className={cn('space-y-10 transition-opacity', isFetching && 'opacity-55')}>
        {sections.map((section) =>
          section.title.toLowerCase().includes('quick picks') ? (
            <QuickPicks
              key={section.title}
              title={section.title}
              items={section.items}
              onPlay={handlePlay}
            />
          ) : (
            <MediaShelf
              key={section.title}
              title={section.title}
              items={section.items}
              onSelect={handleSelect}
            />
          )
        )}

        {sections.length === 0 && (
          <div className="rounded-3xl border border-dashed border-line p-10 text-center">
            <Sparkles className="mx-auto size-7 text-faint" />
            <h2 className="mt-4 text-base font-semibold">Nothing here yet</h2>
            <p className="mt-2 text-sm text-muted">
              Try a different mood, or search for something to play.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
