import { ArrowUpDown, Check, ChevronDown, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@renderer/lib/cn'
import { TRACK_SORT_OPTIONS, type TrackSortKey } from '@renderer/lib/trackSort'

interface TrackSortMenuProps {
  value: TrackSortKey
  onChange: (value: TrackSortKey) => void
  loading?: boolean
  disabled?: boolean
  className?: string
}

export function TrackSortMenu({
  value,
  onChange,
  loading = false,
  disabled = false,
  className
}: TrackSortMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const selected = TRACK_SORT_OPTIONS.find((option) => option.key === value)

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const handleSelect = (next: TrackSortKey): void => {
    setOpen(false)
    onChange(next)
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled || loading}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={loading ? 'Loading release years…' : 'Sort tracks'}
        className="flex items-center gap-2 rounded-full border border-line/70 bg-surface/50 px-3.5 py-2 text-[12px] font-medium text-muted transition hover:border-line hover:text-ink disabled:cursor-wait disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <ArrowUpDown className="size-3.5" />
        )}
        <span className="text-faint">Sort</span>
        <span className="text-ink">{selected?.label ?? 'Popularity'}</span>
        <ChevronDown className={cn('size-3.5 transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Sort tracks"
          className="absolute right-0 z-30 mt-2 w-48 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-2xl shadow-black/40"
        >
          {TRACK_SORT_OPTIONS.map((option) => {
            const active = option.key === value
            return (
              <button
                key={option.key}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => handleSelect(option.key)}
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-[12px] transition',
                  active ? 'bg-accent/10 text-ink' : 'text-muted hover:bg-surface-2 hover:text-ink'
                )}
              >
                <span>{option.label}</span>
                {active && <Check className="size-3.5 text-accent" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
