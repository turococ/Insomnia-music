import { AlertCircle, CheckCircle2, X } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useToasts } from './store'

export function Toaster(): React.JSX.Element | null {
  const toasts = useToasts((state) => state.toasts)
  const dismiss = useToasts((state) => state.dismiss)

  if (toasts.length === 0) return null

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-[104px] right-5 z-[90] flex w-[min(340px,calc(100vw-2.5rem))] flex-col gap-2"
    >
      {toasts.map((item) => (
        <div
          key={item.id}
          className={cn(
            'toast-item pointer-events-auto flex items-start gap-2.5 rounded-2xl border bg-surface/95 px-3.5 py-3 shadow-2xl shadow-black/45 backdrop-blur-xl',
            item.tone === 'error' ? 'border-red-400/30' : 'border-line/80'
          )}
        >
          {item.tone === 'error' ? (
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-400" />
          ) : (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent" />
          )}
          <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-muted">{item.message}</p>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => dismiss(item.id)}
            className="grid size-5 shrink-0 place-items-center rounded-full text-faint transition hover:bg-surface-2 hover:text-ink"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  )
}
