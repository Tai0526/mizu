// ─────────────────────────────────────────────────────────────────────────────
// New versions arrive on their own.
//
// A tab left open on a phone keeps running whatever code it loaded, which is
// how a bug that was fixed an hour ago keeps happening to the one relative who
// never closes anything. The built page is fingerprinted, so comparing the
// script the server WOULD serve with the script this tab IS running tells us a
// new version shipped.
//
// The reload happens only at safe moments: the instant the user returns to the
// tab (they have not started doing anything yet) or while it sits hidden in the
// background. It never fires mid-interaction.
// ─────────────────────────────────────────────────────────────────────────────

const CHECK_EVERY_MS = 3 * 60 * 1000

function currentScript(): string | null {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')
  const m = el?.src.match(/assets\/index-[^"]+\.js/)
  return m ? m[0] : null
}

async function servedScript(): Promise<string | null> {
  try {
    const res = await fetch('/', { cache: 'no-store' })
    if (!res.ok) return null
    const html = await res.text()
    return html.match(/assets\/index-[^"]+\.js/)?.[0] ?? null
  } catch {
    return null // offline or flaky signal — never bother the user over it
  }
}

export function watchForNewVersions(): void {
  const running = currentScript()
  if (!running) return // dev server — Vite handles its own reloading

  let stale = false

  const check = async () => {
    if (stale) return
    const served = await servedScript()
    if (served && served !== running) {
      stale = true
      // Hidden tab: swap now, invisibly. Visible tab: swap the moment it hides,
      // so nobody loses half-typed input to a surprise reload.
      if (document.visibilityState === 'hidden') location.reload()
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (stale) location.reload()
      else void check()
    } else {
      // Coming back to the app is the other safe moment: nothing is in
      // progress yet, so a stale tab can refresh before it misbehaves.
      void check().then(() => {
        if (stale) location.reload()
      })
    }
  })
  window.addEventListener('focus', () => {
    void check().then(() => {
      if (stale) location.reload()
    })
  })
  setInterval(() => void check(), CHECK_EVERY_MS)
}
