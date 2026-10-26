import { Play, Pause, Music2, UserRound } from 'lucide-react'
import { useState } from 'react'
import type { MediaItem } from '@shared/types'
import { cn } from '@renderer/lib/cn'
import { itemSubtitle, pickThumbnail } from '@renderer/lib/media'
import { useTrackMenu } from '@renderer/features/player/menu'
import { usePlayer } from '@renderer/features/player/store'

interface MediaCardProps {
  item: MediaItem
  onSelect: (item: MediaItem) => void
}

export function MediaCard({ item, onSelect }: MediaCardProps): React.JSX.Element {
  const current = usePlayer((state) => state.current)
  const isPlaying = usePlayer((state) => state.isPlaying)
  const openMenu = useTrackMenu((state) => state.open)
  const [imageFailed, setImageFailed] = useState(false)
  const playable = item.kind === 'song' || item.kind === 'video'
  const active = current?.id === item.id
  const cover = imageFailed ? undefined : pickThumbnail(item.thumbnails, 480)

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      onContextMenu={(event) => {
        if (!playable) return
        event.preventDefault()
        openMenu(item, event.clientX, event.clientY)
      }}
      className="group w-full text-left outline-none"
    >
      <div
        className={cn(
          'relative aspect-square overflow-hidden border border-line/50 bg-surface-2 shadow-md shadow-black/15 transition duration-300 group-hover:-translate-y-0.5 group-hover:border-line group-hover:shadow-lg group-hover:shadow-black/25',
          item.kind === 'artist' ? 'rounded-full' : 'rounded-xl'
        )}
      >
        {cover ? (
          <img
            src={cover}
            alt=""
            draggable={false}
            loading="lazy"
            onError={() => setImageFailed(true)}
            className={cn(
              'size-full object-cover transition duration-500 group-hover:scale-[1.04]',
              active && 'brightness-[0.72]'
            )}
          />
        ) : (
          <div className="grid size-full place-items-center bg-gradient-to-br from-surface-3 to-surface">
            {item.kind === 'artist' ? (
              <UserRound className="size-12 text-faint" />
            ) : (
              <Music2 className="size-12 text-faint" />
            )}
          </div>
        )}

        <div
          className={cn(
            'absolute inset-0 bg-gradient-to-t from-black/65 via-black/0 to-black/0 transition-opacity',
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
        />

        {playable && (
          <span
            className={cn(
              'absolute bottom-2.5 right-2.5 grid size-10 place-items-center rounded-full bg-accent text-accent-ink shadow-xl shadow-black/40 transition duration-200',
              active
                ? 'translate-y-0 opacity-100'
                : 'translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100'
            )}
          >
            {active && isPlaying ? (
              <Pause className="size-4 fill-current" />
            ) : (
              <Play className="ml-0.5 size-4 fill-current" />
            )}
          </span>
        )}
      </div>

      <div className="mt-2.5 min-w-0 px-0.5">
        <div
          className={cn(
            'truncate text-[13px] font-medium leading-5 transition',
            active ? 'text-accent' : 'text-ink group-hover:text-white'
          )}
        >
          {item.title}
        </div>
        <div className="mt-0.5 truncate text-[11px] leading-4 text-faint">
          {itemSubtitle(item) || `${item.kind}`}
        </div>
      </div>
    </button>
  )
}
