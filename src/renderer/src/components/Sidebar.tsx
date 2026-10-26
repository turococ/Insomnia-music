import {
  ChevronRight,
  Headphones,
  Home,
  Library,
  Loader2,
  LogOut,
  Search,
  Settings,
  Sparkles,
  UserRound
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '@renderer/features/auth/context'
import { cn } from '@renderer/lib/cn'

const navigation = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/library', label: 'Library', icon: Library },
  { to: '/settings', label: 'Settings', icon: Settings }
]

export function Sidebar(): React.JSX.Element {
  const navigate = useNavigate()
  const { status, isLoading, isPending, signIn, cancelSignIn, signOut } = useAuth()
  const account = status?.account
  const authenticated = Boolean(status?.authenticated)
  const [version, setVersion] = useState('')

  useEffect(() => {
    let cancelled = false
    window.api.app
      .version()
      .then((value) => {
        if (!cancelled) setVersion(value)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <aside className="flex w-[248px] shrink-0 flex-col border-r border-line/80 bg-surface/50 px-4 pb-4 pt-6">
      <div className="mb-9 flex items-center gap-3 px-2">
        <div className="grid size-10 place-items-center rounded-2xl bg-accent text-accent-ink shadow-[0_0_32px_-8px] shadow-accent/60">
          <Headphones className="size-5" strokeWidth={2.5} />
        </div>
        <div>
          <div className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
            ToneGlass
            <span className="rounded-full border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-accent">
              beta
            </span>
          </div>
          <div className="text-[11px] text-faint">YouTube Music, reimagined</div>
        </div>
      </div>

      <nav className="space-y-1">
        {navigation.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition',
                isActive
                  ? 'bg-surface-3 text-ink shadow-sm'
                  : 'text-muted hover:bg-surface-2 hover:text-ink'
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={cn(
                    'size-[18px] transition',
                    isActive ? 'text-accent' : 'text-faint group-hover:text-muted'
                  )}
                  strokeWidth={2}
                />
                {label}
                {isActive && <span className="ml-auto size-1.5 rounded-full bg-accent" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-8 px-2">
        <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
          <Sparkles className="size-3 text-accent" />
          Coming next
        </div>
        <div className="space-y-2 text-[12px] text-muted">
          <div className="rounded-xl border border-line/70 bg-canvas/40 px-3 py-2.5">
            Library actions
          </div>
          <div className="rounded-xl border border-line/70 bg-canvas/40 px-3 py-2.5">
            Offline downloads
          </div>
          <div className="rounded-xl border border-line/70 bg-canvas/40 px-3 py-2.5">Equalizer</div>
        </div>
      </div>

      {authenticated ? (
        <div className="mt-auto rounded-2xl border border-line/80 bg-gradient-to-br from-surface-2 to-surface p-3.5">
          <div className="flex items-center gap-2.5">
            {account?.avatarUrl ? (
              <img
                src={account.avatarUrl}
                alt=""
                draggable={false}
                className="size-9 shrink-0 rounded-full border border-line/60 object-cover"
              />
            ) : (
              <div className="grid size-9 shrink-0 place-items-center rounded-full border border-line/60 bg-surface-3 text-muted">
                <UserRound className="size-4" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-medium text-ink">
                {account?.name ?? 'YouTube Music'}
              </div>
              <div className="truncate text-[10px] text-faint">
                {account?.handle ?? 'Account connected'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              disabled={isPending}
              aria-label="Sign out of YouTube Music"
              title="Sign out"
              className="grid size-7 shrink-0 place-items-center rounded-full text-faint transition hover:bg-surface-3 hover:text-ink disabled:cursor-wait disabled:opacity-50"
            >
              {isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <LogOut className="size-3.5" />
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={() => navigate('/library')}
            className="mt-3 flex w-full items-center justify-between rounded-xl border border-line/70 bg-canvas/40 px-3 py-2 text-[11px] font-medium text-muted transition hover:border-accent/30 hover:text-ink"
          >
            Open library
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      ) : (
        <div className="mt-auto rounded-2xl border border-line/80 bg-gradient-to-br from-surface-2 to-surface p-3.5">
          <div className="text-[12px] font-medium text-ink">Sign in to YouTube Music</div>
          <p className="mt-1 text-[11px] leading-relaxed text-faint">
            Sync your library, playlists and recommendations.
          </p>
          <button
            type="button"
            onClick={() => (isPending ? void cancelSignIn() : void signIn())}
            disabled={isLoading}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-3 py-2 text-[12px] font-semibold text-accent-ink transition hover:bg-accent-soft disabled:cursor-wait disabled:opacity-60"
          >
            {(isLoading || isPending) && <Loader2 className="size-3.5 animate-spin" />}
            {isPending ? 'Cancel sign-in' : 'Connect account'}
          </button>
        </div>
      )}

      <div className="mt-4 px-2 text-[10px] text-faint">
        ToneGlass {version || '…'} · unofficial client
      </div>
    </aside>
  )
}
