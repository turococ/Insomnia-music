import { Headphones, Home, Library, Search, Settings, Sparkles } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { cn } from '@renderer/lib/cn'

const navigation = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/library', label: 'Library', icon: Library },
  { to: '/settings', label: 'Settings', icon: Settings }
]

export function Sidebar(): React.JSX.Element {
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
            Queue &amp; synced lyrics
          </div>
          <div className="rounded-xl border border-line/70 bg-canvas/40 px-3 py-2.5">
            Library &amp; account sync
          </div>
          <div className="rounded-xl border border-line/70 bg-canvas/40 px-3 py-2.5">
            Offline downloads
          </div>
        </div>
      </div>

      <div className="mt-auto rounded-2xl border border-line/80 bg-gradient-to-br from-surface-2 to-surface p-3.5">
        <div className="text-[12px] font-medium text-ink">Sign in to YouTube Music</div>
        <p className="mt-1 text-[11px] leading-relaxed text-faint">
          Sync your library, playlists and recommendations.
        </p>
        <button
          type="button"
          className="mt-3 w-full rounded-xl bg-accent px-3 py-2 text-[12px] font-semibold text-accent-ink transition hover:bg-accent-soft"
        >
          Connect account
        </button>
      </div>

      <div className="mt-4 px-2 text-[10px] text-faint">ToneGlass 0.1.0 · unofficial client</div>
    </aside>
  )
}
