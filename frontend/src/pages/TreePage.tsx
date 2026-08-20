import { ChevronDown, Search, TreeDeciduous, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AddRelativeDialog } from '../components/AddRelativeDialog'
import { PersonPanel } from '../components/PersonPanel'
import { TreeCanvas } from '../components/TreeCanvas'
import { Avatar, Banner, Spinner, cx } from '../components/ui'
import { fullName, lifespan } from '../lib/graph'
import { kinship, type Kinship } from '../lib/kinship'
import { findRoot, layoutFamily, layoutTree, type RootRef } from '../lib/layout'
import { useTree } from '../state/TreeContext'
import type { Relation } from '../lib/ops'

export function TreePage() {
  const {
    data, graph, loading, error, dismissError,
    mePersonId, addRelative, updatePerson, removePerson, setMePerson,
  } = useTree()

  const [rootRef, setRootRef] = useState<RootRef | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addAnchor, setAddAnchor] = useState<string | null>(null)
  const [addPreset, setAddPreset] = useState<Relation | undefined>()
  const [focusRequest, setFocusRequest] = useState<{ personId: string; nonce: number } | null>(null)
  const [query, setQuery] = useState('')
  const [lineMenu, setLineMenu] = useState(false)
  const nonce = useRef(0)
  const location = useLocation()
  const navigate = useNavigate()

  // ── Which trunk are we looking at ──────────────────────────────────────────

  const lines = useMemo(() => {
    if (!graph) return []
    const out: { ref: RootRef; label: string; sort: string }[] = []
    const spokenFor = new Set<string>()

    for (const u of graph.unions) {
      if (u.partner_a || u.partner_b) continue
      const kids = graph.childrenOfUnion(u.id)
      if (!kids.length) continue
      out.push({
        ref: { kind: 'union', id: u.id },
        label: `The ${kids[0].family_name || 'unnamed'} line`,
        sort: kids[0].family_name,
      })
    }

    for (const p of graph.people) {
      if (graph.parentUnionOf(p.id)) continue
      if (!graph.childrenOf(p.id).length) continue
      if (spokenFor.has(p.id)) continue
      // A couple at the top of a line is one line, not two.
      graph.spousesOf(p.id).forEach((s) => spokenFor.add(s.id))
      out.push({ ref: { kind: 'person', id: p.id }, label: `${fullName(p)}'s line`, sort: p.family_name })
    }

    return out.sort((a, b) => a.sort.localeCompare(b.sort))
  }, [graph])

  // rootRef null means the default view. With "me" marked that is the
  // both-sides chart centred on you; without it, fall back to the tallest line.
  useEffect(() => {
    if (!graph || rootRef || mePersonId) return
    const anchor = graph.people[0]?.id
    if (!anchor) return
    setRootRef(findRoot(graph, anchor) ?? { kind: 'person', id: anchor })
  }, [graph, mePersonId, rootRef])

  // If the current trunk disappears (the person was removed), pick another.
  useEffect(() => {
    if (!graph || !rootRef) return
    const stillThere =
      rootRef.kind === 'person' ? Boolean(graph.person(rootRef.id)) : Boolean(graph.union(rootRef.id))
    if (!stillThere) setRootRef(null)
  }, [graph, rootRef])

  const layout = useMemo(() => {
    if (!graph) return null
    if (rootRef) return layoutTree(graph, rootRef)
    if (mePersonId && graph.person(mePersonId)) return layoutFamily(graph, mePersonId)
    return null
  }, [graph, rootRef, mePersonId])

  // Another page asked for somebody to be brought into view. Consume the
  // request so a later back-navigation does not silently jump the chart again.
  const pendingFocus = (location.state as { focus?: string } | null)?.focus ?? null
  useEffect(() => {
    if (!pendingFocus || !graph) return
    navigate('.', { replace: true, state: null })
    setSelectedId(pendingFocus)
    if (!graph.person(pendingFocus)) return
    const home = findRoot(graph, pendingFocus)
    if (home) setRootRef(home)
    nonce.current += 1
    setFocusRequest({ personId: pendingFocus, nonce: nonce.current })
  }, [pendingFocus, graph, navigate])

  const kin = useMemo(() => {
    const map = new Map<string, Kinship>()
    if (!graph || !mePersonId) return map
    for (const p of graph.people) map.set(p.id, kinship(graph, mePersonId, p.id))
    return map
  }, [graph, mePersonId])

  const results = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!graph || term.length < 2) return []
    return graph.people
      .filter((p) => fullName(p).toLowerCase().includes(term))
      .slice(0, 8)
  }, [graph, query])

  if (loading) return <Spinner label="Opening your tree…" />
  if (!data || !graph || !layout) return <Spinner label="Preparing the chart…" />

  const selected = selectedId ? graph.person(selectedId) : undefined
  const activeLine = lines.find(
    (l) => rootRef && l.ref.kind === rootRef.kind && l.ref.id === rootRef.id,
  )

  /** Bring someone into view, whether or not they are on this chart. */
  const goTo = (personId: string) => {
    setSelectedId(personId)
    if (!layout.index.has(personId)) {
      const aroundMe =
        mePersonId && graph.person(mePersonId) ? layoutFamily(graph, mePersonId) : null
      if (aroundMe?.index.has(personId)) setRootRef(null)
      else {
        const home = findRoot(graph, personId)
        if (home) setRootRef(home)
      }
    }
    nonce.current += 1
    setFocusRequest({ personId, nonce: nonce.current })
  }

  const openAdd = (anchorId: string, preset?: Relation) => {
    setAddAnchor(anchorId)
    setAddPreset(preset)
  }

  return (
    <div className="relative flex h-full min-h-0">
      <div className="relative min-w-0 flex-1">
        <TreeCanvas
          graph={graph}
          layout={layout}
          kin={kin}
          mePersonId={mePersonId}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id)}
          onQuickAdd={(id) => openAdd(id)}
          onGhostClick={(unionId) => {
            const firstChild = graph.childrenOfUnion(unionId)[0]
            if (firstChild) openAdd(firstChild.id, 'parent')
          }}
          focusRequest={focusRequest}
        />

        {/* Search and trunk picker, floating over the canvas. */}
        <div className="pointer-events-none absolute left-3 right-3 top-3 flex flex-col items-start gap-2 sm:right-auto sm:w-80">
          <div className="pointer-events-auto w-full">
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                className="field bg-surface/95 pl-9 pr-8 shadow-card backdrop-blur"
                placeholder="Find someone in this family"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
                  aria-label="Clear"
                >
                  <X size={15} />
                </button>
              )}
            </div>
            {results.length > 0 && (
              <div className="mt-1.5 overflow-hidden rounded-xl border border-line bg-surface shadow-lift">
                {results.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      goTo(p.id)
                      setQuery('')
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-leaf-soft"
                  >
                    <Avatar person={p} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{fullName(p)}</span>
                      <span className="block truncate text-[11px] text-muted">
                        {kin.get(p.id)?.short && kin.get(p.id)?.category !== 'unrelated'
                          ? kin.get(p.id)?.label
                          : lifespan(p) || 'No dates yet'}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {lines.length > 1 && (
            <div className="pointer-events-auto relative">
              <button
                onClick={() => setLineMenu((o) => !o)}
                onBlur={() => setTimeout(() => setLineMenu(false), 150)}
                className="flex items-center gap-1.5 rounded-full border border-line bg-surface/95 px-3 py-1.5 text-[12.5px] font-medium shadow-card backdrop-blur transition hover:border-leaf/50"
              >
                <TreeDeciduous size={13} className="text-leaf" />
                {rootRef ? (activeLine?.label ?? 'This branch') : 'Around you'}
                <ChevronDown size={13} className="text-muted" />
              </button>
              {lineMenu && (
                <div className="absolute left-0 top-full z-40 mt-1 max-h-72 w-64 overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-lift">
                  {mePersonId && (
                    <button
                      onMouseDown={() => {
                        setRootRef(null)
                        setLineMenu(false)
                      }}
                      className={cx(
                        'block w-full truncate px-3 py-2 text-left text-[13px] transition hover:bg-leaf-soft',
                        !rootRef && 'font-semibold text-leaf',
                      )}
                    >
                      Around you — both sides
                    </button>
                  )}
                  <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                    Follow one line
                  </p>
                  {lines.map((line) => (
                    <button
                      key={`${line.ref.kind}:${line.ref.id}`}
                      onMouseDown={() => {
                        setRootRef(line.ref)
                        setLineMenu(false)
                      }}
                      className={cx(
                        'block w-full truncate px-3 py-2 text-left text-[13px] transition hover:bg-leaf-soft',
                        activeLine === line && 'font-semibold text-leaf',
                      )}
                    >
                      {line.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="absolute bottom-4 left-3 right-3 max-sm:bottom-[4.5rem] sm:left-4 sm:right-auto sm:max-w-md">
            <Banner tone="error" onDismiss={dismissError}>{error}</Banner>
          </div>
        )}

        {!mePersonId && graph.people.length > 0 && (
          <div className="pointer-events-none absolute inset-x-3 bottom-4 max-sm:bottom-[4.5rem] sm:left-1/2 sm:right-auto sm:w-[26rem] sm:-translate-x-1/2">
            <div className="pointer-events-auto rounded-xl border border-leaf/30 bg-leaf-soft px-4 py-3 text-[13px] text-leaf shadow-card">
              Tap your own name in the tree, then <strong>This is me</strong> — every relationship
              on screen is worked out from where you stand.
            </div>
          </div>
        )}
      </div>

      {/* The panel is a column on a desktop and a full sheet on a phone. */}
      {selected && (
        <div className="fixed inset-0 z-40 bg-surface sm:static sm:z-auto sm:w-[360px] sm:shrink-0">
          <PersonPanel
            person={selected}
            graph={graph}
            mePersonId={mePersonId}
            onClose={() => setSelectedId(null)}
            onSelect={goTo}
            onAdd={(id) => openAdd(id)}
            onSave={updatePerson}
            onDelete={async (id) => {
              setSelectedId(null)
              await removePerson(id)
            }}
            onClaim={setMePerson}
          />
        </div>
      )}

      <AddRelativeDialog
        key={`${addAnchor ?? 'none'}:${addPreset ?? ''}`}
        open={Boolean(addAnchor)}
        anchorId={addAnchor}
        presetRelation={addPreset}
        graph={graph}
        onClose={() => {
          setAddAnchor(null)
          setAddPreset(undefined)
        }}
        onAdd={async (args) => {
          const person = await addRelative(args)
          if (person) goTo(person.id)
          return person
        }}
      />
    </div>
  )
}
