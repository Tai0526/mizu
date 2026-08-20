import type { Person, Sex } from '../types'
import { ancestorDepths, fullName, type FamilyGraph } from './graph'

// ─────────────────────────────────────────────────────────────────────────────
// "How am I related to this person?"
//
// This is the whole point of Mizu, and it answers the question the way a family
// answers it, not the way a genealogist does.
//
// Genealogically, your mother's cousin is your "first cousin once removed".
// Nobody says that. He is your uncle, his children are your cousins, and your
// grandmother's sister is your grandmother. What decides the word is which
// GENERATION someone stands in relative to you — not how many branches across
// they sit. That is how most of the world names family, and it is the naming
// this app leads with.
//
// The precise term is still computed and kept in `exact`, because knowing
// somebody is a second cousin rather than a first is worth having. It is shown
// as a footnote, never as the headline.
//
// Both readings come from the same two numbers: find the nearest ancestor two
// people share, and count the generations each stands below it.
//
//   up = how far I am below the shared ancestor
//   down = how far they are
//   offset = up - down  →  positive means they are of an older generation
// ─────────────────────────────────────────────────────────────────────────────

export type KinCategory =
  | 'self'
  | 'spouse'
  | 'ancestor'
  | 'descendant'
  | 'sibling'
  | 'pibling' // aunt / uncle, in the wide family sense
  | 'nibling' // niece / nephew, likewise
  | 'cousin'
  | 'in-law'
  | 'step'
  | 'unrelated'

export interface Kinship {
  /** The family word: "uncle". Ready to drop into a sentence. */
  label: string
  /** The same word, sized for a card. */
  short: string
  /** The genealogist's term, when it differs — "first cousin once removed". */
  exact: string | null
  category: KinCategory
  /** Plain-English reason, shown in the person panel. */
  explanation: string | null
  commonAncestorId: string | null
  up: number | null
  down: number | null
  degree?: number
  removed?: number
}

const UNRELATED: Kinship = {
  label: 'not yet connected',
  short: '—',
  exact: null,
  category: 'unrelated',
  explanation: null,
  commonAncestorId: null,
  up: null,
  down: null,
}

// ── Wording helpers ──────────────────────────────────────────────────────────

const bySex = (sex: Sex, male: string, female: string, neutral: string) =>
  sex === 'male' ? male : sex === 'female' ? female : neutral

/** grandmother → great-grandmother → great-great-grandmother → 3× great-… */
function greats(count: number, base: string): string {
  if (count <= 0) return base
  if (count <= 2) return `${'great-'.repeat(count)}${base}`
  return `${count}× great-${base}`
}

const ORDINALS = [
  'first', 'second', 'third', 'fourth', 'fifth', 'sixth',
  'seventh', 'eighth', 'ninth', 'tenth',
]
const ordinal = (n: number) => ORDINALS[n - 1] ?? `${n}th`

const TIMES = ['', 'once', 'twice', 'three times', 'four times', 'five times']
const removedPhrase = (n: number) => (n === 0 ? '' : ` ${TIMES[n] ?? `${n} times`} removed`)

/** Sentence case, for a label standing alone on a chip. */
export const sentenceCase = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s)

// ── Ancestry index, including unions ─────────────────────────────────────────
//
// Ancestors are walked through *unions*, not just through named parents. That
// matters constantly in practice: you can know your grandmother had five
// siblings long before you know either of her parents' names. Recording them as
// children of one nameless union still makes them siblings, and every cousin
// relation below them still resolves. A union sits at the same generation as
// the partners in it, so the depth maths is unaffected.

const unionKey = (id: string) => `u:${id}`

function ancestryIndex(g: FamilyGraph, id: string, cap = 25): Map<string, number> {
  const depths = new Map<string, number>([[id, 0]])
  let frontier = [id]
  let depth = 0

  while (frontier.length && depth < cap) {
    depth++
    const next: string[] = []
    for (const cur of frontier) {
      const parentUnion = g.parentUnionOf(cur)
      if (!parentUnion) continue

      const key = unionKey(parentUnion.id)
      if (!depths.has(key)) depths.set(key, depth)

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

interface Meeting {
  key: string
  up: number
  down: number
}

/** The nearest ancestor the two share, preferring a named person over a union
 *  so the explanation can say who it actually was. */
function nearestCommon(a: Map<string, number>, b: Map<string, number>): Meeting | null {
  let best: Meeting | null = null
  for (const [key, up] of a) {
    const down = b.get(key)
    if (down === undefined) continue
    const candidate = { key, up, down }
    if (!best) { best = candidate; continue }

    const sum = up + down
    const bestSum = best.up + best.down
    if (sum !== bestSum) { if (sum < bestSum) best = candidate; continue }
    const skew = Math.abs(up - down)
    const bestSkew = Math.abs(best.up - best.down)
    if (skew !== bestSkew) { if (skew < bestSkew) best = candidate; continue }
    if (best.key.startsWith('u:') && !key.startsWith('u:')) best = candidate
  }
  return best
}

// ── The family word ──────────────────────────────────────────────────────────
//
// Generation decides the word. Anyone standing one generation above you, by any
// route, is an uncle or an aunt. Two above, a grandparent. Your own generation
// is brothers, sisters and cousins. Below you, nieces and nephews.

function familyTerm(sex: Sex, up: number, down: number): { word: string; category: KinCategory } {
  // Straight up your own line.
  if (down === 0) {
    if (up === 1) return { word: bySex(sex, 'father', 'mother', 'parent'), category: 'ancestor' }
    return {
      word: greats(up - 2, bySex(sex, 'grandfather', 'grandmother', 'grandparent')),
      category: 'ancestor',
    }
  }

  // Straight down from you.
  if (up === 0) {
    if (down === 1) return { word: bySex(sex, 'son', 'daughter', 'child'), category: 'descendant' }
    return {
      word: greats(down - 2, bySex(sex, 'grandson', 'granddaughter', 'grandchild')),
      category: 'descendant',
    }
  }

  const offset = up - down

  if (offset === 0) {
    if (up === 1) return { word: bySex(sex, 'brother', 'sister', 'sibling'), category: 'sibling' }
    // Second cousins, third cousins — all just cousins, which is what a family
    // calls them and how they are treated.
    return { word: 'cousin', category: 'cousin' }
  }

  if (offset === 1) {
    // Parent's sibling, parent's cousin, parent's second cousin — all uncle.
    return { word: bySex(sex, 'uncle', 'aunt', 'aunt or uncle'), category: 'pibling' }
  }

  if (offset >= 2) {
    // Grandmother's sister is a grandmother. The generation carries the word.
    return {
      word: greats(offset - 2, bySex(sex, 'grandfather', 'grandmother', 'grandparent')),
      category: 'pibling',
    }
  }

  if (offset === -1) {
    return { word: bySex(sex, 'nephew', 'niece', 'niece or nephew'), category: 'nibling' }
  }

  return {
    word: greats(-offset - 2, bySex(sex, 'grandson', 'granddaughter', 'grandchild')),
    category: 'nibling',
  }
}

// ── The genealogist's term ───────────────────────────────────────────────────
//
// Kept so nothing is lost. Shown as a footnote where it differs from the word
// the family would use.

function exactTerm(sex: Sex, up: number, down: number): { word: string; degree?: number; removed?: number } {
  if (down === 0 || up === 0) return { word: familyTerm(sex, up, down).word }

  if (up === 1 && down === 1) return { word: bySex(sex, 'brother', 'sister', 'sibling') }

  if (down === 1) {
    return { word: greats(up - 2, bySex(sex, 'uncle', 'aunt', 'aunt or uncle')) }
  }
  if (up === 1) {
    return { word: greats(down - 2, bySex(sex, 'nephew', 'niece', 'niece or nephew')) }
  }

  const degree = Math.min(up, down) - 1
  const removed = Math.abs(up - down)
  return { word: `${ordinal(degree)} cousin${removedPhrase(removed)}`, degree, removed }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function kinship(g: FamilyGraph, viewerId: string, targetId: string): Kinship {
  if (!viewerId || !targetId) return UNRELATED
  const target = g.person(targetId)
  const viewer = g.person(viewerId)
  if (!target || !viewer) return UNRELATED

  if (viewerId === targetId) {
    return { ...UNRELATED, label: 'you', short: 'You', category: 'self' }
  }

  // 1. Married or partnered to you.
  const sharedUnion = g.unionsOf(viewerId).find(
    (u) => u.partner_a === targetId || u.partner_b === targetId,
  )
  if (sharedUnion) {
    const ended = sharedUnion.status === 'divorced' || sharedUnion.status === 'separated'
    const base =
      sharedUnion.status === 'partners' || sharedUnion.status === 'engaged'
        ? 'partner'
        : bySex(target.sex, 'husband', 'wife', 'spouse')
    const word = ended ? `former ${base}` : base
    return {
      ...UNRELATED,
      label: word,
      short: word,
      category: 'spouse',
      explanation: sharedUnion.year ? `Married in ${sharedUnion.year}.` : null,
    }
  }

  // 2. Blood: find the nearest ancestor you share.
  const meeting = nearestCommon(ancestryIndex(g, viewerId), ancestryIndex(g, targetId))

  if (meeting) {
    const { up, down } = meeting
    const family = familyTerm(target.sex, up, down)
    const exact = exactTerm(target.sex, up, down)

    let label = family.word
    if (family.category === 'sibling') {
      const entry = g.siblingsOf(viewerId).find((s) => s.person.id === targetId)
      if (entry?.half) label = `half-${label}`
    }

    return {
      label,
      short: label,
      exact: exact.word === family.word ? null : exact.word,
      category: family.category,
      degree: exact.degree,
      removed: exact.removed,
      commonAncestorId: meeting.key.startsWith('u:') ? null : meeting.key,
      up,
      down,
      explanation: explain(g, viewerId, targetId, meeting),
    }
  }

  // 3. Not blood — but very likely family by marriage.
  return inLawLabel(g, viewerId, target) ?? UNRELATED
}

/** Writes the "why" line under a relationship. */
function explain(g: FamilyGraph, viewerId: string, targetId: string, meeting: Meeting): string | null {
  const { up, down } = meeting
  if (down === 0 || up === 0) return null

  const targetFirst = (g.person(targetId)?.given_name || 'they').trim()

  if (up === 1 && down === 1) {
    const parents = g.parentsOf(viewerId)
    if (parents.length) return `You share ${parents.map((p) => fullName(p)).join(' and ')}.`
    return 'You share the same parents.'
  }

  // The shared ancestor is a couple nobody has named. Describe them through the
  // two siblings that lead down to each of you — which is how a family explains
  // it anyway: "your grandmother and his mother were sisters".
  if (meeting.key.startsWith('u:')) {
    const unionId = meeting.key.slice(2)
    const mineSide = childOnPath(g, unionId, viewerId)
    const theirSide = childOnPath(g, unionId, targetId)
    if (mineSide && theirSide && mineSide.id !== theirSide.id) {
      const mineWord = familyTerm(mineSide.sex, up - 1, 0).word
      const theirWord = familyTerm(theirSide.sex, down - 1, 0).word
      const mineDesc = up - 1 === 0 ? fullName(mineSide) : `your ${mineWord} ${fullName(mineSide)}`
      const theirDesc =
        down - 1 === 0 ? fullName(theirSide) : `${targetFirst}'s ${theirWord} ${fullName(theirSide)}`
      return `${sentenceCase(mineDesc)} and ${theirDesc} were ${siblingWord(mineSide.sex, theirSide.sex)}.`
    }
    return `You come from the same family, ${up} generation${up === 1 ? '' : 's'} above you.`
  }

  const ancestor = g.person(meeting.key)
  if (!ancestor) return null

  const toViewer = familyTerm(ancestor.sex, up, 0).word
  const toTarget = familyTerm(ancestor.sex, down, 0).word
  return `You both descend from ${fullName(ancestor)} — your ${toViewer}, ${targetFirst}'s ${toTarget}.`
}

/** Which child of this union leads down to `personId`. */
function childOnPath(g: FamilyGraph, unionId: string, personId: string): Person | undefined {
  const line = ancestorDepths(g, personId)
  return g.childrenOfUnion(unionId).find((c) => line.has(c.id))
}

const siblingWord = (a: Sex, b: Sex): string => {
  if (a === 'female' && b === 'female') return 'sisters'
  if (a === 'male' && b === 'male') return 'brothers'
  if (a !== 'unknown' && b !== 'unknown') return 'brother and sister'
  return 'brother or sister to each other'
}

// ── Family by marriage ───────────────────────────────────────────────────────
//
// One hop in each direction: the people your relatives married, and the
// relatives of the person you married.
//
// The same generational rule applies here, and it is the reason the app can say
// something families take for granted: your aunt's husband is your uncle. He is
// no blood relation at all, but that is unambiguously what he is called, and
// the panel still says exactly how he got the title.

function inLawLabel(g: FamilyGraph, viewerId: string, target: Person): Kinship | null {
  const make = (label: string, explanation: string, extra: Partial<Kinship> = {}): Kinship => ({
    ...UNRELATED,
    label,
    short: label,
    category: 'in-law',
    explanation,
    ...extra,
  })

  // (a) They married one of your blood relatives.
  for (const spouse of g.spousesOf(target.id)) {
    const rel = bloodOnly(g, viewerId, spouse.id)
    if (!rel) continue
    const offset = rel.up - rel.down
    const spouseName = fullName(spouse)

    if (rel.down === 0 && rel.up === 1) {
      // Married to your parent, but not your parent.
      return make(
        bySex(target.sex, 'stepfather', 'stepmother', 'stepparent'),
        `Married to your ${rel.word}, ${spouseName}.`,
        { category: 'step', up: rel.up, down: rel.down },
      )
    }
    if (offset >= 1 && rel.down > 0) {
      // Your aunt's husband is your uncle; your great-aunt's husband is a
      // grandfather-generation man and gets that word.
      const term = familyTerm(target.sex, rel.up, rel.down)
      return make(term.word, `Married to your ${rel.word}, ${spouseName}.`, {
        up: rel.up,
        down: rel.down,
      })
    }
    if (rel.up === 1 && rel.down === 1) {
      return make(
        bySex(target.sex, 'brother-in-law', 'sister-in-law', 'sibling-in-law'),
        `Married to your ${rel.word}, ${spouseName}.`,
        { up: rel.up, down: rel.down },
      )
    }
    if (rel.up === 0 && rel.down === 1) {
      return make(
        bySex(target.sex, 'son-in-law', 'daughter-in-law', 'child-in-law'),
        `Married to your ${rel.word}, ${spouseName}.`,
        { up: rel.up, down: rel.down },
      )
    }
    return make(
      `${rel.word}'s ${bySex(target.sex, 'husband', 'wife', 'partner')}`,
      `Married to your ${rel.word}, ${spouseName}.`,
      { up: rel.up, down: rel.down },
    )
  }

  // (b) They are a blood relative of the person you married.
  for (const mySpouse of g.spousesOf(viewerId)) {
    const rel = bloodOnly(g, mySpouse.id, target.id)
    if (!rel) continue
    const theirs = bySex(mySpouse.sex, 'husband', 'wife', 'partner')

    if (rel.up === 1 && rel.down === 1) {
      return make(
        bySex(target.sex, 'brother-in-law', 'sister-in-law', 'sibling-in-law'),
        `Your ${theirs}'s ${rel.word}.`,
      )
    }
    if (rel.down === 0 && rel.up === 1) {
      return make(
        bySex(target.sex, 'father-in-law', 'mother-in-law', 'parent-in-law'),
        `Your ${theirs}'s ${rel.word}.`,
      )
    }
    return make(`your ${theirs}'s ${rel.word}`, `Related through ${fullName(mySpouse)}.`)
  }

  return null
}

/** Blood-only lookup used by the in-law pass, so it cannot recurse into itself. */
function bloodOnly(g: FamilyGraph, viewerId: string, targetId: string) {
  if (viewerId === targetId) return null
  const target = g.person(targetId)
  if (!target) return null
  const meeting = nearestCommon(ancestryIndex(g, viewerId), ancestryIndex(g, targetId))
  if (!meeting) return null
  const term = familyTerm(target.sex, meeting.up, meeting.down)
  return { word: term.word, category: term.category, up: meeting.up, down: meeting.down }
}

/** Turns a label into something that reads correctly in a sentence:
 *  "you", "your aunt", "the husband of your aunt". */
export const possessive = (k: Kinship): string => {
  if (k.category === 'self') return 'you'
  if (k.label.startsWith('your ')) return k.label
  if (k.label.includes(' of your ')) return `the ${k.label}`
  return `your ${k.label}`
}

/** Groups used by the People page. Bucketing follows the same generational
 *  logic as the labels, so an aunt's husband files with the aunts and uncles. */
export function kinBucket(k: Kinship): string {
  if (k.category === 'self') return 'You'
  if (k.category === 'spouse') return 'Your partner'
  if (k.category === 'unrelated') return 'Not yet connected'
  if (k.up == null || k.down == null) return 'Family by marriage'

  const { up, down } = k
  if (down === 0) return up === 1 ? 'Parents' : 'Grandparents and above'
  if (up === 0) return down === 1 ? 'Children' : 'Grandchildren'

  const offset = up - down
  if (offset === 0) return up === 1 ? 'Brothers and sisters' : 'Cousins'
  if (offset === 1) return 'Aunts and uncles'
  if (offset >= 2) return 'Grandparents and above'
  if (offset === -1) return 'Nieces and nephews'
  return 'Grandchildren'
}
