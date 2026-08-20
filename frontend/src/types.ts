// ─────────────────────────────────────────────────────────────────────────────
// Mizu's domain model.
//
// The shape here is deliberately the one genealogists settled on decades ago
// (it's what GEDCOM encodes): people, the unions they form, and the children
// that hang off a union. Storing edges that way — rather than a naive
// "person.parentId" — is what lets the app represent remarriage, half-siblings,
// single parents and adoption without any special cases.
//
// Everything a user *sees* — "your aunt", "your second cousin once removed" —
// is computed from this graph at read time by lib/kinship.ts. None of it is
// stored, because a relationship label is only true relative to who's looking.
// ─────────────────────────────────────────────────────────────────────────────

export type Sex = 'male' | 'female' | 'unknown'

export type UnionStatus = 'married' | 'partners' | 'engaged' | 'separated' | 'divorced' | 'widowed'

export type ChildRelation = 'biological' | 'adopted' | 'step' | 'fostered'

export type MemberRole = 'owner' | 'editor' | 'viewer'

export interface Person {
  id: string
  tree_id: string
  given_name: string
  family_name: string
  /** Maiden name, nickname, village name — anything they're also known by. */
  other_names: string
  sex: Sex
  birth_year: number | null
  birth_place: string
  death_year: number | null
  living: boolean
  /** Data URL in local mode, Supabase Storage URL once a backend is connected. */
  photo_url: string | null
  notes: string
  /** Set when a real account says "this person is me". */
  claimed_by: string | null
  created_by: string
  created_at: string
  updated_at: string
}

/** A couple. Either partner may be unknown — that's how a lone sibling group
 *  or a single parent is represented without inventing fake people. */
export interface Union {
  id: string
  tree_id: string
  partner_a: string | null
  partner_b: string | null
  status: UnionStatus
  year: number | null
  created_at: string
}

/** Attaches a person to the union they were born (or brought) into. */
export interface ChildLink {
  id: string
  tree_id: string
  union_id: string
  person_id: string
  relation: ChildRelation
  created_at: string
}

export interface Tree {
  id: string
  name: string
  description: string
  created_by: string
  created_at: string
}

export interface TreeMember {
  id: string
  tree_id: string
  user_id: string
  display_name: string
  role: MemberRole
  /** Which node in this tree the member says is themselves. */
  person_id: string | null
  created_at: string
}

/** A proposed or confirmed "these two records are the same human" link across
 *  two different trees. This is the mechanism that grows one family's tree into
 *  the next one over. Nothing is joined until both sides agree. */
export interface MatchLink {
  id: string
  person_a: string
  tree_a: string
  person_b: string
  tree_b: string
  status: 'proposed' | 'confirmed' | 'declined'
  /** 0–100 confidence from lib/matching.ts, shown to the humans deciding. */
  score: number
  reasons: string[]
  proposed_by: string
  responded_by: string | null
  created_at: string
}

export interface Account {
  id: string
  email: string
  display_name: string
  created_at: string
}

/** Everything needed to render one tree, loaded together. */
export interface TreeData {
  tree: Tree
  people: Person[]
  unions: Union[]
  children: ChildLink[]
  members: TreeMember[]
}

export const EMPTY_TREE_DATA = (tree: Tree): TreeData => ({
  tree,
  people: [],
  unions: [],
  children: [],
  members: [],
})
