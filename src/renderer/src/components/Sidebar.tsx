import {
  Home,
  Library,
  Loader2,
  LogIn,
  LogOut,
  MoonStar,
  Search,
  Settings,
  Sparkles,
  Sun,
  Sunrise,
  Sunset,
  UserRound
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '@renderer/features/auth/context'
import { cn } from '@renderer/lib/cn'
import { greetingFor, useDayPeriod, type DayPeriod } from '@renderer/lib/timeOfDay'

const navigation = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/library', label: 'Library', icon: Library },
  { to: '/settings', label: 'Settings', icon: Settings }
]

const periodIcons: Record<DayPeriod, typeof Sun> = {
  night: MoonStar,
  morning: Sunrise,
  afternoon: Sun,
  evening: Sunset
}

export function Sidebar(): React.JSX.Element {
  const { status, isLoading, isPending, signIn, cancelSignIn, signOut } = useAuth()
  const account = status?.account
  const authenticated = Boolean(status?.authenticated)
  const isMac = window.electron.process.platform === 'darwin'
  const [version, setVersion] = useState('')
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<number | null>(null)
  const period = useDayPeriod()
  const PeriodIcon = periodIcons[period]
  const periodLabel = greetingFor(period)

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

  const cancelClose = (): void => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  const openSidebar = (): void => {
    cancelClose()
    setOpen(true)
  }

  const scheduleClose = (): void => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => {
      setOpen(false)
      closeTimer.current = null
    }, 140)
  }

  useEffect(() => cancelClose, [])

  return (
    <div className="relative z-20 w-[76px] shrink-0">
      <aside
        aria-label="Main navigation"
        style={{ width: open ? 248 : 76 }}
        className={cn(
          'sidebar-panel absolute inset-y-0 left-0 z-20 flex flex-col overflow-hidden border-r border-line/80 bg-surface/90 px-2 pb-4 backdrop-blur-xl',
          isMac ? 'pt-14' : 'pt-6',
          open ? 'shadow-2xl shadow-black/50' : 'shadow-none'
        )}
        onMouseEnter={openSidebar}
        onMouseLeave={scheduleClose}
      >
        <div className="mb-9 flex items-center gap-3 pl-[10px]">
          <div
            className="grid size-10 shrink-0 place-items-center rounded-2xl bg-accent text-accent-ink shadow-[0_0_32px_-8px] shadow-accent/60"
            title={`${periodLabel} · INSOMNIA`}
          >
            <PeriodIcon key={period} className="period-icon size-5" strokeWidth={2.5} />
          </div>
          <div aria-hidden={!open} className="w-[170px] shrink-0 overflow-hidden whitespace-nowrap">
            <div className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
              <span
                className={cn(
                  'transition-opacity',
                  open ? 'opacity-100 delay-[80ms] duration-200' : 'opacity-0 delay-0 duration-100'
                )}
              >
                INSOMNIA
              </span>
              <span
                className={cn(
                  'rounded-full border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-accent transition-opacity',
                  open ? 'opacity-100 delay-200 duration-150' : 'opacity-0 delay-0 duration-100'
                )}
              >
                beta
              </span>
            </div>
            <div
              className={cn(
                'text-[11px] text-faint transition-opacity',
                open ? 'opacity-100 delay-[180ms] duration-200' : 'opacity-0 delay-0 duration-100'
              )}
            >
              YouTube Music, reimagined
            </div>
          </div>
        </div>

        <nav className="space-y-1">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={label}
              aria-label={label}
              className={({ isActive }) =>
                cn(
                  'group relative flex h-10 items-center gap-3 rounded-xl transition-[padding,background-color,color,box-shadow] duration-300',
                  open ? 'pl-3 pr-3' : 'pl-[21px] pr-2',
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
                      'size-[18px] shrink-0 transition',
                      isActive ? 'text-accent' : 'text-faint group-hover:text-muted'
                    )}
                    strokeWidth={2}
                  />
                  <span
                    aria-hidden={!open}
                    className={cn(
                      'w-[150px] shrink-0 overflow-hidden whitespace-nowrap transition-opacity',
                      open
                        ? 'opacity-100 delay-[80ms] duration-200'
                        : 'opacity-0 delay-0 duration-100'
                    )}
                  >
                    {label}
                  </span>
                  {isActive && open && <span className="ml-auto size-1.5 rounded-full bg-accent" />}
                  {isActive && !open && (
                    <span className="absolute -left-2 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div
          aria-hidden={!open}
          className={cn(
            'overflow-hidden transition-all',
            open
              ? 'mt-8 max-h-[240px] opacity-100 delay-[160ms] duration-300'
              : 'mt-0 max-h-0 opacity-0 delay-0 duration-150'
          )}
        >
          <div className="px-2">
            <div className="mb-3 flex items-center gap-2 whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
              <Sparkles className="size-3 text-accent" />
              Coming next
            </div>
            <div className="space-y-2 text-[12px] text-muted">
              <div className="whitespace-nowrap rounded-xl border border-line/70 bg-canvas/40 px-3 py-2.5">
                Offline downloads
              </div>
              <div className="whitespace-nowrap rounded-xl border border-line/70 bg-canvas/40 px-3 py-2.5">
                Equalizer
              </div>
              <div className="whitespace-nowrap rounded-xl border border-line/70 bg-canvas/40 px-3 py-2.5">
                Listening stats
              </div>
            </div>
          </div>
        </div>

        {authenticated ? (
          <div
            className={cn(
              'mt-auto w-full transition-all duration-300',
              open
                ? 'rounded-2xl border border-line/80 bg-gradient-to-br from-surface-2 to-surface py-3.5 pr-3.5'
                : 'rounded-2xl border border-transparent'
            )}
          >
            <div
              className={cn(
                'flex items-center gap-2.5 transition-[padding] duration-300',
                open ? 'pl-3.5' : 'pl-[10px]'
              )}
            >
              <button
                type="button"
                onClick={open ? undefined : openSidebar}
                disabled={open}
                tabIndex={open ? -1 : undefined}
                title={account?.name ?? 'Account'}
                aria-label={open ? 'Account' : 'Open account panel'}
                className="grid size-10 shrink-0 place-items-center rounded-full border border-line/70 bg-surface-2/80 text-muted transition hover:border-accent/40 hover:text-ink disabled:cursor-default disabled:opacity-100"
              >
                {account?.avatarUrl ? (
                  <img
                    src={account.avatarUrl}
                    alt=""
                    draggable={false}
                    className="size-9 rounded-full object-cover"
                  />
                ) : (
                  <UserRound className="size-4" />
                )}
              </button>
              <div
                aria-hidden={!open}
                className={cn(
                  'w-[110px] shrink-0 overflow-hidden whitespace-nowrap transition-opacity',
                  open ? 'opacity-100 delay-[140ms] duration-200' : 'opacity-0 delay-0 duration-100'
                )}
              >
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
                tabIndex={open ? undefined : -1}
                aria-hidden={!open}
                aria-label="Sign out of YouTube Music"
                title="Sign out"
                className={cn(
                  'ml-auto grid size-7 shrink-0 place-items-center rounded-full text-faint transition-opacity hover:bg-surface-3 hover:text-ink disabled:cursor-wait disabled:opacity-50',
                  open
                    ? 'opacity-100 delay-[180ms] duration-150'
                    : 'pointer-events-none opacity-0 delay-0 duration-100'
                )}
              >
                {isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <LogOut className="size-3.5" />
                )}
              </button>
            </div>
          </div>
        ) : open ? (
          <div className="reveal-in mt-auto w-full rounded-2xl border border-line/80 bg-gradient-to-br from-surface-2 to-surface p-3.5">
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
        ) : (
          <div className="mt-auto flex justify-center">
            <button
              type="button"
              onClick={() => (isPending ? void cancelSignIn() : void signIn())}
              disabled={isLoading}
              title={isPending ? 'Cancel sign-in' : 'Sign in to YouTube Music'}
              aria-label={isPending ? 'Cancel sign-in' : 'Sign in to YouTube Music'}
              className="grid size-10 place-items-center rounded-full bg-accent text-accent-ink shadow-[0_0_24px_-6px] shadow-accent/60 transition hover:bg-accent-soft disabled:cursor-wait disabled:opacity-60"
            >
              {isLoading || isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <LogIn className="size-4" />
              )}
            </button>
          </div>
        )}

        <div
          aria-hidden={!open}
          className={cn(
            'overflow-hidden whitespace-nowrap px-2 text-[10px] text-faint transition-all',
            open
              ? 'mt-4 h-4 opacity-100 delay-[180ms] duration-300'
              : 'mt-0 h-0 opacity-0 delay-0 duration-150'
          )}
        >
          Insomnia {version || '…'} · unofficial client
        </div>
      </aside>
    </div>
  )
}
