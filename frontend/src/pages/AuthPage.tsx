import { Loader2, TreeDeciduous } from 'lucide-react'
import { useState } from 'react'
import { Banner, Field } from '../components/ui'
import { useAuth } from '../state/AuthContext'

export function AuthPage() {
  const { signIn, signUp, mode } = useAuth()
  const [isNew, setIsNew] = useState(true)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      if (isNew) await signUp(email, password, name)
      else await signIn(email, password)
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      {/* The pitch. On a phone the form comes first — someone opening a link
          their cousin sent wants to join, not to scroll through an argument —
          and the story sits underneath for anyone still deciding. */}
      <section className="order-2 border-t border-line lg:order-1 lg:border-t-0 relative flex flex-col justify-center overflow-hidden px-6 py-14 sm:px-12 lg:px-16">
        <div className="relative max-w-md">
          <div className="flex items-center gap-2 text-leaf">
            <TreeDeciduous size={26} />
            <span className="font-display text-2xl font-bold tracking-tight">Mizu</span>
          </div>

          <h1 className="mt-8 font-display text-[2.1rem] font-bold leading-[1.15] sm:text-5xl">
            Every family loses touch<br />one generation at a time.
          </h1>

          <p className="mt-5 text-[15px] leading-relaxed text-muted">
            Your grandmother knew all five of her brothers and sisters, and every one of their
            children. Two generations on, most of us can name a handful of cousins and guess at the
            rest. Mizu is where a family writes it down together — one person adds their branch,
            another adds theirs, and where the two overlap, the tree joins itself up.
          </p>

          <ul className="mt-8 space-y-3 text-[14px]">
            {[
              ['Start anywhere', 'Put yourself in, add a parent, and keep going. No forms, no dates required.'],
              ['See how you are related', 'Not just names in boxes — "your grandmother’s brother’s granddaughter, your second cousin".'],
              ['Faces, not just names', 'Attach a photo to anyone. That is what makes people recognise each other at the funeral.'],
              ['Find the relatives you never met', 'When someone else records the same grandmother, Mizu spots it and asks you both.'],
            ].map(([title, body]) => (
              <li key={title} className="flex gap-3">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-leaf" />
                <span>
                  <strong className="font-semibold">{title}.</strong>{' '}
                  <span className="text-muted">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* The form. */}
      <section className="order-1 lg:order-2 flex items-center justify-center bg-surface px-6 py-14 lg:border-l lg:border-line">
        <form onSubmit={submit} className="w-full max-w-sm">
          <h2 className="font-display text-2xl font-semibold">
            {isNew ? 'Start your tree' : 'Welcome back'}
          </h2>
          <p className="mt-1.5 text-sm text-muted">
            {isNew ? 'It takes about a minute to get your first three generations down.' : 'Sign in to pick up where you left off.'}
          </p>

          <div className="mt-6 space-y-3.5">
            {isNew && (
              <Field label="Your name">
                <input
                  className="field"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Natasha Tembo"
                  autoComplete="name"
                  required
                />
              </Field>
            )}
            <Field label="Email">
              <input
                type="email"
                className="field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                className="field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete={isNew ? 'new-password' : 'current-password'}
                minLength={8}
                required
              />
            </Field>
          </div>

          {problem && (
            <div className="mt-4">
              <Banner tone="error">{problem}</Banner>
            </div>
          )}

          <button type="submit" disabled={busy} className="btn-primary mt-5 w-full">
            {busy && <Loader2 size={15} className="animate-spin" />}
            {isNew ? 'Create my account' : 'Sign in'}
          </button>

          <button
            type="button"
            onClick={() => {
              setIsNew((v) => !v)
              setProblem(null)
            }}
            className="mt-4 w-full text-center text-[13px] text-muted hover:text-ink"
          >
            {isNew ? 'I already have an account' : 'I need to create an account'}
          </button>

          {mode === 'local' && (
            <p className="mt-6 rounded-xl border border-line bg-canvas/70 px-3.5 py-3 text-[12px] leading-relaxed text-muted">
              <strong className="font-semibold text-ink">Running on this device only.</strong> No
              Supabase project is connected yet, so your account and your family stay in this
              browser and nothing is sent anywhere. Everything works — including matching between
              trees — but only for trees created here.
            </p>
          )}
        </form>
      </section>
    </div>
  )
}
