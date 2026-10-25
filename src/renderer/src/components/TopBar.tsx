import { Loader2, Search, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@renderer/features/auth/context'

function SearchForm({ initialQuery }: { initialQuery: string }): React.JSX.Element {
  const navigate = useNavigate()
  const [query, setQuery] = useState(initialQuery)
  const inputRef = useRef<HTMLInputElement>(null)

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
  )
}

export function TopBar(): React.JSX.Element {
  const navigate = useNavigate()
  const { status, isLoading, isPending, pendingMode, signIn } = useAuth()
  const [searchParams] = useSearchParams()
  const authenticated = Boolean(status?.authenticated)
  const account = status?.account
  const pendingLabel = pendingMode === 'browser' ? 'Waiting for browser…' : 'Signing in…'
  const accountLabel = authenticated
    ? (account?.name ?? 'Account')
    : isPending
      ? pendingLabel
      : isLoading
        ? 'Checking…'
        : 'Sign in'
  const accountBusy = isLoading || isPending
  const routeQuery = searchParams.get('q') ?? ''

  return (
    <header className="flex h-[72px] shrink-0 items-center gap-4 border-b border-line/70 px-8">
      <SearchForm key={routeQuery} initialQuery={routeQuery} />

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (authenticated) navigate('/library')
            else void signIn()
          }}
          disabled={accountBusy}
          className="flex h-9 max-w-[220px] items-center gap-2 rounded-full border border-line/80 bg-surface-2/60 px-3.5 text-[12px] font-medium text-muted transition hover:border-line hover:text-ink disabled:cursor-wait disabled:opacity-70"
        >
          {account?.avatarUrl ? (
            <img
              src={account.avatarUrl}
              alt=""
              draggable={false}
              className="size-5 rounded-full object-cover"
            />
          ) : accountBusy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <UserRound className="size-4" />
          )}
          <span className="truncate">{accountLabel}</span>
        </button>
      </div>
    </header>
  )
}
