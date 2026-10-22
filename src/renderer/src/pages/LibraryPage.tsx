import { Disc3, Heart, ListMusic, Plus, Sparkles } from 'lucide-react'

export function LibraryPage(): React.JSX.Element {
  return (
    <div className="space-y-8 p-8">
      <div className="flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
            <Sparkles className="size-3" />
            Collection
          </div>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-0.03em]">Your library</h1>
          <p className="mt-1 text-[12px] text-faint">
            Saved music will live here once account sync is enabled.
          </p>
        </div>
        <button
          type="button"
          className="flex items-center gap-2 rounded-full border border-line bg-surface-2/60 px-4 py-2 text-[12px] text-muted transition hover:text-ink"
        >
          <Plus className="size-3.5" />
          Create playlist
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { icon: Heart, title: 'Liked songs', subtitle: 'Your favourites, in one place' },
          { icon: ListMusic, title: 'Playlists', subtitle: 'Build and organise collections' },
          { icon: Disc3, title: 'Albums', subtitle: 'Records you keep coming back to' }
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
            <div className="mt-6 text-[11px] font-medium text-faint">Sign in to sync</div>
          </div>
        ))}
      </div>

      <div className="rounded-3xl border border-dashed border-line p-10 text-center">
        <ListMusic className="mx-auto size-7 text-faint" />
        <h2 className="mt-4 text-base font-semibold">Nothing saved yet</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
          Anonymous mode is active. Connect a YouTube Music account later to bring in your
          playlists, liked songs and listening history.
        </p>
      </div>
    </div>
  )
}
