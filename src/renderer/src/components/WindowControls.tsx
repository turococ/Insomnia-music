import { Copy, Minus, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'

export function WindowControls(): React.JSX.Element | null {
  const isMac = window.electron.process.platform === 'darwin'
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (isMac) return

    let active = true
    void window.api.window
      .isMaximized()
      .then((value) => {
        if (active) setMaximized(value)
      })
      .catch(() => undefined)

    const unsubscribe = window.api.window.onMaximizedChange(setMaximized)
    return () => {
      active = false
      unsubscribe()
    }
  }, [isMac])

  if (isMac) return null

  const toggleMaximize = (): void => {
    void window.api.window
      .toggleMaximize()
      .then(setMaximized)
      .catch(() => undefined)
  }

  return (
    <div className="no-drag flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => window.api.window.minimize()}
        aria-label="Minimize"
        title="Minimize"
        className="grid h-8 w-9 place-items-center rounded-md text-faint transition hover:bg-surface-2 hover:text-ink active:bg-surface-3"
      >
        <Minus className="size-4" />
      </button>
      <button
        type="button"
        onClick={toggleMaximize}
        aria-label={maximized ? 'Restore' : 'Maximize'}
        title={maximized ? 'Restore' : 'Maximize'}
        className="grid h-8 w-9 place-items-center rounded-md text-faint transition hover:bg-surface-2 hover:text-ink active:bg-surface-3"
      >
        {maximized ? <Copy className="size-3.5" /> : <Square className="size-3.5" />}
      </button>
      <button
        type="button"
        onClick={() => window.api.window.close()}
        aria-label="Close"
        title="Close"
        className="grid h-8 w-9 place-items-center rounded-md text-faint transition hover:bg-red-500 hover:text-white active:bg-red-600"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
