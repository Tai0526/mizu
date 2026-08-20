import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { initials } from '../lib/graph'
import { hueFor } from '../lib/theme'
import type { Person } from '../types'

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(' ')

// ── Avatar ───────────────────────────────────────────────────────────────────

export function Avatar({
  person,
  size = 44,
  className,
}: {
  person: Person | undefined
  size?: number
  className?: string
}) {
  const name = person ? `${person.given_name}${person.family_name}` : '?'
  const hue = hueFor(name)

  if (person?.photo_url) {
    return (
      <img
        src={person.photo_url}
        alt=""
        width={size}
        height={size}
        className={cx('shrink-0 rounded-full object-cover ring-2 ring-surface', className)}
        style={{ width: size, height: size }}
      />
    )
  }

  return (
    <div
      className={cx(
        'shrink-0 rounded-full grid place-items-center font-semibold ring-2 ring-surface select-none',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        // Hue from the name, lightness from the theme (see index.css), so the
        // same person keeps their colour when the app flips to dark.
        background: `hsl(${hue} var(--avatar-sat) var(--avatar-bg-l))`,
        color: `hsl(${hue} var(--avatar-sat) var(--avatar-fg-l))`,
      }}
      aria-hidden
    >
      {initials(person)}
    </div>
  )
}

// ── Modal ────────────────────────────────────────────────────────────────────

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px] animate-fade"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'relative w-full card rounded-b-none sm:rounded-2xl max-h-[92vh] overflow-y-auto animate-slideUp',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
      >
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-line bg-surface/95 backdrop-blur px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-semibold leading-tight">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="btn-ghost btn-sm -mr-2 -mt-1" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

// ── Small pieces ─────────────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

export function Empty({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children?: ReactNode
}) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-leaf-soft text-leaf">
        {icon}
      </div>
      <h3 className="font-display text-xl font-semibold">{title}</h3>
      <div className="mt-2 text-sm text-muted">{children}</div>
    </div>
  )
}

export function Banner({
  tone = 'info',
  children,
  onDismiss,
}: {
  tone?: 'info' | 'error'
  children: ReactNode
  onDismiss?: () => void
}) {
  return (
    <div
      className={cx(
        'flex items-start gap-3 rounded-xl border px-4 py-3 text-sm',
        tone === 'error'
          ? 'border-danger/30 bg-danger/10 text-danger'
          : 'border-leaf/25 bg-leaf-soft text-leaf',
      )}
    >
      <div className="flex-1">{children}</div>
      {onDismiss && (
        <button onClick={onDismiss} className="shrink-0 opacity-60 hover:opacity-100" aria-label="Dismiss">
          <X size={16} />
        </button>
      )}
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-20 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-leaf" />
      {label ?? 'Loading…'}
    </div>
  )
}
