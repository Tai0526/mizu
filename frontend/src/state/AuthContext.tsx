import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { store } from '../lib/store'
import type { Account } from '../types'

interface AuthValue {
  account: Account | null
  loading: boolean
  mode: 'local' | 'cloud'
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, displayName: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    store
      .currentAccount()
      .then((found) => {
        if (!cancelled) setAccount(found)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    setAccount(await store.signIn(email, password))
  }, [])

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    setAccount(await store.signUp(email, password, displayName))
  }, [])

  const signOut = useCallback(async () => {
    await store.signOut()
    setAccount(null)
  }, [])

  const value = useMemo<AuthValue>(
    () => ({ account, loading, mode: store.mode, signIn, signUp, signOut }),
    [account, loading, signIn, signUp, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
