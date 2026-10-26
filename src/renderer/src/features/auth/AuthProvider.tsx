import { AlertCircle, Globe2, X } from 'lucide-react'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AuthStatus, SignInResult } from '@shared/types'
import { AuthContext, type AuthContextValue } from './context'

const BLOCKED_SIGN_IN_ERROR =
  'Google refused to sign in inside ToneGlass. Try again, or finish in Chrome instead.'

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
  const [browserFallback, setBrowserFallback] = useState(false)

  const statusQuery = useQuery({
    queryKey: ['auth', 'status'],
    queryFn: () => window.api.auth.status(),
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

  const applyResult = useCallback(
    (result: SignInResult): void => {
      applyStatus(result.status)

      if (result.outcome === 'blocked') {
        setError(BLOCKED_SIGN_IN_ERROR)
        setBrowserFallback(true)
        return
      }

      setError(null)
      setBrowserFallback(false)
    },
    [applyStatus]
  )

  const signInMutation = useMutation({
    mutationFn: () => window.api.auth.signIn(),
    onSuccess: applyResult,
    onError: (cause) => setError(formatAuthError(cause))
  })

  const browserSignInMutation = useMutation({
    mutationFn: () => window.api.auth.signInWithBrowser(),
    onSuccess: applyResult,
    onError: (cause) => setError(formatAuthError(cause))
  })

  const signOutMutation = useMutation({
    mutationFn: () => window.api.auth.signOut(),
    onSuccess: (status) => {
      setError(null)
      setBrowserFallback(false)
      applyStatus(status)
    },
    onError: (cause) => setError(formatAuthError(cause))
  })

  const runSignIn = useCallback(
    async (mutation: typeof signInMutation | typeof browserSignInMutation): Promise<void> => {
      setError(null)
      setBrowserFallback(false)
      try {
        await mutation.mutateAsync()
      } catch {
        // The mutation's onError handler exposes the failure to the user.
      }
    },
    []
  )

  const signIn = useCallback(
    async (): Promise<void> => runSignIn(signInMutation),
    [runSignIn, signInMutation]
  )

  const signInWithBrowser = useCallback(
    async (): Promise<void> => runSignIn(browserSignInMutation),
    [runSignIn, browserSignInMutation]
  )

  const cancelSignIn = useCallback(async (): Promise<void> => {
    setError(null)
    setBrowserFallback(false)
    try {
      await window.api.auth.cancelSignIn()
    } catch (cause) {
      setError(formatAuthError(cause))
    }
  }, [])

  const signOut = useCallback(async (): Promise<void> => {
    setError(null)
    setBrowserFallback(false)
    try {
      await signOutMutation.mutateAsync()
    } catch {
      // The mutation's onError handler exposes the failure to the user.
    }
  }, [signOutMutation])

  const clearError = useCallback(() => {
    setError(null)
    setBrowserFallback(false)
  }, [])

  const isPending =
    signInMutation.isPending || browserSignInMutation.isPending || signOutMutation.isPending

  const value = useMemo<AuthContextValue>(
    () => ({
      status: statusQuery.data,
      isLoading: statusQuery.isLoading,
      isPending,
      error,
      signIn,
      signInWithBrowser,
      cancelSignIn,
      signOut,
      clearError
    }),
    [
      cancelSignIn,
      clearError,
      error,
      isPending,
      signIn,
      signInWithBrowser,
      signOut,
      statusQuery.data,
      statusQuery.isLoading
    ]
  )

  return (
    <AuthContext.Provider value={value}>
      {children}

      {error && (
        <div className="fixed right-6 top-20 z-50 flex max-w-sm items-start gap-3 rounded-2xl border border-red-400/20 bg-[#251215]/95 p-4 text-red-100 shadow-2xl shadow-black/40 backdrop-blur">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-300" />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold">Account connection failed</div>
            <p className="mt-1 text-[11px] leading-relaxed text-red-200/75">{error}</p>
            {browserFallback && (
              <button
                type="button"
                onClick={() => void signInWithBrowser()}
                className="mt-2.5 flex items-center gap-1.5 rounded-full border border-red-200/25 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-red-50 transition hover:bg-white/10"
              >
                <Globe2 className="size-3.5" />
                Use Chrome instead
              </button>
            )}
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
