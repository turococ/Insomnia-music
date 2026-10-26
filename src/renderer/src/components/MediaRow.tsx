import { Heart, MoreHorizontal, Music2, Pause, Play } from 'lucide-react'
import type { MediaItem } from '@shared/types'
import { cn } from '@renderer/lib/cn'
import { formatTime, itemSubtitle, pickThumbnail } from '@renderer/lib/media'
import { useAuth } from '@renderer/features/auth/context'
import { useLikes } from '@renderer/features/library/likes'
import { useTrackMenu } from '@renderer/features/player/menu'
import { usePlayer } from '@renderer/features/player/store'

interface MediaRowProps {
  item: MediaItem
  index?: number
  onPlay: (item: MediaItem) => void
}

export function MediaRow({ item, index, onPlay }: MediaRowProps): React.JSX.Element {
  const current = usePlayer((state) => state.current)
  const isPlaying = usePlayer((state) => state.isPlaying)
  const openMenu = useTrackMenu((state) => state.open)
  const { status } = useAuth()
  const authenticated = Boolean(status?.authenticated)
  const liked = useLikes((state) => state.status[item.id] ?? false)
  const likePending = useLikes((state) => Boolean(state.pending[item.id]))
  const ensureLike = useLikes((state) => state.ensure)
  const toggleLiked = useLikes((state) => state.toggle)
  const active = current?.id === item.id
  const playable = item.kind === 'song' || item.kind === 'video'
  const canLike = playable && authenticated
  const cover = pickThumbnail(item.thumbnails, 80)

  const openAt = (x: number, y: number): void => {
    if (playable) openMenu(item, x, y)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onPlay(item)}
      onMouseEnter={() => {
        if (canLike) void ensureLike(item.id)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onPlay(item)
      }}
      onContextMenu={(event) => {
        if (!playable) return
        event.preventDefault()
        openAt(event.clientX, event.clientY)
      }}
      className={cn(
        'group grid w-full cursor-pointer grid-cols-[28px_44px_minmax(0,2.2fr)_minmax(0,1.3fr)_64px_64px] items-center gap-3 rounded-xl px-3 py-2 text-left outline-none transition focus-visible:ring-1 focus-visible:ring-accent/40',
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
          <img
            src={cover}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            className="size-full object-cover"
          />
        ) : (
          <div className="grid size-full place-items-center">
            <Music2 className="size-4 text-faint" />
          </div>
        )}
        <span
          aria-hidden
          className="absolute inset-0 grid place-items-center bg-black/45 text-white opacity-0 transition group-hover:opacity-100"
        >
          {active && isPlaying ? (
            <Pause className="size-4 fill-current" />
          ) : (
            <Play className="ml-0.5 size-4 fill-current" />
          )}
        </span>
      </div>

      <div className="min-w-0">
        <div
          className={cn('truncate text-[13px] font-medium', active ? 'text-accent' : 'text-ink')}
        >
          {item.title}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-faint">{itemSubtitle(item)}</div>
      </div>

      <div className="truncate text-[11px] text-faint">{item.album?.name ?? ''}</div>

      <div className="text-right text-[11px] tabular-nums text-faint">
        {item.duration ? formatTime(item.duration) : ''}
      </div>

      <div className="flex items-center justify-end gap-0.5">
        {canLike && (
          <button
            type="button"
            aria-label={liked ? `Remove ${item.title} from Liked Music` : `Like ${item.title}`}
            aria-pressed={liked}
            disabled={likePending}
            onClick={(event) => {
              event.stopPropagation()
              void toggleLiked(item)
            }}
            className={cn(
              'grid size-7 place-items-center rounded-full transition hover:bg-surface-2 disabled:cursor-wait',
              liked
                ? 'text-accent opacity-100'
                : 'text-faint opacity-0 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100'
            )}
          >
            <Heart className={cn('size-4', liked && 'fill-current')} />
          </button>
        )}
        {playable && (
          <button
            type="button"
            aria-label={`More options for ${item.title}`}
            onClick={(event) => {
              event.stopPropagation()
              const rect = event.currentTarget.getBoundingClientRect()
              openAt(rect.right - 232, rect.bottom + 6)
            }}
            className="grid size-7 place-items-center rounded-full text-faint opacity-0 transition hover:bg-surface-2 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </button>
        )}
      </div>
    </div>
  )
}
