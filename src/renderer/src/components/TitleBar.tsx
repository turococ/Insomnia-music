import { Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { WindowControls } from './WindowControls'

function SearchForm({ initialQuery }: { initialQuery: string }): React.JSX.Element {
  const navigate = useNavigate()
  const [query, setQuery] = useState(initialQuery)
  const inputRef = useRef<HTMLInputElement>(null)
  const shortcut = window.electron.process.platform === 'darwin' ? '⌘K' : 'Ctrl K'

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const isShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'
      if (isShortcut) {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return
    navigate(`/search?q=${encodeURIComponent(trimmed)}`)
  }

  return (
    <form onSubmit={submit} className="relative w-full">
      <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-faint" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search songs, albums, artists…"
        className="h-10 w-full rounded-full border border-line/80 bg-surface-2/70 pl-11 pr-20 text-[13px] text-ink outline-none transition placeholder:text-faint focus:border-accent/40 focus:bg-surface-2 focus:ring-4 focus:ring-accent/5"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[10px] text-faint">
        {shortcut}
      </kbd>
    </form>
  )
}

export function TitleBar(): React.JSX.Element {
  const [searchParams] = useSearchParams()
  const routeQuery = searchParams.get('q') ?? ''

  return (
    <header className="drag-region flex h-12 shrink-0 items-center gap-4 pl-8 pr-1.5">
      <div className="no-drag w-full max-w-[520px]">
        <SearchForm key={routeQuery} initialQuery={routeQuery} />
      </div>
      <div className="ml-auto flex items-center">
        <WindowControls />
      </div>
    </header>
  )
}
