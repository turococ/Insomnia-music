import {
  Heart,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX
} from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { formatTime, itemSubtitle, pickThumbnail } from '@renderer/lib/media'
import { usePlayer } from '@renderer/features/player/store'

export function PlayerBar(): React.JSX.Element {
  const current = usePlayer((state) => state.current)
  const isPlaying = usePlayer((state) => state.isPlaying)
  const isLoading = usePlayer((state) => state.isLoading)
  const isLive = usePlayer((state) => state.isLive)
  const progress = usePlayer((state) => state.progress)
  const duration = usePlayer((state) => state.duration)
  const volume = usePlayer((state) => state.volume)
  const muted = usePlayer((state) => state.muted)
  const repeat = usePlayer((state) => state.repeat)
  const shuffle = usePlayer((state) => state.shuffle)
  const queueOpen = usePlayer((state) => state.queueOpen)
  const error = usePlayer((state) => state.error)

  const toggle = usePlayer((state) => state.toggle)
  const next = usePlayer((state) => state.next)
  const previous = usePlayer((state) => state.previous)
  const seek = usePlayer((state) => state.seek)
  const setVolume = usePlayer((state) => state.setVolume)
  const toggleMute = usePlayer((state) => state.toggleMute)
  const toggleShuffle = usePlayer((state) => state.toggleShuffle)
  const cycleRepeat = usePlayer((state) => state.cycleRepeat)
  const toggleQueue = usePlayer((state) => state.toggleQueue)

  const cover = current ? pickThumbnail(current.thumbnails, 160) : undefined
  const RepeatIcon = repeat === 'one' ? Repeat1 : Repeat

  return (
    <footer className="relative z-20 grid h-[92px] shrink-0 grid-cols-[minmax(0,1fr)_minmax(360px,1.35fr)_minmax(0,1fr)] items-center gap-6 border-t border-line/80 bg-surface/85 px-6 backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative size-14 shrink-0 overflow-hidden rounded-xl border border-line/70 bg-surface-2">
          {cover ? (
            <img src={cover} alt="" draggable={false} className="size-full object-cover" />
          ) : (
            <div className="grid size-full place-items-center text-faint">
              <ListMusic className="size-5" />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="truncate text-[13px] font-medium text-ink">
              {current?.title ?? 'Nothing playing'}
            </div>
            {isLive && (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-red-300">
                <span className="size-1 rounded-full bg-red-400" />
                Live
              </span>
            )}
          </div>
          <div className={cn('mt-0.5 truncate text-[11px]', error ? 'text-red-400' : 'text-faint')}>
            {error ?? (current ? itemSubtitle(current) : 'Pick a track to start listening')}
          </div>
        </div>
        <button
          type="button"
          disabled={!current}
          className="ml-1 hidden size-8 shrink-0 place-items-center rounded-full text-faint transition hover:bg-surface-2 hover:text-ink disabled:opacity-30 sm:grid"
          aria-label="Like"
        >
          <Heart className="size-4" />
        </button>
      </div>

      <div className="flex min-w-0 flex-col items-center gap-1.5">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={toggleShuffle}
            aria-label="Shuffle"
            className={cn(
              'grid size-8 place-items-center rounded-full transition hover:text-ink',
              shuffle ? 'text-accent' : 'text-faint'
            )}
          >
            <Shuffle className="size-[15px]" />
          </button>

          <button
            type="button"
            onClick={previous}
            disabled={!current}
            aria-label="Previous"
            className="grid size-8 place-items-center rounded-full text-muted transition hover:text-ink disabled:opacity-30"
          >
            <SkipBack className="size-[18px] fill-current" />
          </button>

          <button
            type="button"
            onClick={toggle}
            disabled={!current}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="grid size-11 place-items-center rounded-full bg-accent text-accent-ink shadow-[0_0_28px_-6px] shadow-accent/70 transition hover:scale-105 hover:bg-accent-soft disabled:opacity-40"
          >
            {isLoading ? (
              <Loader2 className="size-5 animate-spin" />
            ) : isPlaying ? (
              <Pause className="size-5 fill-current" />
            ) : (
              <Play className="ml-0.5 size-5 fill-current" />
            )}
          </button>

          <button
            type="button"
            onClick={next}
            disabled={!current}
            aria-label="Next"
            className="grid size-8 place-items-center rounded-full text-muted transition hover:text-ink disabled:opacity-30"
          >
            <SkipForward className="size-[18px] fill-current" />
          </button>

          <button
            type="button"
            onClick={cycleRepeat}
            aria-label="Repeat"
            className={cn(
              'grid size-8 place-items-center rounded-full transition hover:text-ink',
              repeat === 'off' ? 'text-faint' : 'text-accent'
            )}
          >
            <RepeatIcon className="size-[15px]" />
          </button>
        </div>

        <div className="flex w-full max-w-[520px] items-center gap-2.5">
          <span className="w-9 text-right text-[10px] tabular-nums text-faint">
            {isLive ? 'LIVE' : formatTime(progress)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(progress, duration || 0)}
            onChange={(event) => seek(Number(event.target.value))}
            disabled={!current || !duration || isLive}
            aria-label="Seek"
            className="h-1 w-full cursor-pointer appearance-none rounded-full bg-surface-3 disabled:opacity-40 [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-[0_0_12px_color-mix(in_srgb,var(--color-accent)_55%,transparent)]"
          />
          <span className="w-9 text-[10px] tabular-nums text-faint">
            {isLive ? '' : formatTime(duration)}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={toggleQueue}
          aria-label="Queue"
          aria-pressed={queueOpen}
          className={cn(
            'grid size-8 place-items-center rounded-full transition',
            queueOpen ? 'bg-accent/10 text-accent' : 'text-faint hover:bg-surface-2 hover:text-ink'
          )}
        >
          <ListMusic className="size-[16px]" />
        </button>
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? 'Unmute' : 'Mute'}
          className="grid size-8 place-items-center rounded-full text-faint transition hover:bg-surface-2 hover:text-ink"
        >
          {muted || volume === 0 ? (
            <VolumeX className="size-[16px]" />
          ) : (
            <Volume2 className="size-[16px]" />
          )}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          onChange={(event) => setVolume(Number(event.target.value))}
          aria-label="Volume"
          className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-surface-3 [&::-webkit-slider-thumb]:size-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-ink"
        />
      </div>
    </footer>
  )
}
