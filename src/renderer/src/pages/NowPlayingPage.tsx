import {
  ArrowLeft,
  Disc3,
  Heart,
  ListMusic,
  ListPlus,
  Loader2,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  Radio,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@renderer/lib/cn'
import { formatTime, pickThumbnail } from '@renderer/lib/media'
import { useAuth } from '@renderer/features/auth/context'
import { useTrackMenu } from '@renderer/features/player/menu'
import { usePlayer } from '@renderer/features/player/store'

function ActionButton({
  icon: Icon,
  label,
  onClick,
  active,
  disabled
}: {
  icon: typeof Heart
  label: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'flex h-9 items-center gap-2 rounded-full border px-3.5 text-[12px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'border-accent/35 bg-accent/10 text-accent'
          : 'border-line/80 bg-surface/50 text-muted hover:border-line hover:bg-surface-2 hover:text-ink'
      )}
    >
      <Icon className={cn('size-4', active && 'fill-current')} />
      {label}
    </button>
  )
}

export function NowPlayingPage(): React.JSX.Element {
  const navigate = useNavigate()
  const current = usePlayer((state) => state.current)
  const isPlaying = usePlayer((state) => state.isPlaying)
  const isLoading = usePlayer((state) => state.isLoading)
  const isLive = usePlayer((state) => state.isLive)
  const progress = usePlayer((state) => state.progress)
  const duration = usePlayer((state) => state.duration)
  const repeat = usePlayer((state) => state.repeat)
  const shuffle = usePlayer((state) => state.shuffle)
  const liked = usePlayer((state) => state.liked)
  const likePending = usePlayer((state) => state.likePending)
  const queueOpen = usePlayer((state) => state.queueOpen)
  const toggle = usePlayer((state) => state.toggle)
  const next = usePlayer((state) => state.next)
  const previous = usePlayer((state) => state.previous)
  const seek = usePlayer((state) => state.seek)
  const toggleShuffle = usePlayer((state) => state.toggleShuffle)
  const cycleRepeat = usePlayer((state) => state.cycleRepeat)
  const toggleLike = usePlayer((state) => state.toggleLike)
  const startRadio = usePlayer((state) => state.startRadio)
  const addToQueue = usePlayer((state) => state.addToQueue)
  const toggleQueue = usePlayer((state) => state.toggleQueue)
  const openMenu = useTrackMenu((state) => state.open)
  const { status } = useAuth()
  const moreRef = useRef<HTMLButtonElement>(null)

  const authenticated = Boolean(status?.authenticated)
  const cover = current ? pickThumbnail(current.thumbnails, 640) : undefined
  const RepeatIcon = repeat === 'one' ? Repeat1 : Repeat

  useEffect(() => {
    document.querySelector('main')?.scrollTo({ top: 0 })
  }, [])

  return (
    <div className="relative flex min-h-full flex-col overflow-hidden">
      {cover && (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <img
            src={cover}
            alt=""
            draggable={false}
            className="size-full scale-125 object-cover opacity-25 blur-3xl"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-canvas/50 via-canvas/80 to-canvas" />
        </div>
      )}

      <header className="relative flex h-16 shrink-0 items-center gap-3 px-8">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="grid size-9 place-items-center rounded-full border border-line/70 bg-surface/50 text-muted transition hover:border-line hover:bg-surface-2 hover:text-ink"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
            Now playing
          </div>
          <div className="truncate text-[12px] text-muted">
            {isLive ? 'Live stream' : isPlaying ? 'Playing from your queue' : 'Paused'}
          </div>
        </div>
        <button
          type="button"
          onClick={toggleQueue}
          aria-label="Queue"
          aria-pressed={queueOpen}
          className={cn(
            'ml-auto grid size-9 place-items-center rounded-full border transition',
            queueOpen
              ? 'border-accent/35 bg-accent/10 text-accent'
              : 'border-line/70 bg-surface/50 text-muted hover:border-line hover:bg-surface-2 hover:text-ink'
          )}
        >
          <ListMusic className="size-4" />
        </button>
      </header>

      {!current ? (
        <div className="relative flex flex-1 flex-col items-center justify-center gap-4 px-8 pb-12 text-center">
          <div className="grid size-16 place-items-center rounded-2xl border border-line/70 bg-surface-2 text-faint">
            <Music2 className="size-7" />
          </div>
          <div>
            <div className="text-lg font-semibold text-ink">Nothing playing yet</div>
            <p className="mt-1 text-[12px] text-faint">
              Pick a track and its artwork and controls will appear here.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="mt-1 rounded-full bg-accent px-5 py-2 text-[12px] font-semibold text-accent-ink transition hover:bg-accent-soft"
          >
            Browse home
          </button>
        </div>
      ) : (
        <div className="relative flex flex-1 items-center px-8 pb-10">
          <div className="mx-auto grid w-full max-w-[1080px] items-center gap-10 lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)] lg:gap-14">
            <div className="mx-auto w-full max-w-[380px]">
              <div
                className={cn(
                  'relative aspect-square overflow-hidden rounded-[28px] border border-line/70 bg-surface-2',
                  'shadow-[0_32px_90px_-24px_rgba(0,0,0,0.85)]'
                )}
              >
                {cover ? (
                  <img
                    src={cover}
                    alt={current.title}
                    draggable={false}
                    className="size-full object-cover"
                  />
                ) : (
                  <div className="grid size-full place-items-center text-faint">
                    <Music2 className="size-16" />
                  </div>
                )}
                <div className="pointer-events-none absolute inset-0 rounded-[28px] ring-1 ring-inset ring-white/[0.06]" />
              </div>
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
                {isLive ? (
                  <>
                    <span className="size-1.5 animate-pulse rounded-full bg-red-400" />
                    Live
                  </>
                ) : (
                  <>
                    <span className="flex items-end gap-[2px]" aria-hidden>
                      {[6, 10, 7, 12].map((height, index) => (
                        <span
                          key={index}
                          style={{ height }}
                          className={cn(
                            'w-[2px] rounded-full bg-accent',
                            isPlaying ? 'animate-pulse' : 'opacity-40'
                          )}
                        />
                      ))}
                    </span>
                    {isPlaying ? 'Now playing' : 'Paused'}
                  </>
                )}
              </div>

              <h1 className="mt-3 text-[clamp(28px,4vw,44px)] font-semibold leading-[1.08] tracking-tight text-ink">
                {current.title}
              </h1>

              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
                {current.artists.map((artist, index) => (
                  <span
                    key={`${artist.id ?? artist.name}:${index}`}
                    className="flex items-center gap-2"
                  >
                    {index > 0 && <span className="text-faint">·</span>}
                    {artist.id ? (
                      <button
                        type="button"
                        onClick={() => navigate(`/artist/${artist.id}`)}
                        className="font-medium transition hover:text-accent"
                      >
                        {artist.name}
                      </button>
                    ) : (
                      <span className="font-medium">{artist.name}</span>
                    )}
                  </span>
                ))}
                {current.album && (
                  <>
                    {current.artists.length > 0 && <span className="text-faint">·</span>}
                    {current.album.id ? (
                      <button
                        type="button"
                        onClick={() => navigate(`/album/${current.album?.id}`)}
                        className="flex items-center gap-1.5 transition hover:text-ink"
                      >
                        <Disc3 className="size-3.5" />
                        {current.album.name}
                      </button>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <Disc3 className="size-3.5" />
                        {current.album.name}
                      </span>
                    )}
                  </>
                )}
                {current.year && (
                  <>
                    <span className="text-faint">·</span>
                    <span>{current.year}</span>
                  </>
                )}
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-2">
                <ActionButton
                  icon={Heart}
                  label={liked ? 'Liked' : 'Like'}
                  active={liked}
                  disabled={!authenticated || likePending}
                  onClick={() => void toggleLike()}
                />
                <ActionButton
                  icon={Radio}
                  label="Start radio"
                  onClick={() => void startRadio(current)}
                />
                <ActionButton
                  icon={ListPlus}
                  label="Add to queue"
                  onClick={() => addToQueue(current)}
                />
                <button
                  ref={moreRef}
                  type="button"
                  aria-label="More options"
                  onClick={() => {
                    const rect = moreRef.current?.getBoundingClientRect()
                    if (rect) openMenu(current, rect.left, rect.bottom + 6)
                  }}
                  className="grid size-9 place-items-center rounded-full border border-line/80 bg-surface/50 text-muted transition hover:border-line hover:bg-surface-2 hover:text-ink"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </div>

              <div className="mt-8">
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.1}
                  value={Math.min(progress, duration || 0)}
                  onChange={(event) => seek(Number(event.target.value))}
                  disabled={!duration || isLive}
                  aria-label="Seek"
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-3 disabled:opacity-40 [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-[0_0_14px_color-mix(in_srgb,var(--color-accent)_55%,transparent)]"
                />
                <div className="mt-2 flex items-center justify-between text-[10px] tabular-nums text-faint">
                  <span>{isLive ? 'LIVE' : formatTime(progress)}</span>
                  <span>{isLive ? '' : formatTime(duration)}</span>
                </div>
              </div>

              <div className="mt-5 flex items-center gap-5">
                <button
                  type="button"
                  onClick={toggleShuffle}
                  aria-label="Shuffle"
                  className={cn(
                    'grid size-9 place-items-center rounded-full transition hover:bg-surface-2',
                    shuffle ? 'text-accent' : 'text-faint hover:text-ink'
                  )}
                >
                  <Shuffle className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={previous}
                  aria-label="Previous"
                  className="grid size-11 place-items-center rounded-full text-ink transition hover:bg-surface-2"
                >
                  <SkipBack className="size-5 fill-current" />
                </button>
                <button
                  type="button"
                  onClick={toggle}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  className="grid size-16 place-items-center rounded-full bg-accent text-accent-ink shadow-[0_0_44px_-10px] shadow-accent/70 transition hover:scale-105 hover:bg-accent-soft"
                >
                  {isLoading ? (
                    <Loader2 className="size-6 animate-spin" />
                  ) : isPlaying ? (
                    <Pause className="size-6 fill-current" />
                  ) : (
                    <Play className="ml-1 size-6 fill-current" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={next}
                  aria-label="Next"
                  className="grid size-11 place-items-center rounded-full text-ink transition hover:bg-surface-2"
                >
                  <SkipForward className="size-5 fill-current" />
                </button>
                <button
                  type="button"
                  onClick={cycleRepeat}
                  aria-label="Repeat"
                  className={cn(
                    'grid size-9 place-items-center rounded-full transition hover:bg-surface-2',
                    repeat === 'off' ? 'text-faint hover:text-ink' : 'text-accent'
                  )}
                >
                  <RepeatIcon className="size-4" />
                </button>
              </div>

              <div className="mt-6 flex items-center gap-2 text-[10px] text-faint">
                <span className="rounded-md border border-line/70 px-1.5 py-0.5">Space</span>
                play / pause
                <span className="ml-2 rounded-md border border-line/70 px-1.5 py-0.5">Q</span>
                queue
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
