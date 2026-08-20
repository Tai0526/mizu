import { Maximize2, Minus, Plus, Crosshair, UserPlus, Link2 } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fullName, lifespan, type FamilyGraph } from '../lib/graph'
import { sentenceCase, type Kinship } from '../lib/kinship'
import { CARD_H, CARD_W, ROW_H, branchWidth, edgePath, type Layout } from '../lib/layout'
import type { Person } from '../types'
import { Avatar, cx } from './ui'

// ─────────────────────────────────────────────────────────────────────────────
// The chart itself: a transformed plane you can throw around with a finger.
//
// Connectors are one SVG underneath; the people are real DOM cards on top. That
// split matters — text inside SVG is a nuisance to style and blurry when scaled,
// while cards as HTML get proper focus rings, hover, and photos for free.
//
// Panning and zooming are done by hand rather than with a library because the
// tree needs two behaviours a generic viewer will not give you: fit-on-open, so
// nobody lands on a blank patch of canvas, and centre-on-a-person, which is what
// every search result and every match link ultimately wants to do.
// ─────────────────────────────────────────────────────────────────────────────

const MIN_SCALE = 0.18
const MAX_SCALE = 2.2
/** Below this, cards are shapes rather than names — not worth opening on. */
const LEGIBLE_SCALE = 0.42

/** Breathing room around a fitted chart, scaled down on small screens where a
 *  fixed 120px margin would eat a third of the viewport. */
const paddingFor = (w: number, h: number) => Math.min(120, Math.min(w, h) * 0.16)

interface Transform {
  x: number
  y: number
  k: number
}

interface Props {
  graph: FamilyGraph
  layout: Layout
  kin: Map<string, Kinship>
  mePersonId: string | null
  selectedId: string | null
  onSelect: (personId: string) => void
  onQuickAdd: (personId: string) => void
  onGhostClick: (unionId: string) => void
  /** Bumped by the page to recentre on someone (search, match, "find me"). */
  focusRequest: { personId: string; nonce: number } | null
}

export function TreeCanvas({
  graph,
  layout,
  kin,
  mePersonId,
  selectedId,
  onSelect,
  onQuickAdd,
  onGhostClick,
  focusRequest,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: 1 })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ distance: number; k: number } | null>(null)
  const panning = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const hasFitted = useRef(false)

  // ── Fitting and focusing ───────────────────────────────────────────────────

  const fit = useCallback(() => {
    const el = viewportRef.current
    if (!el || !layout.width || !layout.height) return
    const { clientWidth: w, clientHeight: h } = el
    const pad = paddingFor(w, h)
    const k = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, Math.min((w - pad) / layout.width, (h - pad) / layout.height)),
    )
    setTransform({
      x: (w - layout.width * k) / 2,
      y: Math.max(48, (h - layout.height * k) / 2),
      k,
    })
  }, [layout.width, layout.height])

  const centreOn = useCallback(
    (personId: string, scale?: number) => {
      const el = viewportRef.current
      const card = layout.index.get(personId)
      if (!el || !card) return
      setTransform((current) => {
        const k = scale ?? Math.max(current.k, 0.72)
        return {
          k,
          x: el.clientWidth / 2 - (card.x + CARD_W / 2) * k,
          y: el.clientHeight / 2 - (card.y + CARD_H / 2) * k,
        }
      })
    },
    [layout.index],
  )

  // Open the chart once, and pick the opening shot deliberately.
  //
  // Fitting a four-generation family into a phone screen lands somewhere around
  // 18%, where every card is an illegible smudge — technically the whole tree,
  // practically useless. So when the fit would be that small we start centred on
  // you at a readable size instead, and leave "fit" as a button. Re-running this
  // on every layout change would also yank the view back mid-edit, so it fires
  // once.
  useLayoutEffect(() => {
    if (hasFitted.current || !layout.width) return
    const el = viewportRef.current
    if (!el) return
    hasFitted.current = true

    const pad = paddingFor(el.clientWidth, el.clientHeight)
    const fitScale = Math.min(
      (el.clientWidth - pad) / layout.width,
      (el.clientHeight - pad) / layout.height,
    )
    const anchor = mePersonId && layout.index.has(mePersonId) ? mePersonId : null

    if (fitScale < LEGIBLE_SCALE && anchor) centreOn(anchor, 0.8)
    else fit()
  }, [layout.width, layout.height, layout.index, mePersonId, fit, centreOn])

  useEffect(() => {
    if (focusRequest) centreOn(focusRequest.personId)
  }, [focusRequest, centreOn])

  // ── Pointer handling ───────────────────────────────────────────────────────

  const zoomAt = useCallback((factor: number, cx0: number, cy0: number) => {
    setTransform((t) => {
      const k = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.k * factor))
      const ratio = k / t.k
      // Keep whatever is under the cursor exactly where it is.
      return { k, x: cx0 - (cx0 - t.x) * ratio, y: cy0 - (cy0 - t.y) * ratio }
    })
  }, [])

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const el = viewportRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        // Pinch-zoom on a trackpad arrives as ctrl+wheel.
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top)
      } else {
        setTransform((t) => ({ ...t, x: t.x - e.deltaX, y: t.y - e.deltaY }))
      }
    },
    [zoomAt],
  )

  const onPointerDown = (e: React.PointerEvent) => {
    // Only the background pans; a press on a card is a press on a card.
    if ((e.target as HTMLElement).closest('[data-card]')) return
    // Capture keeps the drag alive when a fast finger leaves the element, but
    // a refused capture must not kill panning — track the pointer regardless.
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* some pointer streams refuse capture; the move/up handlers still fire */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size === 1) {
      panning.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y }
      setDragging(true)
    } else if (pointers.current.size === 2) {
      panning.current = null
      setDragging(false)
      const [a, b] = [...pointers.current.values()]
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), k: transform.k }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pinch.current && pointers.current.size === 2) {
      const el = viewportRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const [a, b] = [...pointers.current.values()]
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      const target = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, pinch.current.k * (distance / pinch.current.distance)),
      )
      const midX = (a.x + b.x) / 2 - rect.left
      const midY = (a.y + b.y) / 2 - rect.top
      setTransform((t) => {
        const ratio = target / t.k
        return { k: target, x: midX - (midX - t.x) * ratio, y: midY - (midY - t.y) * ratio }
      })
      return
    }

    const pan = panning.current
    if (!pan) return
    setTransform((t) => ({ ...t, x: pan.tx + (e.clientX - pan.x), y: pan.ty + (e.clientY - pan.y) }))
  }

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 0) {
      panning.current = null
      setDragging(false)
    }
  }

  const zoomButton = (factor: number) => () => {
    const el = viewportRef.current
    if (!el) return
    zoomAt(factor, el.clientWidth / 2, el.clientHeight / 2)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div
        ref={viewportRef}
        className={cx('h-full w-full touch-none', dragging ? 'cursor-grabbing' : 'cursor-grab')}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      >
        <div
          className="origin-top-left will-change-transform"
          style={{
            transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.k})`,
            width: layout.width,
            height: layout.height,
          }}
        >
          <svg
            width={layout.width}
            height={layout.height}
            className="pointer-events-none absolute inset-0 overflow-visible"
            aria-hidden
          >
            {/* Branches first, thickest (oldest) at the back, so where they
                cross, the young twigs read as growing out of the old boughs. */}
            {layout.edges.map((edge) => {
              const totalRows = Math.max(1, Math.round(layout.height / ROW_H) + 1)
              return (
                <path
                  key={edge.key}
                  d={edgePath(edge)}
                  pathLength={1}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={branchWidth(edge, totalRows)}
                  className={cx(
                    'branch-grow',
                    edge.kind === 'marriage' ? 'stroke-bloom/60' : 'stroke-bark/70',
                  )}
                />
              )
            })}
          </svg>

          {layout.cards.map((card) => {
            if (card.ghost) {
              return (
                <GhostCard
                  key={card.key}
                  x={card.x}
                  y={card.y}
                  onClick={() => card.ghostUnionId && onGhostClick(card.ghostUnionId)}
                />
              )
            }
            const person = graph.person(card.personId)
            if (!person) return null
            return (
              <PersonNode
                key={card.key}
                x={card.x}
                y={card.y}
                person={person}
                kin={kin.get(person.id)}
                isMe={person.id === mePersonId}
                selected={person.id === selectedId}
                duplicate={card.duplicate}
                onClick={() => onSelect(person.id)}
                onAdd={() => onQuickAdd(person.id)}
              />
            )
          })}
        </div>
      </div>

      {/* Controls */}
      <div className="pointer-events-none absolute bottom-4 right-4 flex flex-col items-end gap-2">
        <div className="pointer-events-auto flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <button onClick={zoomButton(1.25)} className="btn-ghost rounded-none px-2.5 py-2 [@media(pointer:coarse)]:px-3.5 [@media(pointer:coarse)]:py-3" aria-label="Zoom in">
            <Plus size={16} />
          </button>
          <button onClick={zoomButton(0.8)} className="btn-ghost rounded-none border-t border-line px-2.5 py-2 [@media(pointer:coarse)]:px-3.5 [@media(pointer:coarse)]:py-3" aria-label="Zoom out">
            <Minus size={16} />
          </button>
          <button onClick={fit} className="btn-ghost rounded-none border-t border-line px-2.5 py-2 [@media(pointer:coarse)]:px-3.5 [@media(pointer:coarse)]:py-3" aria-label="Fit the whole tree">
            <Maximize2 size={16} />
          </button>
          {mePersonId && (
            <button
              onClick={() => centreOn(mePersonId, 0.9)}
              className="btn-ghost rounded-none border-t border-line px-2.5 py-2 [@media(pointer:coarse)]:px-3.5 [@media(pointer:coarse)]:py-3 text-leaf"
              aria-label="Find me"
            >
              <Crosshair size={16} />
            </button>
          )}
        </div>
        <span className="pointer-events-none rounded-full bg-surface/85 px-2 py-0.5 text-[11px] tabular-nums text-muted shadow-card">
          {Math.round(transform.k * 100)}%
        </span>
      </div>
    </div>
  )
}

// ── Cards ────────────────────────────────────────────────────────────────────

function PersonNode({
  x,
  y,
  person,
  kin,
  isMe,
  selected,
  duplicate,
  onClick,
  onAdd,
}: {
  x: number
  y: number
  person: Person
  kin: Kinship | undefined
  isMe: boolean
  selected: boolean
  duplicate: boolean
  onClick: () => void
  onAdd: () => void
}) {
  const years = lifespan(person)
  const gone = !person.living

  return (
    <div
      data-card
      className="group absolute animate-sprout"
      style={{ left: x, top: y, width: CARD_W, height: CARD_H }}
    >
      <button
        onClick={onClick}
        className={cx(
          'h-full w-full rounded-2xl border bg-surface px-3 py-2.5 text-left shadow-card transition-all',
          'hover:-translate-y-0.5 hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf',
          selected ? 'border-leaf ring-2 ring-leaf/35' : 'border-line',
          isMe && !selected && 'border-leaf/60',
          gone && 'bg-surface/70',
        )}
      >
        <div className="flex items-center gap-2.5">
          <Avatar person={person} size={38} className={cx(gone && 'opacity-80 saturate-50')} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold leading-tight">
              {person.given_name || 'Unnamed'}
            </div>
            <div className="truncate text-[12px] leading-tight text-muted">{person.family_name}</div>
          </div>
        </div>

        <div className="mt-1.5 flex items-center gap-1.5">
          {years && (
            <span className="truncate text-[11px] tabular-nums text-muted">
              {gone && '† '}
              {years}
            </span>
          )}
          {duplicate && (
            <span className="ml-auto text-muted" title="Also appears elsewhere in this chart">
              <Link2 size={11} />
            </span>
          )}
        </div>

        {isMe ? (
          <div className="mt-1 truncate rounded-md bg-leaf px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-white">
            You
          </div>
        ) : kin && kin.category !== 'unrelated' ? (
          <div className="mt-1 truncate text-[11px] font-medium text-leaf">{sentenceCase(kin.short)}</div>
        ) : (
          <div className="mt-1 h-[15px]" />
        )}
      </button>

      {/* Appears on hover, so the tree stays calm until you reach for it. */}
      <button
        onClick={onAdd}
        aria-label={`Add a relative of ${fullName(person)}`}
        className="absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full border border-line bg-surface text-leaf opacity-0 shadow-card transition
                   hover:brightness-105 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf
                   group-hover:opacity-100 sm:opacity-0 [@media(hover:none)]:opacity-100
                   [@media(pointer:coarse)]:-right-3 [@media(pointer:coarse)]:-top-3 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
      >
        <UserPlus size={13} className="[@media(pointer:coarse)]:hidden" />
        <UserPlus size={17} className="hidden [@media(pointer:coarse)]:block" />
      </button>
    </div>
  )
}

function GhostCard({ x, y, onClick }: { x: number; y: number; onClick: () => void }) {
  return (
    <div data-card className="absolute" style={{ left: x, top: y, width: CARD_W, height: CARD_H }}>
      <button
        onClick={onClick}
        className="h-full w-full rounded-2xl border-2 border-dashed border-line px-3 py-3 text-left text-muted
                   transition hover:border-leaf/60 hover:text-leaf focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf"
      >
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-full border-2 border-dashed border-current opacity-60">
            <UserPlus size={15} />
          </div>
          <div className="text-[12.5px] font-semibold leading-tight">Parents not known</div>
        </div>
        <p className="mt-1.5 text-[11px] leading-snug opacity-80">
          Tap to name them, if anyone remembers.
        </p>
      </button>
    </div>
  )
}
