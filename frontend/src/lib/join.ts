import type { MatchLink, TreeData } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// What a confirmed match actually buys you.
//
// Trees are never merged on disk — your records stay yours, theirs stay theirs,
// and either side can withdraw. What a confirmed link does is let the app build
// a temporary combined view in memory, where the two records for one person are
// treated as one node.
//
// That view is what turns "someone else also knows my grandmother" into the
// thing you wanted: a list of living relatives you had never heard of, each one
// labelled with exactly how they connect to you.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Folds `others` into `mine` across the confirmed links.
 * Where a link exists, the other tree's record is dropped and every edge that
 * pointed at it is redirected to my copy of that person.
 */
export function joinTrees(mine: TreeData, others: TreeData[], links: MatchLink[]): TreeData {
  const confirmed = links.filter((l) => l.status === 'confirmed')

  // theirPersonId -> myPersonId
  const alias = new Map<string, string>()
  for (const link of confirmed) {
    if (link.tree_a === mine.tree.id) alias.set(link.person_b, link.person_a)
    else if (link.tree_b === mine.tree.id) alias.set(link.person_a, link.person_b)
  }

  const resolve = (id: string | null) => (id ? (alias.get(id) ?? id) : null)

  const people = [...mine.people]
  const unions = [...mine.unions]
  const children = [...mine.children]
  const known = new Set(mine.people.map((p) => p.id))

  for (const other of others) {
    if (other.tree.id === mine.tree.id) continue
    // Only pull in a tree we are actually joined to, or the "new relatives"
    // list would fill up with strangers.
    const joined = confirmed.some((l) => l.tree_a === other.tree.id || l.tree_b === other.tree.id)
    if (!joined) continue

    for (const p of other.people) {
      if (alias.has(p.id) || known.has(p.id)) continue
      known.add(p.id)
      people.push(p)
    }
    for (const u of other.unions) {
      unions.push({ ...u, partner_a: resolve(u.partner_a), partner_b: resolve(u.partner_b) })
    }
    for (const c of other.children) {
      children.push({ ...c, person_id: resolve(c.person_id) as string })
    }
  }

  // A person joined from both sides can end up with two birth unions. The
  // graph keeps the first, which is mine — my own records win over an import.
  return { tree: mine.tree, people, unions, children, members: mine.members }
}

/** Which tree in a link is not mine. */
export const otherTreeId = (link: MatchLink, myTreeId: string): string =>
  link.tree_a === myTreeId ? link.tree_b : link.tree_a

/** Which person in a link is the one in my tree. */
export const myPersonIn = (link: MatchLink, myTreeId: string): string =>
  link.tree_a === myTreeId ? link.person_a : link.person_b
