import {
  ArrowDownToLine,
  Check,
  Code2,
  Loader2,
  Palette,
  PanelBottom,
  Power,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Timer
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { AudioQuality, UpdateState } from '@shared/types'
import { cn } from '@renderer/lib/cn'
import { usePlayer } from '@renderer/features/player/store'
import { accents } from '@renderer/features/settings/accents'
import { useSettings } from '@renderer/features/settings/context'

const qualityOptions: Array<{ id: AudioQuality; label: string; description: string }> = [
  {
    id: 'best',
    label: 'Best available',
    description: 'Highest bitrate YouTube offers. Uses more data.'
  },
  {
    id: 'data-saver',
    label: 'Data saver',
    description: 'Lowest bitrate stream. Noticeably lighter on mobile data.'
  }
]

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function Toggle({
  checked,
  onChange,
  label,
  disabled
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full border transition disabled:cursor-not-allowed disabled:opacity-40',
        checked ? 'border-accent/30 bg-accent/20' : 'border-line bg-surface-3'
      )}
    >
      <span
        className={cn(
          'absolute top-1/2 size-3 -translate-y-1/2 rounded-full transition',
          checked ? 'left-[18px] bg-accent' : 'left-1 bg-faint'
        )}
      />
    </button>
  )
}

function SettingRow({
  title,
  description,
  children
}: {
  title: string
  description: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-ink">{title}</div>
        <div className="mt-0.5 text-[10px] leading-4 text-faint">{description}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function useUpdater(): {
  state: UpdateState
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
} {
  const [state, setState] = useState<UpdateState>({ status: 'idle' })

  useEffect(() => {
    let cancelled = false

    window.api.updates
      .status()
      .then((next) => {
        if (!cancelled) setState(next)
      })
      .catch(() => undefined)

    const unsubscribe = window.api.updates.onChange((next) => setState(next))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const check = useCallback(async () => {
    setState({ status: 'checking' })
    try {
      setState(await window.api.updates.check())
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) })
    }
  }, [])

  const download = useCallback(async () => {
    try {
      setState(await window.api.updates.download())
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) })
    }
  }, [])

  const install = useCallback(async () => {
    try {
      await window.api.updates.install()
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) })
    }
  }, [])

  return { state, check, download, install }
}

function CustomCssSection({
  initialCss,
  onSave
}: {
  initialCss: string
  onSave: (css: string) => Promise<void>
}): React.JSX.Element {
  const [css, setCss] = useState(initialCss)

  useEffect(() => {
    if (css === initialCss) return
    const timer = window.setTimeout(() => void onSave(css), 600)
    return () => window.clearTimeout(timer)
  }, [css, initialCss, onSave])

  return (
    <section className="rounded-3xl border border-line/80 bg-surface/70 p-6">
      <div className="flex items-center gap-2">
        <Code2 className="size-4 text-accent" />
        <h2 className="text-[14px] font-semibold">Custom CSS</h2>
      </div>
      <p className="mt-1 text-[11px] text-faint">
        Advanced escape hatch. Selectors are applied globally and saved to your settings.
      </p>
      <textarea
        value={css}
        onChange={(event) => setCss(event.target.value)}
        spellCheck={false}
        placeholder={`/* Example */\n.sidebar {\n  background: #0b0b10;\n}`}
        className="mt-4 h-40 w-full resize-y rounded-2xl border border-line bg-canvas/70 p-4 font-mono text-[12px] leading-relaxed text-ink outline-none transition placeholder:text-faint focus:border-accent/40"
      />
      <div className="mt-3 flex items-center justify-between text-[10px] text-faint">
        <span>Saved automatically</span>
        <span className="font-mono">{css.length} chars</span>
      </div>
    </section>
  )
}

export function SettingsPage(): React.JSX.Element {
  const { settings, isLoading, error, update, reset } = useSettings()
  const autoplay = usePlayer((state) => state.autoplay)
  const setAutoplay = usePlayer((state) => state.setAutoplay)
  const { state: updateState, check, download, install } = useUpdater()
  const [version, setVersion] = useState('')
  const [cssKey, setCssKey] = useState(0)

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

  const saveCss = useCallback((customCss: string) => update({ customCss }), [update])

  const handleReset = async (): Promise<void> => {
    if (!window.confirm('Reset all Insomnia settings to their defaults?')) return
    await reset()
    setCssKey((key) => key + 1)
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[12px] text-faint">
        <Loader2 className="size-4 animate-spin text-accent" />
        Loading settings…
      </div>
    )
  }

  const quality = qualityOptions.find((option) => option.id === settings.audioQuality)
  const busy = updateState.status === 'checking' || updateState.status === 'downloading'

  return (
    <div className="space-y-8 p-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
            <SlidersHorizontal className="size-3" />
            Personalise
          </div>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-0.03em]">Settings</h1>
          <p className="mt-1 text-[12px] text-faint">
            Playback, appearance and updates. Everything is stored locally.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleReset()}
          className="flex items-center gap-2 rounded-full border border-line bg-surface-2/60 px-4 py-2 text-[12px] text-muted transition hover:text-ink"
        >
          <RotateCcw className="size-3.5" />
          Reset all
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-[11px] text-red-300">
          {error}
        </div>
      )}

      <section className="rounded-3xl border border-line/80 bg-surface/70 p-6">
        <div className="flex items-center gap-2">
          <Palette className="size-4 text-accent" />
          <h2 className="text-[14px] font-semibold">Accent colour</h2>
        </div>
        <p className="mt-1 text-[11px] text-faint">Applied instantly across the whole interface.</p>

        <div className="mt-5 flex flex-wrap gap-3">
          {accents.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => void update({ accent: option.id })}
              className={cn(
                'flex items-center gap-2.5 rounded-full border px-3 py-2 text-[12px] transition',
                option.id === settings.accent
                  ? 'border-accent/40 bg-accent/10 text-ink'
                  : 'border-line bg-surface-2/60 text-muted hover:text-ink'
              )}
            >
              <span
                className="grid size-5 place-items-center rounded-full"
                style={{ backgroundColor: option.color }}
              >
                {option.id === settings.accent && (
                  <Check className="size-3" style={{ color: option.ink }} strokeWidth={3} />
                )}
              </span>
              {option.label}
            </button>
          ))}
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl border border-line/70">
          <div className="flex items-center gap-3 border-b border-line/70 bg-surface-2/60 px-4 py-3">
            <div className="grid size-8 place-items-center rounded-lg bg-accent text-accent-ink">
              <Sparkles className="size-4" />
            </div>
            <div>
              <div className="text-[12px] font-medium">Preview</div>
              <div className="text-[10px] text-faint">This is how accent elements will look.</div>
            </div>
            <button
              type="button"
              className="ml-auto rounded-full bg-accent px-3 py-1.5 text-[11px] font-semibold text-accent-ink"
            >
              Play now
            </button>
          </div>
          <div className="flex items-center gap-2 bg-canvas/50 px-4 py-3 text-[11px] text-faint">
            <span className="size-1.5 rounded-full bg-accent" />
            Active state, sliders and highlights use the same token.
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-line/80 bg-surface/70 p-6">
        <div className="flex items-center gap-2">
          <Timer className="size-4 text-accent" />
          <h2 className="text-[14px] font-semibold">Playback</h2>
        </div>

        <div className="mt-2 divide-y divide-line/60">
          <SettingRow title="Audio quality" description={quality?.description ?? ''}>
            <div className="flex rounded-full border border-line/70 bg-surface-2/60 p-0.5">
              {qualityOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => void update({ audioQuality: option.id })}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-[11px] font-medium transition',
                    option.id === settings.audioQuality
                      ? 'bg-surface-3 text-ink'
                      : 'text-faint hover:text-muted'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </SettingRow>

          <SettingRow
            title="Autoplay similar songs"
            description="Keep the music going when the queue runs out."
          >
            <Toggle checked={autoplay} onChange={setAutoplay} label="Autoplay similar songs" />
          </SettingRow>
        </div>
        <p className="mt-3 text-[10px] text-faint">
          Quality changes apply to the next track you play.
        </p>
      </section>

      <section className="rounded-3xl border border-line/80 bg-surface/70 p-6">
        <div className="flex items-center gap-2">
          <Power className="size-4 text-accent" />
          <h2 className="text-[14px] font-semibold">App behaviour</h2>
        </div>

        <div className="mt-2 divide-y divide-line/60">
          <SettingRow
            title="Close to tray"
            description="Keep playing when you close the window; reopen from the tray."
          >
            <Toggle
              checked={settings.closeToTray}
              onChange={(closeToTray) => void update({ closeToTray })}
              label="Close to tray"
            />
          </SettingRow>

          <SettingRow
            title="Launch at startup"
            description="Start Insomnia minimized in the tray when you sign in."
          >
            <Toggle
              checked={settings.launchAtStartup}
              onChange={(launchAtStartup) => void update({ launchAtStartup })}
              label="Launch at startup"
            />
          </SettingRow>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-line/60 bg-canvas/40 px-4 py-3 text-[10px] text-faint">
          <PanelBottom className="size-3.5 shrink-0 text-accent" />
          Insomnia stays in the system tray while it is running.
        </div>
      </section>

      <section className="rounded-3xl border border-line/80 bg-surface/70 p-6">
        <div className="flex items-center gap-2">
          <ArrowDownToLine className="size-4 text-accent" />
          <h2 className="text-[14px] font-semibold">Updates</h2>
          <span className="ml-auto rounded-full border border-line/70 bg-surface-2 px-2 py-0.5 text-[10px] text-muted">
            v{version || '—'}
          </span>
        </div>

        <div className="mt-2 divide-y divide-line/60">
          <SettingRow
            title="Check automatically"
            description="Look for new versions in the background after launch."
          >
            <Toggle
              checked={settings.autoUpdate}
              onChange={(autoUpdate) => void update({ autoUpdate })}
              label="Check for updates automatically"
            />
          </SettingRow>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void check()}
            disabled={busy}
            className="flex items-center gap-2 rounded-full border border-line bg-surface-2/60 px-3.5 py-2 text-[11px] font-medium text-muted transition hover:text-ink disabled:opacity-50"
          >
            {updateState.status === 'checking' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Check for updates
          </button>

          {updateState.status === 'available' && (
            <button
              type="button"
              onClick={() => void download()}
              className="flex items-center gap-2 rounded-full bg-accent px-3.5 py-2 text-[11px] font-semibold text-accent-ink transition hover:bg-accent-soft"
            >
              <ArrowDownToLine className="size-3.5" />
              Download {updateState.version}
            </button>
          )}

          {updateState.status === 'downloaded' && (
            <button
              type="button"
              onClick={() => void install()}
              className="flex items-center gap-2 rounded-full bg-accent px-3.5 py-2 text-[11px] font-semibold text-accent-ink transition hover:bg-accent-soft"
            >
              <Power className="size-3.5" />
              Restart and install
            </button>
          )}

          <span className="text-[10px] leading-4 text-faint">{updateStatusText(updateState)}</span>
        </div>
      </section>

      <CustomCssSection key={cssKey} initialCss={settings.customCss} onSave={saveCss} />
    </div>
  )
}

function updateStatusText(state: UpdateState): string {
  switch (state.status) {
    case 'checking':
      return 'Checking for updates…'
    case 'available':
      return `Version ${state.version ?? 'new'} is available.`
    case 'up-to-date':
      return "You're on the latest version."
    case 'downloading':
      return `Downloading update… ${state.percent ?? 0}%`
    case 'downloaded':
      return 'Update downloaded. It will install on restart.'
    case 'error':
      return state.message ?? 'Could not check for updates.'
    case 'unsupported':
      return state.message ?? 'Updates are available in packaged builds only.'
    default:
      return 'Updates are checked automatically after launch.'
  }
}
