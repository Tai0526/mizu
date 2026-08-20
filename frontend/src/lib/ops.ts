import type { ChildLink, Person, TreeData, Union, UnionStatus } from '../types'
import { buildGraph } from './graph'
import { newId, nowIso } from './id'
import type { NewPersonInput } from './store/types'

// ─────────────────────────────────────────────────────────────────────────────
// The four things anyone ever wants to do to a family tree: add a parent, a
// partner, a child, or a sibling.
//
// Each returns a plain list of records to write, and never touches storage
// itself. Keeping it pure means the same code seeds the example family, applies
// an optimistic update in the UI, and can be reasoned about without a database.
//
// The invariants these protect:
//   · a person belongs to exactly one birth union
//   · siblings are siblings because they share that union, even when nobody
//     knows the parents' names yet
//   · adding a second parent fills the empty slot rather than creating a rival
//     union, which would quietly split a sibling group in two
// ─────────────────────────────────────────────────────────────────────────────

export type Relation = 'parent' | 'spouse' | 'child' | 'sibling'

export interface Writes {
  people: Person[]
  unions: Union[]
  children: ChildLink[]
  /** Unions changed in place (a partner slot filled), rather than created. */
  updatedUnions: Union[]
}

const emptyWrites = (): Writes => ({ people: [], unions: [], children: [], updatedUnions: [] })

export function makePerson(treeId: string, input: NewPersonInput, createdBy: string): Person {
  return {
    id: newId('per'),
    tree_id: treeId,
    given_name: input.given_name.trim(),
    family_name: input.family_name.trim(),
    other_names: input.other_names?.trim() ?? '',
    sex: input.sex ?? 'unknown',
    birth_year: input.birth_year ?? null,
    birth_place: input.birth_place?.trim() ?? '',
    death_year: input.death_year ?? null,
    living: input.living ?? input.death_year == null,
    photo_url: input.photo_url ?? null,
    notes: input.notes?.trim() ?? '',
    claimed_by: null,
    created_by: createdBy,
    created_at: nowIso(),
    updated_at: nowIso(),
  }
}

const makeUnion = (
  treeId: string,
  partnerA: string | null,
  partnerB: string | null,
  status: UnionStatus = 'married',
): Union => ({
  id: newId('uni'),
  tree_id: treeId,
  partner_a: partnerA,
  partner_b: partnerB,
  status,
  year: null,
  created_at: nowIso(),
})

const makeChildLink = (treeId: string, unionId: string, personId: string): ChildLink => ({
  id: newId('cld'),
  tree_id: treeId,
  union_id: unionId,
  person_id: personId,
  relation: 'biological',
  created_at: nowIso(),
})

export interface ConnectArgs {
  data: TreeData
  anchorId: string
  relation: Relation
  /** The person being added — already created, or picked from the tree. */
  person: Person
  /** Which marriage a child belongs to, when the anchor has more than one. */
  unionId?: string
  unionStatus?: UnionStatus
}

export interface ConnectResult extends Writes {
  /** Human-readable summary, used for the toast and the activity line. */
  summary: string
  error?: string
}

/**
 * Works out the records needed to attach `person` to `anchorId`.
 * The person record itself is included only when it is new to the tree.
 */
export function connect({
  data,
  anchorId,
  relation,
  person,
  unionId,
  unionStatus = 'married',
}: ConnectArgs): ConnectResult {
  const g = buildGraph(data)
  const writes = emptyWrites()
  const treeId = data.tree.id
  const anchor = g.person(anchorId)

  if (!anchor) return { ...writes, summary: '', error: 'That person is no longer in the tree.' }

  const isNew = !data.people.some((p) => p.id === person.id)
  if (isNew) writes.people.push(person)

  const anchorName = anchor.given_name || 'them'
  const personName = person.given_name || 'them'

  switch (relation) {
    case 'parent': {
      const birthUnion = g.parentUnionOf(anchorId)
      if (birthUnion) {
        if (!birthUnion.partner_a) {
          writes.updatedUnions.push({ ...birthUnion, partner_a: person.id })
        } else if (!birthUnion.partner_b) {
          writes.updatedUnions.push({ ...birthUnion, partner_b: person.id })
        } else {
          return {
            ...writes,
            summary: '',
            error: `${anchorName} already has two parents recorded. Remove one first, or add this person as a step-parent by marrying them to a parent.`,
          }
        }
      } else {
        const union = makeUnion(treeId, person.id, null)
        writes.unions.push(union)
        writes.children.push(makeChildLink(treeId, union.id, anchorId))
      }
      return { ...writes, summary: `${personName} added as ${anchorName}'s parent` }
    }

    case 'spouse': {
      writes.unions.push(makeUnion(treeId, anchorId, person.id, unionStatus))
      return { ...writes, summary: `${personName} added as ${anchorName}'s partner` }
    }

    case 'child': {
      let target = unionId ? g.union(unionId) : undefined
      if (!target) {
        const existing = g.unionsOf(anchorId)
        // With exactly one marriage there is no ambiguity. With none, the child
        // hangs off a union with a single known parent, which is honest.
        target = existing.length === 1 ? existing[0] : undefined
      }
      if (!target) {
        const union = makeUnion(treeId, anchorId, null, 'partners')
        writes.unions.push(union)
        target = union
      }
      writes.children.push(makeChildLink(treeId, target.id, person.id))
      return { ...writes, summary: `${personName} added as ${anchorName}'s child` }
    }

    case 'sibling': {
      let birthUnion = g.parentUnionOf(anchorId)
      if (!birthUnion) {
        // The important case: you know your grandmother had five siblings long
        // before you know her parents' names. A union with no partners records
        // exactly that, and every cousin relationship below still resolves.
        birthUnion = makeUnion(treeId, null, null, 'partners')
        writes.unions.push(birthUnion)
        writes.children.push(makeChildLink(treeId, birthUnion.id, anchorId))
      }
      writes.children.push(makeChildLink(treeId, birthUnion.id, person.id))
      return { ...writes, summary: `${personName} added as ${anchorName}'s sibling` }
    }
  }
}

/** Applies writes to an in-memory tree, for the optimistic update. */
export function applyWrites(data: TreeData, writes: Writes): TreeData {
  const updatedIds = new Set(writes.updatedUnions.map((u) => u.id))
  const replacedChildren = new Set(writes.children.map((c) => c.person_id))
  return {
    ...data,
    people: [...data.people, ...writes.people],
    unions: [
      ...data.unions.map((u) => writes.updatedUnions.find((w) => w.id === u.id) ?? u),
      ...writes.unions.filter((u) => !updatedIds.has(u.id)),
    ],
    // A person has one birth union, so a new link supersedes any old one.
    children: [
      ...data.children.filter((c) => !replacedChildren.has(c.person_id)),
      ...writes.children,
    ],
  }
}

/** How the "add" menu describes each option, given who you are looking at. */
export const relationLabels: Record<Relation, { title: string; hint: string }> = {
  parent: { title: 'Parent', hint: 'Their mother or father' },
  spouse: { title: 'Partner', hint: 'Husband, wife or partner' },
  child: { title: 'Child', hint: 'Their son or daughter' },
  sibling: { title: 'Brother or sister', hint: 'Shares at least one parent' },
}
