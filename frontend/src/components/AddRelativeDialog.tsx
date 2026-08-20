import { ArrowLeft, Baby, Heart, Search, Users, UserRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import { fullName, lifespan, type FamilyGraph } from '../lib/graph'
import { relationLabels, type Relation } from '../lib/ops'
import type { NewPersonInput } from '../lib/store/types'
import type { UnionStatus } from '../types'
import { PersonForm, draftFromPerson, emptyDraft, type PersonDraft } from './PersonForm'
import { Avatar, Field, Modal, cx } from './ui'

const RELATION_ICONS: Record<Relation, typeof Heart> = {
  parent: UserRound,
  spouse: Heart,
  child: Baby,
  sibling: Users,
}

export interface AddRelativeArgs {
  anchorId: string
  relation: Relation
  input?: NewPersonInput
  existingPersonId?: string
  unionId?: string
  unionStatus?: UnionStatus
  /** When both parent slots are taken: the existing parent this person shares. */
  keepParentId?: string
}

/**
 * Adding a relative is anchored on somebody who is already there — "Beatrice's
 * sister", not "a person, who I will wire up afterwards". That is how people
 * describe their families out loud, and it means the graph can never end up
 * with an orphan floating next to the tree.
 */
export function AddRelativeDialog({
  open,
  anchorId,
  graph,
  presetRelation,
  onClose,
  onAdd,
}: {
  open: boolean
  anchorId: string | null
  graph: FamilyGraph
  /** Skips the relationship picker — used by the "parents not known" card. */
  presetRelation?: Relation
  onClose: () => void
  onAdd: (args: AddRelativeArgs) => Promise<unknown>
}) {
  const anchor = graph.person(anchorId)
  const [relation, setRelation] = useState<Relation | null>(presetRelation ?? null)
  const [draft, setDraft] = useState<PersonDraft>(() =>
    emptyDraft(
      presetRelation === 'child' || presetRelation === 'sibling'
        ? (graph.person(anchorId)?.family_name ?? '')
        : '',
    ),
  )
  const [detailed, setDetailed] = useState(false)
  const [status, setStatus] = useState<UnionStatus>('married')
  const [unionId, setUnionId] = useState<string | undefined>()
  const [keepParentId, setKeepParentId] = useState<string | undefined>()
  const [linking, setLinking] = useState(false)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)

  const reset = () => {
    setRelation(presetRelation ?? null)
    setDraft(emptyDraft())
    setDetailed(false)
    setStatus('married')
    setUnionId(undefined)
    setKeepParentId(undefined)
    setLinking(false)
    setQuery('')
  }

  const close = () => {
    reset()
    onClose()
  }

  const anchorUnions = anchorId ? graph.unionsOf(anchorId) : []
  const anchorParents = anchorId ? graph.parentsOf(anchorId) : []
  const needsSharedParent = relation === 'parent' && anchorParents.length === 2

  // Surnames usually run down a line, so pre-filling saves most of the typing.
  const chooseRelation = (next: Relation) => {
    setRelation(next)
    const inherited =
      next === 'child' || next === 'sibling' ? (anchor?.family_name ?? '') : ''
    setDraft(emptyDraft(inherited))
    if (next === 'child' && anchorUnions.length === 1) setUnionId(anchorUnions[0].id)
  }

  const candidates = useMemo(() => {
    if (!linking || !anchorId) return []
    const term = query.trim().toLowerCase()
    const anchorTree = graph.person(anchorId)?.tree_id
    return graph.people
      .filter((p) => p.id !== anchorId)
      // A joined-in relative belongs to another family's tree; linking them
      // here would cross-write records. They stay view-only.
      .filter((p) => p.tree_id === anchorTree)
      .filter((p) => !term || fullName(p).toLowerCase().includes(term))
      .slice(0, 40)
  }, [linking, query, graph.people, anchorId])

  const submit = async (existingPersonId?: string) => {
    if (!anchorId || !relation) return
    if (!existingPersonId && !draft.given_name.trim() && !draft.family_name.trim()) return
    if (needsSharedParent && !keepParentId) return
    setSaving(true)
    try {
      await onAdd({
        anchorId,
        relation,
        existingPersonId,
        input: existingPersonId ? undefined : { ...draft },
        unionId: relation === 'child' ? unionId : undefined,
        unionStatus: relation === 'spouse' ? status : undefined,
        keepParentId: needsSharedParent ? keepParentId : undefined,
      })
      close()
    } finally {
      setSaving(false)
    }
  }

  if (!anchor) return null

  return (
    <Modal
      open={open}
      onClose={close}
      title={relation ? `${relationLabels[relation].title} of ${anchor.given_name}` : `Add to ${anchor.given_name}'s family`}
      subtitle={relation ? undefined : 'Who are you adding?'}
    >
      {!relation ? (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {(Object.keys(relationLabels) as Relation[]).map((option) => {
            const Icon = RELATION_ICONS[option]
            return (
              <button
                key={option}
                onClick={() => chooseRelation(option)}
                className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3.5 text-left transition hover:-translate-y-0.5 hover:border-leaf/50 hover:shadow-card"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-leaf-soft text-leaf">
                  <Icon size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{relationLabels[option].title}</span>
                  <span className="block truncate text-xs text-muted">{relationLabels[option].hint}</span>
                </span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="space-y-4">
          <button
            onClick={() => setRelation(null)}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink"
          >
            <ArrowLeft size={14} /> Choose a different relationship
          </button>

          {relation === 'child' && anchorUnions.length > 1 && (
            <Field label="Which marriage?" hint="So the child sits with the right brothers and sisters.">
              <select className="field" value={unionId ?? ''} onChange={(e) => setUnionId(e.target.value)}>
                <option value="">A different partner, or not recorded</option>
                {anchorUnions.map((u) => {
                  const other = graph.person(u.partner_a === anchorId ? u.partner_b : u.partner_a)
                  return (
                    <option key={u.id} value={u.id}>
                      {other ? `With ${fullName(other)}` : 'Other parent not recorded'}
                      {u.year ? ` (${u.year})` : ''}
                    </option>
                  )
                })}
              </select>
            </Field>
          )}

          {needsSharedParent && (
            <div className="rounded-xl border border-bloom/30 bg-bloom/10 px-4 py-3.5">
              <p className="text-[13.5px] font-semibold">
                {anchor.given_name} already has two parents here.
              </p>
              <p className="mt-1 text-[12.5px] leading-snug text-muted">
                In families where a parent married more than once, brothers and sisters do not
                all share the same mother or father. Pick the parent {anchor.given_name} shares —
                the person you are adding becomes their other parent, and nobody else moves.
              </p>
              <div className="mt-3 space-y-1.5">
                {anchorParents.map((p) => (
                  <label
                    key={p.id}
                    className={cx(
                      'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition',
                      keepParentId === p.id
                        ? 'border-leaf bg-leaf-soft'
                        : 'border-line bg-surface hover:border-leaf/40',
                    )}
                  >
                    <input
                      type="radio"
                      name="shared-parent"
                      className="accent-[rgb(var(--c-leaf))]"
                      checked={keepParentId === p.id}
                      onChange={() => {
                        setKeepParentId(p.id)
                        // The new person is almost certainly the other sex of
                        // the parent being kept; prefill, still editable.
                        if (p.sex === 'male' && draft.sex === 'unknown') setDraft({ ...draft, sex: 'female' })
                        if (p.sex === 'female' && draft.sex === 'unknown') setDraft({ ...draft, sex: 'male' })
                      }}
                    />
                    <Avatar person={p} size={28} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                      {fullName(p)} stays {anchor.given_name}&rsquo;s {p.sex === 'male' ? 'father' : p.sex === 'female' ? 'mother' : 'parent'}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {relation === 'spouse' && (
            <Field label="Relationship">
              <select
                className="field"
                value={status}
                onChange={(e) => setStatus(e.target.value as UnionStatus)}
              >
                <option value="married">Married</option>
                <option value="partners">Partners</option>
                <option value="engaged">Engaged</option>
                <option value="separated">Separated</option>
                <option value="divorced">Divorced</option>
                <option value="widowed">Widowed</option>
              </select>
            </Field>
          )}

          {linking ? (
            <div className="space-y-3">
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  autoFocus
                  className="field pl-9"
                  placeholder="Search people already in this tree"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="max-h-72 space-y-1.5 overflow-y-auto">
                {candidates.map((p) => (
                  <button
                    key={p.id}
                    disabled={saving}
                    onClick={() => void submit(p.id)}
                    className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface p-2.5 text-left transition hover:border-leaf/50"
                  >
                    <Avatar person={p} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{fullName(p)}</span>
                      <span className="block text-xs text-muted">{lifespan(p) || 'No dates yet'}</span>
                    </span>
                  </button>
                ))}
                {!candidates.length && (
                  <p className="py-6 text-center text-sm text-muted">Nobody by that name yet.</p>
                )}
              </div>
              <button onClick={() => setLinking(false)} className="text-[13px] font-semibold text-leaf hover:underline">
                Add someone new instead
              </button>
            </div>
          ) : (
            <>
              <PersonForm
                draft={draft}
                onChange={setDraft}
                detailed={detailed}
                onToggleDetail={() => setDetailed((d) => !d)}
              />
              <button
                onClick={() => setLinking(true)}
                className="text-[13px] font-semibold text-leaf hover:underline"
              >
                They are already in this tree — link them instead
              </button>
              <div className="flex justify-end gap-2 border-t border-line pt-4">
                <button onClick={close} className="btn-ghost">Cancel</button>
                <button
                  onClick={() => void submit()}
                  disabled={
                    saving ||
                    (!draft.given_name.trim() && !draft.family_name.trim()) ||
                    (needsSharedParent && !keepParentId)
                  }
                  className={cx('btn-primary', saving && 'opacity-70')}
                >
                  {saving ? 'Adding…' : `Add ${draft.given_name.trim() || 'them'}`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}

export { draftFromPerson }
