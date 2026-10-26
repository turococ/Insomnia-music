import type { ReactNode } from 'react'
import type { MediaItem } from '@shared/types'
import { MediaRow } from '@renderer/components/MediaRow'

interface TrackListProps {
  title: string
  tracks: MediaItem[]
  countLabel: string
  onPlay: (track: MediaItem) => void
  action?: ReactNode
  footer?: ReactNode
  emptyText?: string
}

export function TrackList({
  title,
  tracks,
  countLabel,
  onPlay,
  action,
  footer,
  emptyText = 'No playable tracks were found here.'
}: TrackListProps): React.JSX.Element {
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
          <div className="space-y-0.5">
            {tracks.map((track, index) => (
              <MediaRow
                key={`${track.kind}:${track.id}:${index}`}
                item={track}
                index={index}
                onPlay={onPlay}
              />
            ))}
          </div>
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
