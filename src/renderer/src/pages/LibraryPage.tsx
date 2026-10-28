import {
  Disc3,
  Globe2,
  Heart,
  Library,
  ListMusic,
  Loader2,
  LogOut,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users
} from 'lucide-react'
import { useState } from 'react'
import type { LibraryListKind } from '@shared/types'
import { useAuth } from '@renderer/features/auth/context'
import { LibraryGrid } from '@renderer/features/library/LibraryGrid'
import { LikedSongsLibrary } from '@renderer/features/library/LikedSongsLibrary'
import { cn } from '@renderer/lib/cn'

type LibraryTab = 'songs' | LibraryListKind

const TABS: Array<{
  id: LibraryTab
  label: string
  icon: typeof Heart
}> = [
  { id: 'songs', label: 'Liked songs', icon: Heart },
  { id: 'playlists', label: 'Playlists', icon: ListMusic },
  { id: 'albums', label: 'Albums', icon: Disc3 },
  { id: 'artists', label: 'Artists', icon: Users }
]

function LibrarySkeleton(): React.JSX.Element {
  return (
    <div className="space-y-8 p-8">
      <div className="space-y-3">
        <div className="h-3 w-24 animate-pulse rounded-full bg-surface-2" />
        <div className="h-9 w-52 animate-pulse rounded-full bg-surface-2" />
        <div className="h-3 w-64 animate-pulse rounded-full bg-surface-2" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-9 w-28 animate-pulse rounded-full bg-surface-2" />
        ))}
      </div>
      <div className="flex items-center gap-5 rounded-3xl border border-line/70 bg-surface/40 p-5">
        <div className="size-28 shrink-0 animate-pulse rounded-2xl bg-surface-2" />
        <div className="flex-1 space-y-3">
          <div className="h-3 w-24 animate-pulse rounded-full bg-surface-2" />
          <div className="h-8 w-48 animate-pulse rounded-full bg-surface-2" />
          <div className="h-3 w-36 animate-pulse rounded-full bg-surface-2" />
        </div>
      </div>
    </div>
  )
}

function SignedOutLibrary({
  signingIn,
  onSignIn,
  onCancel
}: {
  signingIn: boolean
  onSignIn: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <div className="space-y-8 p-8">
      <div>
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
          <Sparkles className="size-3" />
          Collection
        </div>
        <h1 className="mt-2 text-[30px] font-semibold tracking-[-0.03em]">Your library</h1>
        <p className="mt-1 text-[12px] text-faint">
          Connect YouTube Music to bring your saved music into Insomnia.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          {
            icon: Heart,
            title: 'Liked songs',
            subtitle: 'Every track you have liked, with filters and full playback queues.'
          },
          {
            icon: ListMusic,
            title: 'Playlists',
            subtitle: 'Open your playlists and filter any collection by title, artist or album.'
          },
          {
            icon: Disc3,
            title: 'Albums & artists',
            subtitle: 'Keep the records and artists you save close at hand.'
          }
        ].map(({ icon: Icon, title, subtitle }) => (
          <div
            key={title}
            className="rounded-2xl border border-line/80 bg-gradient-to-br from-surface-2 to-surface p-5"
          >
            <div className="grid size-10 place-items-center rounded-xl bg-accent/10 text-accent">
              <Icon className="size-5" />
            </div>
            <h2 className="mt-4 text-[14px] font-semibold">{title}</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-faint">{subtitle}</p>
          </div>
        ))}
      </div>

      <div className="rounded-3xl border border-dashed border-line p-10 text-center">
        <Library className="mx-auto size-7 text-faint" />
        <h2 className="mt-4 text-base font-semibold">Your music, in one place</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted">
          Sign-in happens in a secure Insomnia window. Your password stays with Google; only the
          YouTube Music session is stored on this device.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onSignIn}
            disabled={signingIn}
            className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[12px] font-semibold text-accent-ink transition hover:bg-accent-soft disabled:cursor-wait disabled:opacity-60"
          >
            {signingIn ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Globe2 className="size-3.5" />
            )}
            {signingIn ? 'Signing in…' : 'Connect YouTube Music'}
          </button>
          {signingIn && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full border border-line px-4 py-2.5 text-[11px] font-medium text-muted transition hover:border-line hover:text-ink"
            >
              Cancel
            </button>
          )}
        </div>
        {signingIn && (
          <p className="mt-3 text-[10px] text-faint">
            Finish signing in in the Insomnia window; it closes itself once the account is
            connected.
          </p>
        )}
        <div className="mt-4 flex items-center justify-center gap-1.5 text-[10px] text-faint">
          <ShieldCheck className="size-3 text-accent/70" />
          Session saved on this device only
        </div>
      </div>
    </div>
  )
}

export function LibraryPage(): React.JSX.Element {
  const { status, isLoading, isPending, signIn, cancelSignIn, signOut } = useAuth()
  const [tab, setTab] = useState<LibraryTab>('songs')
  const account = status?.account
  const authenticated = Boolean(status?.authenticated)

  if (isLoading) return <LibrarySkeleton />

  if (!authenticated) {
    return (
      <SignedOutLibrary
        signingIn={isPending}
        onSignIn={() => void signIn()}
        onCancel={() => void cancelSignIn()}
      />
    )
  }

  return (
    <div className="space-y-7 p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
            <Sparkles className="size-3" />
            Collection
          </div>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-0.03em]">Your library</h1>
          <p className="mt-1 text-[12px] text-faint">
            Synced from YouTube Music. Everything here is available in filters and playback queues.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex min-w-0 items-center gap-2.5 rounded-2xl border border-line/80 bg-surface-2/50 px-3 py-2">
            {account?.avatarUrl ? (
              <img
                src={account.avatarUrl}
                alt=""
                draggable={false}
                className="size-8 shrink-0 rounded-full border border-line/60 object-cover"
              />
            ) : (
              <div className="grid size-8 shrink-0 place-items-center rounded-full border border-line/60 bg-surface-3 text-muted">
                <UserRound className="size-4" />
              </div>
            )}
            <div className="min-w-0">
              <div className="max-w-[150px] truncate text-[11px] font-medium text-ink">
                {account?.name ?? 'YouTube Music'}
              </div>
              <div className="max-w-[150px] truncate text-[9px] text-faint">
                {account?.handle ?? 'Account connected'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              disabled={isPending}
              aria-label="Sign out of YouTube Music"
              title="Sign out"
              className="ml-1 grid size-7 shrink-0 place-items-center rounded-full text-faint transition hover:bg-surface-3 hover:text-ink disabled:cursor-wait disabled:opacity-50"
            >
              {isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <LogOut className="size-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="no-scrollbar flex gap-2 overflow-x-auto border-b border-line/60 pb-3">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = id === tab
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-pressed={active}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-[12px] font-medium transition',
                active
                  ? 'border-accent/30 bg-accent/10 text-ink'
                  : 'border-line/70 bg-surface-2/40 text-muted hover:border-line hover:text-ink'
              )}
            >
              <Icon className={cn('size-3.5', active ? 'text-accent' : 'text-faint')} />
              {label}
            </button>
          )
        })}
      </div>

      {tab === 'songs' ? <LikedSongsLibrary /> : <LibraryGrid key={tab} kind={tab} />}
    </div>
  )
}
