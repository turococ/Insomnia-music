import { Pause, Play, Music2 } from 'lucide-react'
import type { MediaItem } from '@shared/types'
import { cn } from '@renderer/lib/cn'
import { formatTime, itemSubtitle, pickThumbnail } from '@renderer/lib/media'
import { usePlayer } from '@renderer/features/player/store'

interface MediaRowProps {
  item: MediaItem
  index?: number
  onPlay: (item: MediaItem) => void
}

export function MediaRow({ item, index, onPlay }: MediaRowProps): React.JSX.Element {
  const current = usePlayer((state) => state.current)
  const isPlaying = usePlayer((state) => state.isPlaying)
  const active = current?.id === item.id
  const cover = pickThumbnail(item.thumbnails, 80)

  return (
    <button
      type="button"
      onClick={() => onPlay(item)}
      className={cn(
        'group grid w-full grid-cols-[28px_44px_minmax(0,2.2fr)_minmax(0,1.3fr)_64px] items-center gap-3 rounded-xl px-3 py-2 text-left transition',
        active ? 'bg-accent/[0.07]' : 'hover:bg-surface-2/80'
      )}
    >
      <div className="grid size-7 place-items-center text-[11px] tabular-nums text-faint">
        <span className={cn('group-hover:hidden', active && 'hidden')}>
          {typeof index === 'number' ? index + 1 : ''}
        </span>
        <span className={cn('hidden group-hover:block', active && 'block')}>
          {active && isPlaying ? (
            <Pause className="size-3.5 fill-current text-accent" />
          ) : (
            <Play className="ml-0.5 size-3.5 fill-current text-accent" />
          )}
        </span>
      </div>

      <div className="relative size-11 overflow-hidden rounded-lg border border-line/60 bg-surface-2">
        {cover ? (
          <img src={cover} alt="" draggable={false} className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center">
            <Music2 className="size-4 text-faint" />
          </div>
        )}
      </div>

      <div className="min-w-0">
        <div
          className={cn(
            'truncate text-[13px] font-medium',
            active ? 'text-accent' : 'text-ink'
          )}
        >
          {item.title}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-faint">{itemSubtitle(item)}</div>
      </div>

      <div className="truncate text-[11px] text-faint">{item.album?.name ?? ''}</div>

      <div className="text-right text-[11px] tabular-nums text-faint">
        {item.duration ? formatTime(item.duration) : ''}
      </div>
    </button>
  )
}
