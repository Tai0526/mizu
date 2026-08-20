import type { Union } from '../types'
import type { FamilyGraph } from './graph'

// ─────────────────────────────────────────────────────────────────────────────
// Turning the family graph into a drawn chart.
//
// This is a tidy-tree layout adapted for the thing that makes family charts
// awkward: the unit that has children is a *couple*, not a person. So each block
// is a row of cards (someone plus whoever they married) with the descendants of
// each of those marriages laid out underneath, and the row centred over them.
//
// Widths are computed bottom-up. A block reports how wide it is; its parent
// packs the children side by side, then centres the parents' row over the whole
// span. Because every block puts its own row at `depth * ROW_H`, generations
// line up across the entire chart without a second pass.
// ─────────────────────────────────────────────────────────────────────────────

export const CARD_W = 176
export const CARD_H = 100
const SPOUSE_GAP = 28 // gap between partner cards, spanned by the marriage bar
const SIB_GAP = 30 // gap between sibling subtrees
const GROUP_GAP = 56 // extra gap between the children of two different marriages
const ROW_GAP = 104 // vertical breathing room between generations
export const ROW_H = CARD_H + ROW_GAP
const SIB_BAR_DROP = 46 // how far above a generation the sibling bar sits

export interface LaidCard {
  key: string
  personId: string | null
  x: number
  y: number
  generation: number
  /** True on the second and later appearances of someone the chart reaches
   *  twice (it happens: cousins marry). Only the first is expanded. */
  duplicate: boolean
  /** A stand-in for parents nobody has named yet — doubles as an "add" target. */
  ghost: boolean
  ghostUnionId?: string
}

export interface LaidEdge {
  key: string
  d: string
  kind: 'marriage' | 'descent'
}

export interface Layout {
  cards: LaidCard[]
  edges: LaidEdge[]
  width: number
  height: number
  generations: number
  /** Where each person ended up, for centring the viewport on someone. */
  index: Map<string, LaidCard>
}

interface Block {
  width: number
  /** Centre of the block's primary card, relative to the block's left edge. */
  centerX: number
  cards: LaidCard[]
  edges: LaidEdge[]
  maxGeneration: number
}

const shift = (block: Block, dx: number): Block => ({
  ...block,
  centerX: block.centerX + dx,
  cards: block.cards.map((c) => ({ ...c, x: c.x + dx })),
  edges: block.edges.map((e) => ({ ...e, d: shiftPath(e.d, dx) })),
})

/** Paths are emitted with absolute commands only, so shifting is a plain
 *  translate of every x coordinate. Cheaper than re-walking the recursion. */
function shiftPath(d: string, dx: number): string {
  return d.replace(/([MLHV]) ?(-?[\d.]+)(?: (-?[\d.]+))?/g, (_m, cmd, a, b) => {
    if (cmd === 'V') return `V ${a}`
    if (cmd === 'H') return `H ${Number(a) + dx}`
    return `${cmd} ${Number(a) + dx} ${b}`
  })
}

interface RowMember {
  personId: string
  /** The union that put this partner in the row (absent for the anchor). */
  unionId?: string
}

/**
 * Packs one generation's row and the children hanging beneath it.
 * Shared by the person recursion and the root-union entry point.
 */
function assemble(
  members: RowMember[],
  groups: { union: Union; blocks: Block[] }[],
  generation: number,
  anchorIndex: number,
  keyPrefix: string,
  ghostUnion?: Union,
): Block {
  const cardCount = Math.max(members.length, ghostUnion ? 1 : 0)
  const rowWidth = cardCount * CARD_W + Math.max(0, cardCount - 1) * SPOUSE_GAP

  const groupWidths = groups.map(
    (grp) =>
      grp.blocks.reduce((sum, b) => sum + b.width, 0) + Math.max(0, grp.blocks.length - 1) * SIB_GAP,
  )
  const childrenWidth =
    groupWidths.reduce((a, b) => a + b, 0) + Math.max(0, groups.length - 1) * GROUP_GAP

  const width = Math.max(rowWidth, childrenWidth)
  const rowY = generation * ROW_H
  const rowX = (width - rowWidth) / 2

  const cards: LaidCard[] = []
  const edges: LaidEdge[] = []

  // ── The row itself ─────────────────────────────────────────────────────────
  const cardX = (i: number) => rowX + i * (CARD_W + SPOUSE_GAP)
  const cardCenter = (i: number) => cardX(i) + CARD_W / 2

  if (ghostUnion) {
    cards.push({
      key: `${keyPrefix}:ghost`,
      personId: null,
      x: cardX(0),
      y: rowY,
      generation,
      duplicate: false,
      ghost: true,
      ghostUnionId: ghostUnion.id,
    })
  } else {
    members.forEach((m, i) => {
      cards.push({
        key: `${keyPrefix}:${m.personId}:${i}`,
        personId: m.personId,
        x: cardX(i),
        y: rowY,
        generation,
        duplicate: false,
        ghost: false,
      })
    })
  }

  // ── Marriage bars ──────────────────────────────────────────────────────────
  const barY = rowY + CARD_H / 2
  const unionBar = new Map<string, { x: number; y: number }>()

  members.forEach((m, i) => {
    if (!m.unionId) return
    const from = Math.min(anchorIndex, i)
    const to = Math.max(anchorIndex, i)
    const adjacent = to - from === 1

    if (adjacent) {
      const x1 = cardX(from) + CARD_W
      const x2 = cardX(to)
      edges.push({ key: `m:${m.unionId}`, kind: 'marriage', d: `M ${x1} ${barY} H ${x2}` })
      unionBar.set(m.unionId, { x: (x1 + x2) / 2, y: barY })
    } else {
      // A third or later marriage would have its bar cross the cards in
      // between, so it is routed just under the row instead.
      const dip = rowY + CARD_H + 16
      const x1 = cardCenter(anchorIndex)
      const x2 = cardCenter(i)
      edges.push({
        key: `m:${m.unionId}`,
        kind: 'marriage',
        d: `M ${x1} ${rowY + CARD_H} V ${dip} H ${x2} V ${rowY + CARD_H}`,
      })
      unionBar.set(m.unionId, { x: (x1 + x2) / 2, y: dip })
    }
  })

  // ── Children ───────────────────────────────────────────────────────────────
  let cursor = (width - childrenWidth) / 2
  groups.forEach((grp) => {
    const placed: Block[] = []
    for (const block of grp.blocks) {
      placed.push(shift(block, cursor))
      cursor += block.width + SIB_GAP
    }
    cursor += GROUP_GAP - SIB_GAP

    for (const block of placed) {
      cards.push(...block.cards)
      edges.push(...block.edges)
    }

    // Where this marriage drops from: the bar if there are two partners, the
    // bottom of the single card if only one parent is known.
    const anchor = unionBar.get(grp.union.id) ?? {
      x: ghostUnion ? cardCenter(0) : cardCenter(anchorIndex),
      y: rowY + CARD_H,
    }

    const childCenters = placed.map((b) => b.centerX)
    const childTop = (generation + 1) * ROW_H
    const sibY = childTop - SIB_BAR_DROP

    if (childCenters.length === 1 && Math.abs(childCenters[0] - anchor.x) < 0.5) {
      edges.push({
        key: `d:${grp.union.id}:straight`,
        kind: 'descent',
        d: `M ${anchor.x} ${anchor.y} V ${childTop}`,
      })
    } else {
      const left = Math.min(...childCenters, anchor.x)
      const right = Math.max(...childCenters, anchor.x)
      edges.push({
        key: `d:${grp.union.id}:stem`,
        kind: 'descent',
        d: `M ${anchor.x} ${anchor.y} V ${sibY} M ${left} ${sibY} H ${right}`,
      })
      placed.forEach((block, i) => {
        edges.push({
          key: `d:${grp.union.id}:${grp.blocks[i]?.cards[0]?.personId ?? i}`,
          kind: 'descent',
          d: `M ${block.centerX} ${sibY} V ${childTop}`,
        })
      })
    }
  })

  const maxGeneration = groups.reduce(
    (max, grp) => Math.max(max, ...grp.blocks.map((b) => b.maxGeneration)),
    generation,
  )

  return {
    width,
    centerX: ghostUnion ? cardCenter(0) : cardCenter(anchorIndex),
    cards,
    edges,
    maxGeneration,
  }
}

function layoutPerson(
  g: FamilyGraph,
  personId: string,
  generation: number,
  visited: Set<string>,
): Block {
  const alreadyDrawn = visited.has(personId)
  visited.add(personId)

  // Someone reachable by two routes is drawn where they were first placed and
  // flagged here, rather than duplicating an entire branch of the family.
  if (alreadyDrawn) {
    return {
      width: CARD_W,
      centerX: CARD_W / 2,
      cards: [
        {
          key: `dup:${personId}:${generation}`,
          personId,
          x: 0,
          y: generation * ROW_H,
          generation,
          duplicate: true,
          ghost: false,
        },
      ],
      edges: [],
      maxGeneration: generation,
    }
  }

  const unions = g.unionsOf(personId)

  // Order the row so the first two marriages sit either side of the anchor,
  // which keeps their marriage bars short and their children directly below.
  const spouseEntries: RowMember[] = []
  for (const u of unions) {
    const spouseId = u.partner_a === personId ? u.partner_b : u.partner_a
    if (spouseId) spouseEntries.push({ personId: spouseId, unionId: u.id })
  }

  let members: RowMember[]
  let anchorIndex: number
  if (spouseEntries.length <= 1) {
    members = [{ personId }, ...spouseEntries]
    anchorIndex = 0
  } else {
    members = [spouseEntries[0], { personId }, ...spouseEntries.slice(1)]
    anchorIndex = 1
  }

  const groups = unions
    .map((union) => ({
      union,
      blocks: g
        .childrenOfUnion(union.id)
        .map((child) => layoutPerson(g, child.id, generation + 1, visited)),
    }))
    .filter((grp) => grp.blocks.length > 0)

  return assemble(members, groups, generation, anchorIndex, `p:${personId}`)
}

export interface RootRef {
  kind: 'union' | 'person'
  id: string
}

/** Where the chart should start: the highest union or person above `focusId`. */
export function findRoot(g: FamilyGraph, focusId: string): RootRef | null {
  if (!g.person(focusId)) return null
  let current = focusId
  const guard = new Set<string>()

  for (;;) {
    if (guard.has(current)) break
    guard.add(current)
    const parentUnion = g.parentUnionOf(current)
    if (!parentUnion) break
    const parents = g.parentsOf(current)
    if (!parents.length) {
      // Parents unnamed but the sibling group exists — that union is the trunk.
      return { kind: 'union', id: parentUnion.id }
    }
    // Prefer whichever parent has more generations above them.
    const next = parents
      .map((p) => ({ id: p.id, depth: heightAbove(g, p.id) }))
      .sort((a, b) => b.depth - a.depth)[0]
    current = next.id
  }
  return { kind: 'person', id: current }
}

function heightAbove(g: FamilyGraph, id: string, depth = 0, path: string[] = []): number {
  // The guard is the path taken to get here, not a global visited set, so two
  // branches that share an ancestor are each measured in full.
  if (depth > 20 || path.includes(id)) return depth
  const parents = g.parentsOf(id)
  if (!parents.length) return depth
  return Math.max(...parents.map((p) => heightAbove(g, p.id, depth + 1, [...path, id])))
}

export function layoutTree(g: FamilyGraph, root: RootRef): Layout {
  const visited = new Set<string>()
  let block: Block

  if (root.kind === 'union') {
    const union = g.union(root.id)
    if (!union) return emptyLayout()
    const partners = [union.partner_a, union.partner_b].filter((x): x is string => !!x)
    partners.forEach((p) => visited.add(p))

    const members: RowMember[] = partners.map((personId, i) =>
      i === 0 ? { personId } : { personId, unionId: union.id },
    )
    const groups = [
      {
        union,
        blocks: g.childrenOfUnion(union.id).map((c) => layoutPerson(g, c.id, 1, visited)),
      },
    ].filter((grp) => grp.blocks.length > 0)

    block = assemble(
      members,
      groups,
      0,
      0,
      `u:${union.id}`,
      partners.length === 0 ? union : undefined,
    )
  } else {
    block = layoutPerson(g, root.id, 0, visited)
  }

  const index = new Map<string, LaidCard>()
  for (const card of block.cards) {
    if (card.personId && !card.duplicate) index.set(card.personId, card)
  }

  return {
    cards: block.cards,
    edges: block.edges,
    width: block.width,
    height: (block.maxGeneration + 1) * ROW_H - (ROW_H - CARD_H),
    generations: block.maxGeneration + 1,
    index,
  }
}

const emptyLayout = (): Layout => ({
  cards: [],
  edges: [],
  width: 0,
  height: 0,
  generations: 0,
  index: new Map(),
})
