import { ChevronLeft, ChevronRight, Play } from 'lucide-react'
import { useRef } from 'react'
import type { MediaItem } from '@shared/types'
import { MediaCard } from '@renderer/components/MediaCard'
import { mergeTracks } from '@renderer/lib/media'

interface MediaShelfProps {
  title: string
  items: MediaItem[]
  onSelect: (item: MediaItem, sectionItems: MediaItem[]) => void
}

export function MediaShelf({ title, items, onSelect }: MediaShelfProps): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const tracks = mergeTracks(items)

  const scroll = (direction: -1 | 1): void => {
    const element = scroller.current
    if (!element) return
    element.scrollBy({
      left: direction * Math.max(360, element.clientWidth * 0.8),
      behavior: 'smooth'
    })
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">{title}</h2>
        <div className="flex items-center gap-1.5">
          {tracks.length > 0 && (
            <button
              type="button"
              onClick={() => onSelect(tracks[0], items)}
              aria-label={`Play ${title}`}
              className="grid size-8 place-items-center rounded-full border border-line/80 bg-surface-2/60 text-muted transition hover:border-accent/30 hover:text-ink"
            >
              <Play className="ml-0.5 size-3.5 fill-current" />
            </button>
          )}
          <button
            type="button"
            onClick={() => scroll(-1)}
            aria-label="Scroll left"
            className="grid size-8 place-items-center rounded-full border border-line/80 bg-surface-2/60 text-muted transition hover:border-line hover:text-ink"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => scroll(1)}
            aria-label="Scroll right"
            className="grid size-8 place-items-center rounded-full border border-line/80 bg-surface-2/60 text-muted transition hover:border-line hover:text-ink"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <div
        ref={scroller}
        className="no-scrollbar -mx-2 flex gap-4 overflow-x-auto scroll-smooth px-2 pb-1"
      >
        {items.slice(0, 20).map((item) => (
          <div
            key={`${item.kind}:${item.id}`}
            className="w-[156px] shrink-0 sm:w-[168px] xl:w-[180px]"
          >
            <MediaCard item={item} onSelect={(selected) => onSelect(selected, items)} />
          </div>
        ))}
      </div>
    </section>
  )
}
