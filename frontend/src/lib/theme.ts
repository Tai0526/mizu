import { useCallback, useEffect, useState } from 'react'

type Theme = 'light' | 'dark'
const KEY = 'mizu.theme'

const preferred = (): Theme => {
  const saved = localStorage.getItem(KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Dark mode is a class on <html>; every colour in the app resolves through a
 *  CSS variable, so flipping it re-themes the whole thing in one step. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(preferred)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem(KEY, theme)
  }, [theme])

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])
  return { theme, toggle }
}

/** A stable, pleasant colour per person, so faceless cards are still telling
 *  apart at a glance. Derived from the name, never random. */
export function hueFor(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 360
  return hash
}
