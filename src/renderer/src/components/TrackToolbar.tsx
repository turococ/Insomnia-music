import { Search, X } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { TrackSortMenu } from '@renderer/components/TrackSortMenu'
import type { TrackSortKey } from '@renderer/lib/trackSort'

interface TrackToolbarProps {
  query: string
  onQueryChange: (value: string) => void
  sort: TrackSortKey
  onSortChange: (value: TrackSortKey) => void
  sortLoading?: boolean
  sortDisabled?: boolean
  disabled?: boolean
  placeholder?: string
  className?: string
}

export function TrackToolbar({
  query,
  onQueryChange,
  sort,
  onSortChange,
  sortLoading = false,
  sortDisabled = false,
  disabled = false,
  placeholder = 'Filter tracks…',
  className
}: TrackToolbarProps): React.JSX.Element {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div className="relative min-w-[170px]">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
        <input
          type="text"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          aria-label="Filter tracks"
          className="h-9 w-full rounded-full border border-line/70 bg-surface/50 pl-9 pr-8 text-[12px] text-ink outline-none transition placeholder:text-faint focus:border-accent/40 focus:ring-2 focus:ring-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            aria-label="Clear track filter"
            className="absolute right-2 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-full text-faint transition hover:bg-surface-2 hover:text-ink"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      <TrackSortMenu
        value={sort}
        onChange={onSortChange}
        loading={sortLoading}
        disabled={disabled || sortDisabled}
      />
    </div>
  )
}
