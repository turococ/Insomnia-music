import { Check, Code2, Palette, RotateCcw, SlidersHorizontal, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@renderer/lib/cn'

const accents = [
  { id: 'lime', label: 'Lime', color: '#c7ff4a', soft: '#e4ffa3' },
  { id: 'violet', label: 'Violet', color: '#a78bfa', soft: '#c4b5fd' },
  { id: 'cyan', label: 'Cyan', color: '#22d3ee', soft: '#67e8f9' },
  { id: 'coral', label: 'Coral', color: '#fb7185', soft: '#fda4af' },
  { id: 'amber', label: 'Amber', color: '#fbbf24', soft: '#fcd34d' }
] as const

type AccentId = (typeof accents)[number]['id']

function storedAccent(): AccentId {
  const id = localStorage.getItem('muse:accent')
  return accents.some((accent) => accent.id === id) ? (id as AccentId) : 'lime'
}

function Toggle({ enabled }: { enabled?: boolean }): React.JSX.Element {
  return (
    <span
      className={cn(
        'relative h-5 w-9 rounded-full border transition',
        enabled ? 'border-accent/30 bg-accent/20' : 'border-line bg-surface-3'
      )}
    >
      <span
        className={cn(
          'absolute top-1/2 size-3 -translate-y-1/2 rounded-full transition',
          enabled ? 'left-[18px] bg-accent' : 'left-1 bg-faint'
        )}
      />
    </span>
  )
}

export function SettingsPage(): React.JSX.Element {
  const [accentId, setAccentId] = useState<AccentId>(storedAccent)
  const [css, setCss] = useState(() => localStorage.getItem('muse:custom-css') ?? '')

  const accent = accents.find((option) => option.id === accentId) ?? accents[0]

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--color-accent', accent.color)
    root.style.setProperty('--color-accent-soft', accent.soft)
    localStorage.setItem('muse:accent', accent.id)
  }, [accent])

  useEffect(() => {
    let style = document.getElementById('muse-user-css') as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = 'muse-user-css'
      document.head.appendChild(style)
    }
    style.textContent = css
    localStorage.setItem('muse:custom-css', css)
  }, [css])

  const reset = (): void => {
    setAccentId('lime')
    setCss('')
  }

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
            Make Muse yours. Themes and custom CSS are stored locally.
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="flex items-center gap-2 rounded-full border border-line bg-surface-2/60 px-4 py-2 text-[12px] text-muted transition hover:text-ink"
        >
          <RotateCcw className="size-3.5" />
          Reset
        </button>
      </div>

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
              onClick={() => setAccentId(option.id)}
              className={cn(
                'flex items-center gap-2.5 rounded-full border px-3 py-2 text-[12px] transition',
                option.id === accentId
                  ? 'border-accent/40 bg-accent/10 text-ink'
                  : 'border-line bg-surface-2/60 text-muted hover:text-ink'
              )}
            >
              <span
                className="grid size-5 place-items-center rounded-full"
                style={{ backgroundColor: option.color }}
              >
                {option.id === accentId && <Check className="size-3 text-black" strokeWidth={3} />}
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
          <Code2 className="size-4 text-accent" />
          <h2 className="text-[14px] font-semibold">Custom CSS</h2>
        </div>
        <p className="mt-1 text-[11px] text-faint">
          Advanced escape hatch. Selectors are applied globally and saved in this app.
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

      <section className="rounded-3xl border border-line/80 bg-surface/70 p-6">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="size-4 text-accent" />
          <h2 className="text-[14px] font-semibold">Playback</h2>
        </div>
        <div className="mt-4 divide-y divide-line/60">
          {[
            { label: 'Audio quality', description: 'Prefer the highest available bitrate', value: 'Best' },
            { label: 'Gapless playback', description: 'Preload the next track in the queue', toggle: true },
            { label: 'Normalise volume', description: 'Even out loudness between tracks', toggle: false }
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4 py-3.5">
              <div>
                <div className="text-[12px] font-medium text-ink">{row.label}</div>
                <div className="mt-0.5 text-[10px] text-faint">{row.description}</div>
              </div>
              {row.toggle ? (
                <Toggle enabled={row.label === 'Gapless playback'} />
              ) : (
                <span className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[10px] text-muted">
                  {row.value}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
