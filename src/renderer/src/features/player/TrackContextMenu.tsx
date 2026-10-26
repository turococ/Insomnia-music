import { CornerDownRight, Disc3, ListMusic, Play, Radio, UserRound } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@renderer/lib/cn'
import { useTrackMenu } from './menu'
import { usePlayer } from './store'

interface MenuItemProps {
  icon: LucideIcon
  label: string
  onClick: () => void
}

function MenuItem({ icon: Icon, label, onClick }: MenuItemProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-[12px] text-muted transition hover:bg-surface-2 hover:text-ink"
    >
      <Icon className="size-3.5 shrink-0" />
      {label}
    </button>
  )
}

export function TrackContextMenu(): React.JSX.Element | null {
  const item = useTrackMenu((state) => state.item)
  const x = useTrackMenu((state) => state.x)
  const y = useTrackMenu((state) => state.y)
  const close = useTrackMenu((state) => state.close)
  const playTrack = usePlayer((state) => state.playTrack)
  const playNext = usePlayer((state) => state.playNext)
  const addToQueue = usePlayer((state) => state.addToQueue)
  const startRadio = usePlayer((state) => state.startRadio)
  const navigate = useNavigate()

  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  // Keep the menu inside the window no matter where the click happened.
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!item || !menu) return
    const rect = menu.getBoundingClientRect()
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))
    })
  }, [item, x, y])

  useEffect(() => {
    if (!item) return

    const onPointerDown = (event: PointerEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    const onDismiss = (): void => close()

    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onDismiss)
    window.addEventListener('scroll', onDismiss, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onDismiss)
      window.removeEventListener('scroll', onDismiss, true)
    }
  }, [item, close])

  if (!item) return null

  const artist = item.artists.find((entry) => Boolean(entry.id))
  const albumId = item.album?.id
  const run = (action: () => void) => (): void => {
    close()
    action()
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{ left: position.left, top: position.top }}
      className={cn(
        'fixed z-[70] min-w-[232px] overflow-hidden rounded-2xl border border-line/80',
        'bg-surface/95 p-1.5 shadow-2xl shadow-black/50 backdrop-blur-xl'
      )}
    >
      <div className="truncate px-2.5 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">
        {item.title}
      </div>

      <MenuItem icon={Play} label="Play" onClick={run(() => void playTrack(item))} />
      <MenuItem icon={CornerDownRight} label="Play next" onClick={run(() => playNext(item))} />
      <MenuItem icon={ListMusic} label="Add to queue" onClick={run(() => addToQueue(item))} />
      <MenuItem icon={Radio} label="Start radio" onClick={run(() => void startRadio(item))} />

      {(albumId || artist) && <div className="my-1 h-px bg-line/60" />}
      {albumId && (
        <MenuItem
          icon={Disc3}
          label="Go to album"
          onClick={run(() => navigate(`/album/${albumId}`))}
        />
      )}
      {artist?.id && (
        <MenuItem
          icon={UserRound}
          label="Go to artist"
          onClick={run(() => navigate(`/artist/${artist.id}`))}
        />
      )}
    </div>
  )
}
