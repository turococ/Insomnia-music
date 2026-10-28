import { AudioLines, Disc3, Loader2, MicVocal, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { LyricLine, MediaItem } from '@shared/types'
import { cn } from '@renderer/lib/cn'
import { usePlayer } from './store'

function activeLineIndex(lines: LyricLine[], progress: number): number {
  let index = -1
  for (let position = 0; position < lines.length; position += 1) {
    const line = lines[position]
    if (line.time > progress + 0.15) break
    if (line.text) index = position
  }
  return index
}

export function LyricsView({ track }: { track: MediaItem }): React.JSX.Element {
  const progress = usePlayer((state) => state.progress)
  const isPlaying = usePlayer((state) => state.isPlaying)
  const seek = usePlayer((state) => state.seek)
  const artist = track.artists.map((entry) => entry.name).join(', ')

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['lyrics', track.id],
    queryFn: () =>
      window.api.music.lyrics({
        id: track.id,
        title: track.title,
        artist: artist || undefined,
        album: track.album?.name,
        duration: track.duration
      }),
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1
  })

  const synced = data?.synced ?? null
  const activeIndex = useMemo(
    () => (synced ? activeLineIndex(synced, progress) : -1),
    [synced, progress]
  )

  const containerRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<Array<HTMLElement | null>>([])
  const [following, setFollowing] = useState(true)
  const resumeTimer = useRef<number | null>(null)

  const suspendFollow = (): void => {
    setFollowing(false)
    if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current)
    resumeTimer.current = window.setTimeout(() => setFollowing(true), 5_000)
  }

  const resumeFollow = (): void => {
    if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current)
    resumeTimer.current = null
    setFollowing(true)
  }

  useEffect(() => {
    return () => {
      if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!following || activeIndex < 0) return
    const container = containerRef.current
    const line = lineRefs.current[activeIndex]
    if (!container || !line) return

    const top = line.offsetTop - container.clientHeight / 2 + line.offsetHeight / 2
    container.scrollTo({
      top: Math.max(0, top),
      behavior: isPlaying ? 'smooth' : 'auto'
    })
  }, [activeIndex, following, isPlaying])

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-faint">
        <Loader2 className="size-5 animate-spin text-accent" />
        <span className="text-[11px]">Looking for lyrics…</span>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="grid size-12 place-items-center rounded-full border border-line/70 bg-surface-2 text-faint">
          <MicVocal className="size-5" />
        </div>
        <div>
          <div className="text-[13px] font-medium text-muted">No lyrics found</div>
          <p className="mt-1 text-[11px] leading-5 text-faint">
            {isError
              ? 'The lyrics service could not be reached.'
              : 'This track does not have lyrics in YouTube Music or LRCLIB.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-1 flex items-center gap-1.5 rounded-full border border-line/80 bg-surface/50 px-3 py-1.5 text-[11px] font-medium text-muted transition hover:border-line hover:text-ink"
        >
          <RefreshCw className="size-3" />
          Try again
        </button>
      </div>
    )
  }

  if (data.instrumental) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="grid size-12 place-items-center rounded-full border border-line/70 bg-surface-2 text-faint">
          <Disc3 className="size-5" />
        </div>
        <div>
          <div className="text-[13px] font-medium text-muted">Instrumental track</div>
          <p className="mt-1 text-[11px] text-faint">There are no lyrics for this one.</p>
        </div>
      </div>
    )
  }

  const sourceBadge = data.source === 'lrclib' ? 'LRCLIB' : 'YouTube Music'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
          <AudioLines className={cn('size-3.5', synced ? 'text-accent' : 'text-faint')} />
          {synced ? 'Synced lyrics' : 'Lyrics'}
        </div>
        <span className="rounded-full border border-line/70 bg-surface/50 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-faint">
          {sourceBadge}
        </span>
      </div>

      {synced ? (
        <>
          <div
            ref={containerRef}
            onWheel={suspendFollow}
            onTouchMove={suspendFollow}
            className={cn(
              'relative min-h-0 flex-1 overflow-y-auto px-2 py-16',
              '[mask-image:linear-gradient(to_bottom,transparent,black_9%,black_91%,transparent)]'
            )}
          >
            {synced.map((line, index) => {
              const active = index === activeIndex
              const empty = !line.text

              if (empty) {
                return <div key={`${index}:${line.time}`} className="h-2" />
              }

              return (
                <button
                  key={`${index}:${line.time}`}
                  ref={(node) => {
                    lineRefs.current[index] = node
                  }}
                  type="button"
                  onClick={() => {
                    resumeFollow()
                    seek(line.time)
                  }}
                  className={cn(
                    'block w-full rounded-lg px-3 py-1.5 text-center leading-7 transition-colors',
                    active
                      ? 'text-[17px] font-semibold text-accent drop-shadow-[0_0_20px_color-mix(in_srgb,var(--color-accent)_30%,transparent)]'
                      : 'text-[14px] text-faint hover:text-muted'
                  )}
                >
                  {line.text}
                </button>
              )
            })}
          </div>

          {!following && (
            <button
              type="button"
              onClick={resumeFollow}
              className="mx-auto mt-2 flex shrink-0 items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-[10px] font-medium text-accent transition hover:bg-accent/15"
            >
              <AudioLines className="size-3" />
              Follow lyrics
            </button>
          )}
        </>
      ) : (
        <div
          ref={containerRef}
          className={cn(
            'min-h-0 flex-1 overflow-y-auto px-4 py-10',
            '[mask-image:linear-gradient(to_bottom,transparent,black_7%,black_93%,transparent)]'
          )}
        >
          <div className="whitespace-pre-line text-center text-[14px] leading-8 text-muted">
            {data.plain}
          </div>
        </div>
      )}
    </div>
  )
}
