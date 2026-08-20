import { Check, MapPin, Pencil, Trash2, UserPlus, X } from 'lucide-react'
import { useState } from 'react'
import { fullName, lifespan, type FamilyGraph } from '../lib/graph'
import { kinship, possessive } from '../lib/kinship'
import type { Person } from '../types'
import { PersonForm, draftFromPerson, type PersonDraft } from './PersonForm'
import { Avatar, Modal, cx } from './ui'

/**
 * Everything known about one person, and — the part that matters — how they
 * connect to you, spelled out rather than left for you to trace with a finger.
 */
export function PersonPanel({
  person,
  graph,
  mePersonId,
  onClose,
  onSelect,
  onAdd,
  onSave,
  onDelete,
  onClaim,
}: {
  person: Person
  graph: FamilyGraph
  mePersonId: string | null
  onClose: () => void
  onSelect: (personId: string) => void
  onAdd: (personId: string) => void
  onSave: (person: Person) => Promise<void>
  onDelete: (personId: string) => Promise<void>
  onClaim: (personId: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<PersonDraft>(() => draftFromPerson(person))
  const [detailed, setDetailed] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [saving, setSaving] = useState(false)

  const isMe = person.id === mePersonId
  const kin = mePersonId ? kinship(graph, mePersonId, person.id) : null

  const parents = graph.parentsOf(person.id)
  const siblings = graph.siblingsOf(person.id)
  const spouses = graph.spousesOf(person.id)
  const children = graph.childrenOf(person.id)

  const beginEdit = () => {
    setDraft(draftFromPerson(person))
    setDetailed(Boolean(person.other_names || person.birth_place || person.notes))
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      await onSave({
        ...person,
        given_name: draft.given_name.trim(),
        family_name: draft.family_name.trim(),
        other_names: draft.other_names?.trim() ?? '',
        sex: draft.sex,
        birth_year: draft.birth_year ?? null,
        birth_place: draft.birth_place?.trim() ?? '',
        death_year: draft.living ? null : (draft.death_year ?? null),
        living: draft.living,
        notes: draft.notes?.trim() ?? '',
        photo_url: draft.photo_url ?? null,
      })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <aside className="flex h-full w-full flex-col border-line bg-surface sm:w-[360px] sm:border-l">
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <Avatar person={person} size={56} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-lg font-semibold leading-tight">
              {fullName(person)}
            </h2>
            {person.other_names && (
              <p className="truncate text-[13px] text-muted">{person.other_names}</p>
            )}
            <p className="mt-1 text-[13px] tabular-nums text-muted">
              {!person.living && '† '}
              {lifespan(person) || 'Dates unknown'}
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost btn-sm -mr-2 -mt-1" aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* The headline. */}
          <div className="rounded-xl border border-leaf/25 bg-leaf-soft px-4 py-3">
            {isMe ? (
              <p className="text-sm font-semibold text-leaf">This is you.</p>
            ) : kin && kin.category !== 'unrelated' ? (
              <>
                <p className="text-sm font-semibold text-leaf">
                  {person.given_name} is {possessive(kin)}.
                </p>
                {kin.explanation && (
                  <p className="mt-1 text-[13px] leading-snug text-leaf/85">{kin.explanation}</p>
                )}
              </>
            ) : mePersonId ? (
              <p className="text-sm text-leaf">
                No path between you two yet — a missing parent somewhere in between.
              </p>
            ) : (
              <p className="text-sm text-leaf">
                Mark yourself in the tree to see how everyone relates to you.
              </p>
            )}
          </div>

          {person.birth_place && (
            <p className="mt-4 flex items-center gap-1.5 text-[13px] text-muted">
              <MapPin size={13} /> {person.birth_place}
            </p>
          )}

          {person.notes && (
            <p className="mt-3 whitespace-pre-wrap rounded-xl bg-canvas/70 px-3.5 py-3 text-[13.5px] leading-relaxed">
              {person.notes}
            </p>
          )}

          <Relations title="Parents" people={parents} graph={graph} onSelect={onSelect} />
          <Relations
            title="Brothers and sisters"
            people={siblings.map((s) => s.person)}
            suffixes={siblings.map((s) => (s.half ? 'half' : ''))}
            graph={graph}
            onSelect={onSelect}
          />
          <Relations title="Partners" people={spouses} graph={graph} onSelect={onSelect} />
          <Relations title="Children" people={children} graph={graph} onSelect={onSelect} />

          <div className="mt-6 space-y-2">
            <button onClick={() => onAdd(person.id)} className="btn-primary w-full">
              <UserPlus size={15} /> Add a relative of {person.given_name || 'them'}
            </button>
            <div className="flex gap-2">
              <button onClick={beginEdit} className="btn-outline flex-1">
                <Pencil size={14} /> Edit
              </button>
              <button
                onClick={() => setConfirmingDelete(true)}
                className="btn-outline px-3 text-danger hover:border-danger/50 hover:bg-danger/10"
                aria-label={`Remove ${fullName(person)}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
            {!isMe && (
              <button onClick={() => void onClaim(person.id)} className="btn-ghost w-full text-[13px]">
                <Check size={14} /> This is me
              </button>
            )}
          </div>
        </div>
      </aside>

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title={`Edit ${person.given_name || 'person'}`}
      >
        <PersonForm
          draft={draft}
          onChange={setDraft}
          detailed={detailed}
          onToggleDetail={() => setDetailed((d) => !d)}
        />
        <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
          <button onClick={() => setEditing(false)} className="btn-ghost">Cancel</button>
          <button onClick={() => void save()} disabled={saving} className={cx('btn-primary', saving && 'opacity-70')}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </Modal>

      <Modal
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title={`Remove ${fullName(person)}?`}
      >
        <p className="text-sm leading-relaxed text-muted">
          They will be taken out of this tree along with the lines that connect them. Anyone below
          them keeps their remaining parent and stays where they are.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setConfirmingDelete(false)} className="btn-ghost">Keep them</button>
          <button
            onClick={() => {
              setConfirmingDelete(false)
              void onDelete(person.id)
            }}
            className="btn-danger"
          >
            <Trash2 size={14} /> Remove
          </button>
        </div>
      </Modal>
    </>
  )
}

function Relations({
  title,
  people,
  suffixes,
  graph,
  onSelect,
}: {
  title: string
  people: Person[]
  suffixes?: string[]
  graph: FamilyGraph
  onSelect: (personId: string) => void
}) {
  if (!people.length) return null
  return (
    <section className="mt-5">
      <h3 className="label mb-2">{title}</h3>
      <div className="space-y-1">
        {people.map((p, i) => (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-leaf-soft"
          >
            <Avatar person={graph.person(p.id)} size={30} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium">{fullName(p)}</span>
              <span className="block truncate text-[11.5px] text-muted">
                {suffixes?.[i] ? `${suffixes[i]} · ` : ''}
                {lifespan(p) || 'No dates'}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
