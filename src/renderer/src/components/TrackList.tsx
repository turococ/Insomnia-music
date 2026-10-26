import { useRef, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { MediaItem } from '@shared/types'
import { MediaRow } from '@renderer/components/MediaRow'
import { useMainScroll } from '@renderer/lib/mainScroll'

interface TrackListProps {
  title: string
  tracks: MediaItem[]
  countLabel: string
  onPlay: (track: MediaItem) => void
  action?: ReactNode
  footer?: ReactNode
  emptyText?: string
}

const ROW_HEIGHT = 60
const ROW_GAP = 2
const ROW_SIZE = ROW_HEIGHT + ROW_GAP
const VIRTUALIZE_AFTER = 80

export function TrackList({
  title,
  tracks,
  countLabel,
  onPlay,
  action,
  footer,
  emptyText = 'No playable tracks were found here.'
}: TrackListProps): React.JSX.Element {
  const scrollElement = useMainScroll()
  const listRef = useRef<HTMLDivElement>(null)
  const virtualize = tracks.length > VIRTUALIZE_AFTER && scrollElement !== null

  // offsetTop is relative to the positioned <main> scroll container, which is
  // exactly the offset the virtualizer needs to align rows with the page.
  const scrollMargin = listRef.current?.offsetTop ?? 0
  // TanStack Virtual is not compatible with the React Compiler and cannot be
  // memoized safely; the virtualizer manages its own subscriptions.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => ROW_SIZE,
    overscan: 10,
    scrollMargin,
    enabled: virtualize
  })

  const renderRow = (track: MediaItem, index: number): React.JSX.Element => (
    <MediaRow
      key={`${track.kind}:${track.id}:${index}`}
      item={track}
      index={index}
      onPlay={onPlay}
    />
  )

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">{title}</h2>
          <p className="mt-0.5 text-[11px] text-faint">{countLabel}</p>
        </div>
        {action}
      </div>

      {tracks.length > 0 ? (
        <div className="rounded-2xl border border-line/60 bg-surface/30 p-2">
          <div className="hidden grid-cols-[28px_44px_minmax(0,2.2fr)_minmax(0,1.3fr)_64px_64px] items-center gap-3 px-3 pb-2 pt-1 text-[10px] uppercase tracking-[0.14em] text-faint sm:grid">
            <span>#</span>
            <span />
            <span>Title</span>
            <span>Album</span>
            <span className="text-right">Time</span>
            <span />
          </div>
          {virtualize ? (
            <div
              ref={listRef}
              style={{ height: virtualizer.getTotalSize() }}
              className="relative w-full"
            >
              {virtualizer.getVirtualItems().map((virtualRow) => (
                <div
                  key={`${tracks[virtualRow.index].kind}:${tracks[virtualRow.index].id}:${virtualRow.index}`}
                  className="absolute left-0 top-0 w-full pb-0.5"
                  style={{
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start - scrollMargin}px)`
                  }}
                >
                  {renderRow(tracks[virtualRow.index], virtualRow.index)}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-0.5">
              {tracks.map((track, index) => renderRow(track, index))}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-line p-8 text-center">
          <p className="text-sm text-muted">{emptyText}</p>
        </div>
      )}

      {footer && <div className="mt-3">{footer}</div>}
    </section>
  )
}
