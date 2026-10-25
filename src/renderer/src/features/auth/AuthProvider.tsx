import { AlertCircle, Globe2, Loader2, X } from 'lucide-react'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AuthMode, AuthStatus } from '@shared/types'
import { AuthContext, type AuthContextValue } from './context'

function formatAuthError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
      .replace(/^Error invoking remote method '[^']+':\s*/i, '')
      .replace(/^Error:\s*/i, '')
  }
  return 'Could not connect your YouTube Music account.'
}

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const statusQuery = useQuery({
    queryKey: ['auth', 'status'],
    queryFn: () => window.api.auth.status(),
    staleTime: Infinity,
    retry: 1
  })

  const environmentQuery = useQuery({
    queryKey: ['auth', 'environment'],
    queryFn: () => window.api.auth.environment(),
    staleTime: Infinity,
    retry: 1
  })

  const applyStatus = useCallback(
    (status: AuthStatus): void => {
      queryClient.setQueryData(['auth', 'status'], status)
      // Home recommendations and library data are personalised, so rebuild
      // them whenever the active account changes.
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== 'auth'
      })
    },
    [queryClient]
  )

  const signInMutation = useMutation<AuthStatus, Error, AuthMode>({
    mutationFn: (mode) => window.api.auth.signIn(mode),
    onSuccess: (status) => {
      setError(null)
      applyStatus(status)
    },
    onError: (cause) => setError(formatAuthError(cause))
  })

  const signOutMutation = useMutation({
    mutationFn: () => window.api.auth.signOut(),
    onSuccess: (status) => {
      setError(null)
      applyStatus(status)
    },
    onError: (cause) => setError(formatAuthError(cause))
  })

  const browserName =
    environmentQuery.data === undefined ? undefined : (environmentQuery.data.browser?.name ?? null)

  const signIn = useCallback(
    async (mode: AuthMode = 'browser'): Promise<void> => {
      const resolvedMode = mode === 'browser' && browserName === null ? 'embedded' : mode

      setError(null)
      try {
        await signInMutation.mutateAsync(resolvedMode)
      } catch {
        // The mutation's onError handler exposes the failure to the user.
      }
    },
    [browserName, signInMutation]
  )

  const signOut = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      await signOutMutation.mutateAsync()
    } catch {
      // The mutation's onError handler exposes the failure to the user.
    }
  }, [signOutMutation])

  const clearError = useCallback(() => setError(null), [])
  const isPending = signInMutation.isPending || signOutMutation.isPending
  const pendingMode = signInMutation.isPending ? (signInMutation.variables ?? 'browser') : null

  const value = useMemo<AuthContextValue>(
    () => ({
      status: statusQuery.data,
      isLoading: statusQuery.isLoading,
      isPending,
      pendingMode,
      browserName,
      error,
      signIn,
      signOut,
      clearError
    }),
    [
      browserName,
      clearError,
      error,
      isPending,
      pendingMode,
      signIn,
      signOut,
      statusQuery.data,
      statusQuery.isLoading
    ]
  )

  return (
    <AuthContext.Provider value={value}>
      {children}

      {pendingMode === 'browser' && (
        <div className="fixed bottom-28 right-6 z-40 flex max-w-sm items-start gap-3 rounded-2xl border border-accent/20 bg-surface-2/95 p-4 shadow-2xl shadow-black/40 backdrop-blur">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
            <Loader2 className="size-4 animate-spin" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
              <Globe2 className="size-3.5 text-accent" />
              Finish signing in
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              Complete the YouTube Music sign-in in the browser window. ToneGlass will connect
              automatically.
            </p>
            <p className="mt-1.5 text-[10px] text-faint">You can close the browser to cancel.</p>
          </div>
        </div>
      )}

      {error && (
        <div className="fixed right-6 top-20 z-50 flex max-w-sm items-start gap-3 rounded-2xl border border-red-400/20 bg-[#251215]/95 p-4 text-red-100 shadow-2xl shadow-black/40 backdrop-blur">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-300" />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold">Account connection failed</div>
            <p className="mt-1 text-[11px] leading-relaxed text-red-200/75">{error}</p>
          </div>
          <button
            type="button"
            onClick={clearError}
            aria-label="Dismiss account error"
            className="grid size-5 shrink-0 place-items-center rounded-full text-red-200/60 transition hover:bg-white/5 hover:text-red-100"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </AuthContext.Provider>
  )
}
