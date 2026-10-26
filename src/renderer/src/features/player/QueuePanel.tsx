import { AudioLines, GripVertical, ListMusic, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@renderer/lib/cn'
import { formatTime, itemSubtitle, pickThumbnail } from '@renderer/lib/media'
import { useTrackMenu } from './menu'
import { usePlayer } from './store'

function AutoplayToggle(): React.JSX.Element {
  const autoplay = usePlayer((state) => state.autoplay)
  const setAutoplay = usePlayer((state) => state.setAutoplay)

  return (
    <button
      type="button"
      role="switch"
      aria-checked={autoplay}
      onClick={() => setAutoplay(!autoplay)}
      className="flex w-full items-center justify-between gap-3 text-left"
    >
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-ink">Autoplay</div>
        <div className="mt-0.5 text-[10px] leading-4 text-faint">
          Keep playing similar songs when the queue ends.
        </div>
      </div>
      <span
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full border transition',
          autoplay ? 'border-accent/30 bg-accent/20' : 'border-line bg-surface-3'
        )}
      >
        <span
          className={cn(
            'absolute top-1/2 size-3 -translate-y-1/2 rounded-full transition',
            autoplay ? 'left-[18px] bg-accent' : 'left-1 bg-faint'
          )}
        />
      </span>
    </button>
  )
}

export function QueuePanel(): React.JSX.Element {
  const queue = usePlayer((state) => state.queue)
  const queueIndex = usePlayer((state) => state.queueIndex)
  const queueOpen = usePlayer((state) => state.queueOpen)
  const isPlaying = usePlayer((state) => state.isPlaying)
  const setQueueOpen = usePlayer((state) => state.setQueueOpen)
  const jumpTo = usePlayer((state) => state.jumpTo)
  const toggle = usePlayer((state) => state.toggle)
  const removeFromQueue = usePlayer((state) => state.removeFromQueue)
  const clearQueue = usePlayer((state) => state.clearQueue)
  const moveInQueue = usePlayer((state) => state.moveInQueue)
  const openMenu = useTrackMenu((state) => state.open)

  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const activeRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (!queueOpen) return
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [queueOpen, queueIndex, queue.length])

  const selectTrack = (index: number): void => {
    if (index === queueIndex) {
      toggle()
      return
    }
    jumpTo(index)
  }

  const openRowMenu = (index: number, x: number, y: number): void => {
    const item = queue[index]
    if (item) openMenu(item, x, y)
  }

  return (
    <aside
      aria-label="Queue"
      aria-hidden={!queueOpen}
      inert={!queueOpen}
      className={cn(
        'fixed bottom-[92px] right-0 top-[72px] z-40 flex w-[340px] flex-col border-l border-line/80',
        'bg-surface/95 shadow-[-28px_0_72px_-32px_rgba(0,0,0,0.85)] backdrop-blur-xl',
        'transition-transform duration-300 ease-out',
        queueOpen ? 'translate-x-0' : 'translate-x-full'
      )}
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line/60 px-4">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-ink">Queue</div>
          <div className="mt-0.5 text-[10px] text-faint">
            {queue.length === 0
              ? 'Nothing queued'
              : `${queue.length} ${queue.length === 1 ? 'track' : 'tracks'}`}
          </div>
        </div>
        <button
          type="button"
          onClick={clearQueue}
          disabled={queue.length <= 1}
          aria-label="Clear queue"
          title="Clear queue"
          className="grid size-8 place-items-center rounded-full text-faint transition hover:bg-surface-2 hover:text-ink disabled:opacity-30"
        >
          <Trash2 className="size-[15px]" />
        </button>
        <button
          type="button"
          onClick={() => setQueueOpen(false)}
          aria-label="Close queue"
          className="grid size-8 place-items-center rounded-full text-faint transition hover:bg-surface-2 hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {queue.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <div className="grid size-12 place-items-center rounded-full border border-line/70 bg-surface-2 text-faint">
              <ListMusic className="size-5" />
            </div>
            <div>
              <div className="text-[12px] font-medium text-muted">Your queue is empty</div>
              <p className="mt-1 text-[10px] leading-4 text-faint">
                Play a song or add tracks from any list to see them here.
              </p>
            </div>
          </div>
        ) : (
          <ul role="list" className="space-y-0.5">
            {queue.map((item, index) => {
              const active = index === queueIndex
              const cover = pickThumbnail(item.thumbnails, 80)
              const dragging = dragIndex === index
              const dropping = dropIndex === index && dragIndex !== index

              return (
                <li
                  key={`${item.id}:${index}`}
                  ref={active ? activeRef : undefined}
                  draggable
                  onDragStart={(event) => {
                    setDragIndex(index)
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', String(index))
                  }}
                  onDragOver={(event) => {
                    if (dragIndex === null) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    setDropIndex(index)
                  }}
                  onDragLeave={() =>
                    setDropIndex((current) => (current === index ? null : current))
                  }
                  onDrop={(event) => {
                    event.preventDefault()
                    const raw = dragIndex ?? Number(event.dataTransfer.getData('text/plain'))
                    if (Number.isInteger(raw) && raw >= 0) moveInQueue(raw, index)
                    setDragIndex(null)
                    setDropIndex(null)
                  }}
                  onDragEnd={() => {
                    setDragIndex(null)
                    setDropIndex(null)
                  }}
                  className={cn(
                    'group flex items-center gap-1 rounded-xl border px-1.5 py-1.5 transition',
                    active
                      ? 'border-accent/15 bg-accent/[0.07]'
                      : 'border-transparent hover:bg-surface-2/80',
                    dragging && 'opacity-40',
                    dropping && 'border-accent/50 bg-accent/[0.1]'
                  )}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    openRowMenu(index, event.clientX, event.clientY)
                  }}
                >
                  <span
                    aria-hidden
                    className="grid w-3 shrink-0 cursor-grab place-items-center text-faint opacity-0 transition group-hover:opacity-70 active:cursor-grabbing"
                  >
                    <GripVertical className="size-3.5" />
                  </span>

                  <button
                    type="button"
                    onClick={() => selectTrack(index)}
                    title={active ? 'Pause or resume' : 'Play this track'}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none"
                  >
                    <span className="relative size-9 shrink-0 overflow-hidden rounded-lg border border-line/60 bg-surface-2">
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
                        <span className="grid size-full place-items-center">
                          <ListMusic className="size-3.5 text-faint" />
                        </span>
                      )}
                      {active && isPlaying && (
                        <span className="absolute inset-0 bg-black/45" aria-hidden />
                      )}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block truncate text-[12px] font-medium',
                          active ? 'text-accent' : 'text-ink'
                        )}
                      >
                        {item.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-faint">
                        {itemSubtitle(item)}
                      </span>
                    </span>
                  </button>

                  <div className="relative grid size-7 shrink-0 place-items-center">
                    <span
                      className={cn(
                        'text-[10px] tabular-nums transition group-hover:opacity-0',
                        active ? 'text-accent' : 'text-faint'
                      )}
                    >
                      {active ? (
                        <AudioLines
                          className={cn('size-3.5', isPlaying && 'animate-pulse')}
                          aria-label="Now playing"
                        />
                      ) : (
                        formatTime(item.duration ?? 0)
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFromQueue(index)}
                      aria-label={`Remove ${item.title} from the queue`}
                      title="Remove from queue"
                      className="absolute inset-0 grid place-items-center rounded-full text-faint opacity-0 transition hover:text-red-300 group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <footer className="shrink-0 border-t border-line/60 p-4">
        <AutoplayToggle />
      </footer>
    </aside>
  )
}
