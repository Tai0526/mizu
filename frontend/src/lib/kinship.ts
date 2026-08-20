import type { Person, Sex } from '../types'
import { fullName, type FamilyGraph } from './graph'

// ─────────────────────────────────────────────────────────────────────────────
// "How am I related to this person?"
//
// This is the whole point of Mizu. A name in a box is trivia; "your grandmother's
// brother's granddaughter — your second cousin" is the thing people actually
// came for. Nothing here is stored: a relationship only exists relative to who
// is looking, so it is computed fresh for every viewer.
//
// The method is the standard one: find the nearest ancestor the two people
// share, measure how many generations each stands below that ancestor, and read
// the label off those two numbers.
//
//   up(viewer)=1, up(target)=1  → siblings
//   up(viewer)=2, up(target)=1  → target is your aunt or uncle
//   up(viewer)=1, up(target)=2  → target is your niece or nephew
//   up(viewer)=n, up(target)=m  → cousins, degree min(n,m)-1, removed |n-m|
// ─────────────────────────────────────────────────────────────────────────────

export type KinCategory =
  | 'self'
  | 'spouse'
  | 'ancestor'
  | 'descendant'
  | 'sibling'
  | 'pibling' // aunt / uncle
  | 'nibling' // niece / nephew
  | 'cousin'
  | 'in-law'
  | 'step'
  | 'unrelated'

export interface Kinship {
  /** "your first cousin once removed" — ready to drop into a sentence. */
  label: string
  /** "1st cousin" — short enough for a card on the canvas. */
  short: string
  category: KinCategory
  /** Plain-English reason, shown in the person panel. */
  explanation: string | null
  commonAncestorId: string | null
  /** Generations each person stands below the shared ancestor. */
  up: number | null
  down: number | null
  degree?: number
  removed?: number
}

const UNRELATED: Kinship = {
  label: 'not yet connected',
  short: '—',
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
const ordinalShort = (n: number) => {
  const suffix = n % 10 === 1 && n % 100 !== 11 ? 'st'
    : n % 10 === 2 && n % 100 !== 12 ? 'nd'
    : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'
  return `${n}${suffix}`
}

const TIMES = ['', 'once', 'twice', 'three times', 'four times', 'five times']
const removedPhrase = (n: number) => (n === 0 ? '' : ` ${TIMES[n] ?? `${n} times`} removed`)
// A card is wide enough for "2nd cousin twice removed", and that phrase is the
// one people actually want to read. No abbreviation earns its confusion here.
const removedShort = removedPhrase

// ── Ancestry index, including unions ─────────────────────────────────────────
//
// Ancestors are walked through *unions*, not just through named parents. That
// matters constantly in practice: you can know that your grandmother had five
// siblings long before you know either of her parents' names. Recording them as
// children of one (nameless) union still makes them siblings, and every cousin
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
      const personId = cur.startsWith('u:') ? null : cur

      if (personId) {
        const parentUnion = g.parentUnionOf(personId)
        if (parentUnion) {
          const key = unionKey(parentUnion.id)
          if (!depths.has(key)) {
            depths.set(key, depth)
            next.push(key)
          }
          for (const parent of g.parentsOf(personId)) {
            if (depths.has(parent.id)) continue
            depths.set(parent.id, depth)
            // A parent is reached at this depth; their own ancestors come from
            // the next round, so they must be walked from here.
            next.push(parent.id)
          }
        }
      }
    }
    // Union keys carry no further ancestry of their own — the partners inside
    // them do — so they are recorded but not re-expanded.
    frontier = next.filter((k) => !k.startsWith('u:'))
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
    // Same distance: prefer the more balanced pair, then a real person.
    const skew = Math.abs(up - down)
    const bestSkew = Math.abs(best.up - best.down)
    if (skew !== bestSkew) { if (skew < bestSkew) best = candidate; continue }
    if (best.key.startsWith('u:') && !key.startsWith('u:')) best = candidate
  }
  return best
}

// ── Blood relationships ──────────────────────────────────────────────────────

function bloodLabel(
  target: Person,
  up: number,
  down: number,
): { label: string; short: string; category: KinCategory; degree?: number; removed?: number } {
  const sex = target.sex

  // The shared ancestor is the target themselves — they are your ancestor.
  if (down === 0) {
    if (up === 1) {
      return { label: bySex(sex, 'father', 'mother', 'parent'), short: bySex(sex, 'father', 'mother', 'parent'), category: 'ancestor' }
    }
    const base = bySex(sex, 'grandfather', 'grandmother', 'grandparent')
    const word = greats(up - 2, base)
    return { label: word, short: word, category: 'ancestor' }
  }

  // The shared ancestor is you — they descend from you.
  if (up === 0) {
    if (down === 1) {
      return { label: bySex(sex, 'son', 'daughter', 'child'), short: bySex(sex, 'son', 'daughter', 'child'), category: 'descendant' }
    }
    const base = bySex(sex, 'grandson', 'granddaughter', 'grandchild')
    const word = greats(down - 2, base)
    return { label: word, short: word, category: 'descendant' }
  }

  if (up === 1 && down === 1) {
    // Half siblings are labelled by the caller, which knows who is looking.
    const word = bySex(sex, 'brother', 'sister', 'sibling')
    return { label: word, short: word, category: 'sibling' }
  }

  // They are a sibling of one of your ancestors: aunt / uncle, then great-.
  if (down === 1) {
    const base = bySex(sex, 'uncle', 'aunt', 'aunt or uncle')
    const word = greats(up - 2, base)
    return { label: word, short: word, category: 'pibling' }
  }

  // You are a sibling of one of their ancestors: niece / nephew.
  if (up === 1) {
    const base = bySex(sex, 'nephew', 'niece', 'niece or nephew')
    const word = greats(down - 2, base)
    return { label: word, short: word, category: 'nibling' }
  }

  const degree = Math.min(up, down) - 1
  const removed = Math.abs(up - down)
  return {
    label: `${ordinal(degree)} cousin${removedPhrase(removed)}`,
    short: `${ordinalShort(degree)} cousin${removedShort(removed)}`,
    category: 'cousin',
    degree,
    removed,
  }
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
      sharedUnion.status === 'married' || sharedUnion.status === 'widowed' || ended
        ? bySex(target.sex, 'husband', 'wife', 'spouse')
        : 'partner'
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
  const mine = ancestryIndex(g, viewerId)
  const theirs = ancestryIndex(g, targetId)
  const meeting = nearestCommon(mine, theirs)

  if (meeting) {
    const { up, down } = meeting
    const base = bloodLabel(target, up, down)

    // A sibling sharing only one parent gets said properly.
    let label = base.label
    let short = base.short
    if (base.category === 'sibling') {
      const entry = g.siblingsOf(viewerId).find((s) => s.person.id === targetId)
      if (entry?.half) {
        label = `half-${label}`
        short = `half-${short}`
      }
    }

    return {
      label,
      short,
      category: base.category,
      degree: base.degree,
      removed: base.removed,
      commonAncestorId: meeting.key.startsWith('u:') ? null : meeting.key,
      up,
      down,
      explanation: explain(g, viewerId, targetId, meeting, base.category),
    }
  }

  // 3. Not blood — but very likely family by marriage.
  const inLaw = inLawLabel(g, viewerId, target)
  if (inLaw) return inLaw

  return UNRELATED
}

/** Writes the "why" line shown under a relationship, e.g.
 *  "You both descend from Mary Banda — your grandmother, their great-grandmother." */
function explain(
  g: FamilyGraph,
  viewerId: string,
  targetId: string,
  meeting: Meeting,
  category: KinCategory,
): string | null {
  const { up, down } = meeting
  if (category === 'ancestor' || category === 'descendant') return null

  const ancestor = meeting.key.startsWith('u:') ? null : g.person(meeting.key)

  if (up === 1 && down === 1) {
    const parents = g.parentsOf(viewerId)
    if (parents.length) return `You share ${parents.map((p) => fullName(p)).join(' and ')}.`
    return 'You share the same parents.'
  }

  if (!ancestor) {
    return `You both descend from the same family, ${up} generation${up === 1 ? '' : 's'} above you.`
  }

  const toViewer = describeAncestorTo(ancestor, up)
  const toTarget = describeAncestorTo(ancestor, down)
  const targetName = fullName(g.person(targetId)).split(' ')[0]
  return `You both descend from ${fullName(ancestor)} — your ${toViewer}, ${targetName}'s ${toTarget}.`
}

function describeAncestorTo(ancestor: Person, depth: number): string {
  if (depth === 0) return 'self'
  if (depth === 1) return bySex(ancestor.sex, 'father', 'mother', 'parent')
  return greats(depth - 2, bySex(ancestor.sex, 'grandfather', 'grandmother', 'grandparent'))
}

// ── Family by marriage ───────────────────────────────────────────────────────
//
// One hop only, in both directions: the people your blood relatives married,
// and the blood relatives of the person you married. Beyond that the labels
// stop being ones anybody actually uses.

function inLawLabel(g: FamilyGraph, viewerId: string, target: Person): Kinship | null {
  const make = (
    label: string,
    category: KinCategory,
    explanation: string,
    short?: string,
  ): Kinship => ({
    ...UNRELATED,
    label,
    short: short ?? label,
    category,
    explanation,
  })

  // (a) They married one of your blood relatives.
  for (const spouse of g.spousesOf(target.id)) {
    const rel = bloodOnly(g, viewerId, spouse.id)
    if (!rel) continue

    if (rel.category === 'sibling') {
      return make(
        bySex(target.sex, 'brother-in-law', 'sister-in-law', 'sibling-in-law'),
        'in-law',
        `Married to your ${rel.label}, ${fullName(spouse)}.`,
      )
    }
    if (rel.category === 'ancestor' && rel.up === 1) {
      // Your parent's other spouse — a stepparent, not a parent.
      return make(
        bySex(target.sex, 'stepfather', 'stepmother', 'stepparent'),
        'step',
        `Married to your ${rel.label}, ${fullName(spouse)}.`,
      )
    }
    if (rel.category === 'descendant' && rel.down === 1) {
      return make(
        bySex(target.sex, 'son-in-law', 'daughter-in-law', 'child-in-law'),
        'in-law',
        `Married to your ${rel.label}, ${fullName(spouse)}.`,
      )
    }
    // "Great-aunt's husband" fits on a card; "husband of your great-aunt" does
    // not. Cousin degrees get dropped from the short form — "1st cousin once
    // removed's wife" is not a phrase anybody says — and the panel still
    // carries the exact wording.
    const possessiveBase = rel.category === 'cousin' ? 'cousin' : rel.short
    return make(
      `${bySex(target.sex, 'husband', 'wife', 'partner')} of your ${rel.label}`,
      'in-law',
      `Married to your ${rel.label}, ${fullName(spouse)}.`,
      `${possessiveBase}'s ${bySex(target.sex, 'husband', 'wife', 'partner')}`,
    )
  }

  // (b) They are a blood relative of the person you married.
  for (const mySpouse of g.spousesOf(viewerId)) {
    const rel = bloodOnly(g, mySpouse.id, target.id)
    if (!rel) continue
    const spouseWord = bySex(mySpouse.sex, "husband's", "wife's", "partner's")

    if (rel.category === 'sibling') {
      return make(
        bySex(target.sex, 'brother-in-law', 'sister-in-law', 'sibling-in-law'),
        'in-law',
        `Your ${spouseWord.replace("'s", '')} ${rel.label}.`,
      )
    }
    if (rel.category === 'ancestor' && rel.up === 1) {
      return make(
        bySex(target.sex, 'father-in-law', 'mother-in-law', 'parent-in-law'),
        'in-law',
        `Your ${spouseWord.replace("'s", '')} ${rel.label}.`,
      )
    }
    return make(
      `your ${spouseWord} ${rel.label}`,
      'in-law',
      `Related through ${fullName(mySpouse)}.`,
      `${spouseWord} ${rel.short}`,
    )
  }

  return null
}

/** Blood-only lookup used by the in-law pass, so it can't recurse into itself. */
function bloodOnly(g: FamilyGraph, viewerId: string, targetId: string) {
  if (viewerId === targetId) return null
  const target = g.person(targetId)
  if (!target) return null
  const meeting = nearestCommon(ancestryIndex(g, viewerId), ancestryIndex(g, targetId))
  if (!meeting) return null
  const base = bloodLabel(target, meeting.up, meeting.down)
  return { ...base, up: meeting.up, down: meeting.down }
}

/** Turns a label into something that reads correctly in a sentence:
 *  "you", "your aunt", "the husband of your aunt". In-law labels already carry
 *  their own possessive, so blindly prefixing "your" produced nonsense like
 *  "your husband of your aunt". */
export const possessive = (k: Kinship): string => {
  if (k.category === 'self') return 'you'
  if (k.label.startsWith('your ')) return k.label
  if (k.label.includes(' of your ')) return `the ${k.label}`
  return `your ${k.label}`
}

/** Sentence case. Labels are stored lowercase so they read correctly mid-
 *  sentence ("Emmanuel is the husband of your aunt"); anywhere one stands alone
 *  as a chip it needs a capital. Done here rather than with ::first-letter,
 *  which does not apply to the flex containers those chips are. */
export const sentenceCase = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** Groups used by the People page to bucket a long list into something readable. */
export function kinBucket(k: Kinship): string {
  switch (k.category) {
    case 'self': return 'You'
    case 'spouse': return 'Your partner'
    case 'ancestor': return k.up === 1 ? 'Parents' : 'Grandparents and above'
    case 'descendant': return k.down === 1 ? 'Children' : 'Grandchildren'
    case 'sibling': return 'Brothers and sisters'
    case 'pibling': return 'Aunts and uncles'
    case 'nibling': return 'Nieces and nephews'
    case 'cousin': return k.degree === 1 ? 'First cousins' : 'Wider cousins'
    case 'in-law':
    case 'step': return 'Family by marriage'
    default: return 'Not yet connected'
  }
}
