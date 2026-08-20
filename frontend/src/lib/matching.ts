import type { Person, TreeData } from '../types'
import { buildGraph, fullName, type FamilyGraph } from './graph'

// ─────────────────────────────────────────────────────────────────────────────
// "Is the Mary Banda in your tree the same Mary Banda in mine?"
//
// This is the join that makes Mizu more than a private notebook, and it is also
// the one place where being wrong is expensive: weld two families together on a
// common surname and you get a mess nobody can unpick. So nothing here decides
// anything. It produces a score and, more importantly, the human-readable
// reasons behind it, and two real people confirm or reject the suggestion.
//
// A name alone never clears the bar. The signals that actually carry weight are
// the ones around a person — the same parents, the same spouse, the same
// children — because coincidence rarely repeats across a whole household.
// ─────────────────────────────────────────────────────────────────────────────

/** Below this a suggestion is not worth anyone's attention. */
export const MATCH_THRESHOLD = 55

export interface Candidate {
  mine: Person
  theirs: Person
  theirTree: TreeData
  score: number
  reasons: string[]
}

// ── Text comparison ──────────────────────────────────────────────────────────

const normalise = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = row
  }
  return prev[b.length]
}

/** 0–1. Spelling drifts a lot in family records, so near misses still count. */
export function nameSimilarity(a: string, b: string): number {
  const x = normalise(a)
  const y = normalise(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const distance = levenshtein(x, y)
  return Math.max(0, 1 - distance / Math.max(x.length, y.length))
}

/** Does either person's "also known as" field explain the other's name?
 *  Catches maiden names, church names and the name everyone actually uses. */
function aliasHit(a: Person, b: Person): boolean {
  const aliases = (p: Person) =>
    normalise(`${p.other_names} ${p.given_name} ${p.family_name}`).split(' ').filter((t) => t.length > 2)
  const setA = new Set(aliases(a))
  const setB = new Set(aliases(b))
  let shared = 0
  for (const token of setA) if (setB.has(token)) shared++
  return shared >= 2
}

/** Compares two sets of relatives by name — the strongest signal available. */
function sharedRelatives(
  mineNames: string[],
  theirNames: string[],
): { count: number; names: string[] } {
  const names: string[] = []
  const used = new Set<number>()
  for (const m of mineNames) {
    for (let i = 0; i < theirNames.length; i++) {
      if (used.has(i)) continue
      if (nameSimilarity(m, theirNames[i]) >= 0.85) {
        used.add(i)
        names.push(theirNames[i])
        break
      }
    }
  }
  return { count: names.length, names }
}

// ── Scoring ──────────────────────────────────────────────────────────────────

export function scorePair(
  mineGraph: FamilyGraph,
  mine: Person,
  theirsGraph: FamilyGraph,
  theirs: Person,
): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 0

  const givenSim = nameSimilarity(mine.given_name, theirs.given_name)
  const familySim = nameSimilarity(mine.family_name, theirs.family_name)

  if (givenSim === 1 && familySim === 1) {
    score += 45
    reasons.push(`Both recorded as ${fullName(theirs)}`)
  } else {
    if (givenSim >= 0.85) {
      score += Math.round(25 * givenSim)
      if (givenSim < 1) reasons.push(`First names are close: ${mine.given_name} / ${theirs.given_name}`)
    }
    if (familySim >= 0.85) {
      score += Math.round(20 * familySim)
      if (familySim < 1) reasons.push(`Surnames are close: ${mine.family_name} / ${theirs.family_name}`)
    }
    if (givenSim === 1 && familySim >= 0.85) reasons.push(`Both called ${mine.given_name}`)
  }

  if (givenSim < 0.7 && aliasHit(mine, theirs)) {
    score += 20
    reasons.push('Also-known-as names overlap')
  }

  // Names alone are cheap. Everything below is what makes it credible.
  if (mine.birth_year && theirs.birth_year) {
    const gap = Math.abs(mine.birth_year - theirs.birth_year)
    if (gap === 0) {
      score += 20
      reasons.push(`Both born ${mine.birth_year}`)
    } else if (gap <= 2) {
      score += 12
      reasons.push(`Born within ${gap} year${gap === 1 ? '' : 's'} of each other`)
    } else if (gap <= 5) {
      score += 4
    } else if (gap > 10) {
      score -= 25
      reasons.push(`Birth years are ${gap} years apart`)
    }
  }

  if (mine.sex !== 'unknown' && theirs.sex !== 'unknown' && mine.sex !== theirs.sex) {
    score -= 35
    reasons.push('Recorded as different sexes')
  }

  if (mine.birth_place && theirs.birth_place && nameSimilarity(mine.birth_place, theirs.birth_place) >= 0.9) {
    score += 8
    reasons.push(`Both from ${theirs.birth_place}`)
  }

  const parents = sharedRelatives(
    mineGraph.parentsOf(mine.id).map(fullName),
    theirsGraph.parentsOf(theirs.id).map(fullName),
  )
  if (parents.count) {
    score += Math.min(30, parents.count * 20)
    reasons.push(`Same parent${parents.count > 1 ? 's' : ''}: ${parents.names.join(' and ')}`)
  }

  const spouses = sharedRelatives(
    mineGraph.spousesOf(mine.id).map(fullName),
    theirsGraph.spousesOf(theirs.id).map(fullName),
  )
  if (spouses.count) {
    score += 22
    reasons.push(`Both married to ${spouses.names.join(' and ')}`)
  }

  const children = sharedRelatives(
    mineGraph.childrenOf(mine.id).map(fullName),
    theirsGraph.childrenOf(theirs.id).map(fullName),
  )
  if (children.count) {
    score += Math.min(26, children.count * 13)
    reasons.push(
      `${children.count} child${children.count > 1 ? 'ren' : ''} in common: ${children.names.join(', ')}`,
    )
  }

  const siblings = sharedRelatives(
    mineGraph.siblingsOf(mine.id).map((s) => fullName(s.person)),
    theirsGraph.siblingsOf(theirs.id).map((s) => fullName(s.person)),
  )
  if (siblings.count) {
    score += Math.min(20, siblings.count * 10)
    reasons.push(`Shares ${siblings.count} sibling${siblings.count > 1 ? 's' : ''}`)
  }

  return { score: Math.max(0, Math.min(100, score)), reasons }
}

/**
 * Every plausible "same person" pairing between my tree and everyone else's.
 * A cheap name gate runs before the full comparison, so the quadratic sweep
 * only pays for pairs that could plausibly be the same human.
 */
export function findCandidates(
  myTree: TreeData,
  otherTrees: TreeData[],
  opts: { threshold?: number; excludePairs?: Set<string> } = {},
): Candidate[] {
  const threshold = opts.threshold ?? MATCH_THRESHOLD
  const exclude = opts.excludePairs ?? new Set<string>()
  const mineGraph = buildGraph(myTree)
  const out: Candidate[] = []

  for (const other of otherTrees) {
    if (other.tree.id === myTree.tree.id) continue
    const theirsGraph = buildGraph(other)

    for (const mine of myTree.people) {
      for (const theirs of other.people) {
        // A cheap gate before the full comparison: if neither part of the name
        // is even close and no alias overlaps, there is nothing to weigh up.
        if (
          nameSimilarity(mine.given_name, theirs.given_name) < 0.7 &&
          nameSimilarity(mine.family_name, theirs.family_name) < 0.7 &&
          !aliasHit(mine, theirs)
        ) {
          continue
        }

        const pairKey = [mine.id, theirs.id].sort().join('|')
        if (exclude.has(pairKey)) continue

        const { score, reasons } = scorePair(mineGraph, mine, theirsGraph, theirs)
        if (score < threshold) continue
        out.push({ mine, theirs, theirTree: other, score, reasons })
      }
    }
  }

  return out.sort((a, b) => b.score - a.score)
}

export const confidenceLabel = (score: number): string =>
  score >= 85 ? 'Very likely the same person'
    : score >= 70 ? 'Probably the same person'
      : 'Possibly the same person'
