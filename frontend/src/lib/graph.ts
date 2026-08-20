import type { ChildLink, Person, TreeData, Union } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// An indexed view over one tree.
//
// The raw TreeData is three flat arrays. Every screen in the app needs to ask
// questions like "who are this person's siblings" dozens of times per render,
// so we build the adjacency indexes once and hand the result around.
// ─────────────────────────────────────────────────────────────────────────────

export interface FamilyGraph {
  data: TreeData
  person: (id: string | null | undefined) => Person | undefined
  people: Person[]
  union: (id: string) => Union | undefined
  unions: Union[]
  /** Unions this person is a partner in. */
  unionsOf: (personId: string) => Union[]
  /** The union this person was born into, if recorded. */
  parentUnionOf: (personId: string) => Union | undefined
  /** Known parents (0, 1 or 2). */
  parentsOf: (personId: string) => Person[]
  /** Partners across all of this person's unions. */
  spousesOf: (personId: string) => Person[]
  /** Children of a specific union, oldest first. */
  childrenOfUnion: (unionId: string) => Person[]
  /** Every child of this person, across all their unions. */
  childrenOf: (personId: string) => Person[]
  /** Siblings sharing at least one parent, flagged when it is only one. */
  siblingsOf: (personId: string) => { person: Person; half: boolean }[]
  childLinkFor: (personId: string) => ChildLink | undefined
}

const byBirth = (a: Person, b: Person) => {
  // Oldest first. People without a recorded year sink to the bottom rather than
  // defaulting to year zero and scrambling the sibling order.
  if (a.birth_year != null && b.birth_year != null) return a.birth_year - b.birth_year
  if (a.birth_year != null) return -1
  if (b.birth_year != null) return 1
  return a.created_at.localeCompare(b.created_at)
}

export function buildGraph(data: TreeData): FamilyGraph {
  const peopleById = new Map(data.people.map((p) => [p.id, p]))
  const unionsById = new Map(data.unions.map((u) => [u.id, u]))

  const unionsByPartner = new Map<string, Union[]>()
  for (const u of data.unions) {
    for (const pid of [u.partner_a, u.partner_b]) {
      if (!pid) continue
      const list = unionsByPartner.get(pid) ?? []
      list.push(u)
      unionsByPartner.set(pid, list)
    }
  }

  const childLinkByPerson = new Map<string, ChildLink>()
  const childrenByUnion = new Map<string, ChildLink[]>()
  for (const c of data.children) {
    // A person belongs to one birth union; if a duplicate ever sneaks in, the
    // first wins so the structure stays a tree rather than a lattice.
    if (!childLinkByPerson.has(c.person_id)) childLinkByPerson.set(c.person_id, c)
    const list = childrenByUnion.get(c.union_id) ?? []
    list.push(c)
    childrenByUnion.set(c.union_id, list)
  }

  const person = (id: string | null | undefined) => (id ? peopleById.get(id) : undefined)
  const union = (id: string) => unionsById.get(id)
  const unionsOf = (personId: string) => unionsByPartner.get(personId) ?? []
  const childLinkFor = (personId: string) => childLinkByPerson.get(personId)

  const parentUnionOf = (personId: string) => {
    const link = childLinkByPerson.get(personId)
    return link ? unionsById.get(link.union_id) : undefined
  }

  const parentsOf = (personId: string): Person[] => {
    const u = parentUnionOf(personId)
    if (!u) return []
    return [person(u.partner_a), person(u.partner_b)].filter((p): p is Person => !!p)
  }

  const spousesOf = (personId: string): Person[] =>
    unionsOf(personId)
      .map((u) => person(u.partner_a === personId ? u.partner_b : u.partner_a))
      .filter((p): p is Person => !!p)

  const childrenOfUnion = (unionId: string): Person[] =>
    (childrenByUnion.get(unionId) ?? [])
      .map((c) => peopleById.get(c.person_id))
      .filter((p): p is Person => !!p)
      .sort(byBirth)

  const childrenOf = (personId: string): Person[] => {
    const seen = new Set<string>()
    const out: Person[] = []
    for (const u of unionsOf(personId)) {
      for (const child of childrenOfUnion(u.id)) {
        if (seen.has(child.id)) continue
        seen.add(child.id)
        out.push(child)
      }
    }
    return out.sort(byBirth)
  }

  const siblingsOf = (personId: string) => {
    const myParents = new Set(parentsOf(personId).map((p) => p.id))
    const out: { person: Person; half: boolean }[] = []
    const seen = new Set<string>([personId])

    const consider = (candidate: Person) => {
      if (seen.has(candidate.id)) return
      seen.add(candidate.id)
      const theirs = parentsOf(candidate.id).map((p) => p.id)
      const shared = theirs.filter((id) => myParents.has(id)).length
      // Sharing both known parents is a full sibling. Sharing exactly one, when
      // both sides have two parents recorded, is a half sibling. When parents
      // are only partly known we do not guess and treat it as full.
      const half = shared === 1 && myParents.size === 2 && theirs.length === 2
      out.push({ person: candidate, half })
    }

    // Same birth union: the common case.
    const birthUnion = parentUnionOf(personId)
    if (birthUnion) childrenOfUnion(birthUnion.id).forEach(consider)

    // Half siblings sit in a different union that shares one of my parents.
    for (const parentId of myParents) {
      for (const u of unionsOf(parentId)) {
        if (birthUnion && u.id === birthUnion.id) continue
        childrenOfUnion(u.id).forEach(consider)
      }
    }

    return out.sort((a, b) => byBirth(a.person, b.person))
  }

  return {
    data,
    person,
    people: data.people,
    union,
    unions: data.unions,
    unionsOf,
    parentUnionOf,
    parentsOf,
    spousesOf,
    childrenOfUnion,
    childrenOf,
    siblingsOf,
    childLinkFor,
  }
}

// ── Ancestry helpers ─────────────────────────────────────────────────────────

/** Every ancestor of `id` mapped to how many generations up they are. Includes
 *  `id` itself at 0, which keeps the kinship maths in kinship.ts uniform. */
export function ancestorDepths(g: FamilyGraph, id: string, cap = 30): Map<string, number> {
  const depths = new Map<string, number>([[id, 0]])
  let frontier = [id]
  let depth = 0
  while (frontier.length && depth < cap) {
    depth++
    const next: string[] = []
    for (const cur of frontier) {
      for (const parent of g.parentsOf(cur)) {
        // Keep the shortest path. Where cousins have married, the same ancestor
        // is reachable two ways and the nearer one gives the true label.
        if (depths.has(parent.id)) continue
        depths.set(parent.id, depth)
        next.push(parent.id)
      }
    }
    frontier = next
  }
  return depths
}

/** Every descendant of `id`, mapped to generations down. Includes `id` at 0. */
export function descendantDepths(g: FamilyGraph, id: string, cap = 30): Map<string, number> {
  const depths = new Map<string, number>([[id, 0]])
  let frontier = [id]
  let depth = 0
  while (frontier.length && depth < cap) {
    depth++
    const next: string[] = []
    for (const cur of frontier) {
      for (const child of g.childrenOf(cur)) {
        if (depths.has(child.id)) continue
        depths.set(child.id, depth)
        next.push(child.id)
      }
    }
    frontier = next
  }
  return depths
}

/** Walks up from `id` to the furthest ancestor, preferring the line with the
 *  most generations above it — that branch makes the most useful trunk. */
export function highestAncestor(g: FamilyGraph, id: string): string {
  let best = id
  let bestDepth = -1
  for (const [ancestorId, depth] of ancestorDepths(g, id)) {
    if (depth > bestDepth) {
      bestDepth = depth
      best = ancestorId
    }
  }
  return best
}

export const fullName = (p: Person | undefined): string =>
  p ? [p.given_name, p.family_name].filter(Boolean).join(' ').trim() || 'Unnamed' : 'Unknown'

export const lifespan = (p: Person): string => {
  if (p.birth_year && p.death_year) return `${p.birth_year}–${p.death_year}`
  if (p.birth_year) return `b. ${p.birth_year}`
  if (p.death_year) return `d. ${p.death_year}`
  return ''
}

export const initials = (p: Person | undefined): string => {
  if (!p) return '?'
  const a = p.given_name.trim()[0] ?? ''
  const b = p.family_name.trim()[0] ?? ''
  return (a + b).toUpperCase() || '?'
}
