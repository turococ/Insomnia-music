import { Search, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

export function TopBar(): React.JSX.Element {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('q') ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setQuery(searchParams.get('q') ?? '')
  }, [searchParams])

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
    <header className="flex h-[72px] shrink-0 items-center gap-4 border-b border-line/70 px-8">
      <form onSubmit={submit} className="relative w-full max-w-[520px]">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search songs, albums, artists…"
          className="h-10 w-full rounded-full border border-line/80 bg-surface-2/70 pl-11 pr-16 text-[13px] text-ink outline-none transition placeholder:text-faint focus:border-accent/40 focus:bg-surface-2 focus:ring-4 focus:ring-accent/5"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[10px] text-faint">
          ⌘K
        </kbd>
      </form>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          className="flex h-9 items-center gap-2 rounded-full border border-line/80 bg-surface-2/60 px-3.5 text-[12px] font-medium text-muted transition hover:border-line hover:text-ink"
        >
          <UserRound className="size-4" />
          Sign in
        </button>
      </div>
    </header>
  )
}
