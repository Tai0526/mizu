import type { Union } from '../types'
import { ancestorDepths, type FamilyGraph } from './graph'

// ─────────────────────────────────────────────────────────────────────────────
// Turning the family graph into a drawn tree.
//
// Two layouts share the machinery here:
//
//  · layoutTree — a plain top-down chart from one ancestral root. Used when
//    nobody has said which person is "me".
//
//  · layoutFamily — the main view. You and your parents stand in the middle;
//    your mother's people spread to the left, your father's to the right. Each
//    wing runs from the grandparents' generation (and their brothers and
//    sisters) down through your aunts and uncles to your cousins, and a long
//    branch swings from each wing in to the parent it belongs to.
//
// Connectors are stored as endpoints, not path strings, and rendered as curves
// — which is what makes the chart read as a living tree rather than a wiring
// diagram. The unit that has children is a couple, so each block is a row of
// cards with the descendants of each marriage fanned out beneath it.
// ─────────────────────────────────────────────────────────────────────────────

export const CARD_W = 176
export const CARD_H = 100
const SPOUSE_GAP = 28 // gap between partner cards, spanned by the marriage bar
const SIB_GAP = 34 // gap between sibling subtrees
const GROUP_GAP = 56 // extra gap between the children of two different marriages
const ROW_GAP = 112 // vertical breathing room between generations
export const ROW_H = CARD_H + ROW_GAP
const WING_GAP = 120 // clearance between a wing and the centre column

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
  kind: 'marriage' | 'branch'
  x1: number
  y1: number
  x2: number
  y2: number
  /** Marriage routed under the row (a third partner) dips to this y. */
  dip?: number
  /** Row the branch lands on — older branches are drawn thicker. */
  row: number
}

export interface Layout {
  cards: LaidCard[]
  edges: LaidEdge[]
  width: number
  height: number
  generations: number
  /** Where each person ended up, for centring the viewport on someone. */
  index: Map<string, LaidCard>
  /** Where each union's children hang from — used to graft wings on. */
  anchors: Map<string, { x: number; y: number }>
}

interface Block {
  width: number
  centerX: number
  cards: LaidCard[]
  edges: LaidEdge[]
  anchors: Map<string, { x: number; y: number }>
  maxGeneration: number
}

const shiftX = (block: Block, dx: number): Block => ({
  ...block,
  centerX: block.centerX + dx,
  cards: block.cards.map((c) => ({ ...c, x: c.x + dx })),
  edges: block.edges.map((e) => ({ ...e, x1: e.x1 + dx, x2: e.x2 + dx })),
  anchors: new Map([...block.anchors].map(([k, a]) => [k, { x: a.x + dx, y: a.y }])),
})

interface LayoutOpts {
  /** People left out of the chart entirely (drawn elsewhere, e.g. the centre). */
  skip?: Set<string>
  /** Preferred card order for a union root's partner row. */
  partnerOrder?: string[]
}

interface Ctx {
  g: FamilyGraph
  visited: Set<string>
  skip: Set<string>
}

interface RowMember {
  personId: string
  /** The union that put this partner in the row (absent for the anchor). */
  unionId?: string
  /** Index of the partner this member is married to; defaults to the row's
   *  anchor. Lets one row carry two anchored people — a mother and a father —
   *  each with their own other marriages. */
  partnerIndex?: number
}

/**
 * Packs one generation's row and the children hanging beneath it.
 * Shared by the person recursion and the union-root entry point.
 */
function assemble(
  ctx: Ctx,
  members: RowMember[],
  groups: { union: Union; blocks: Block[] }[],
  generation: number,
  anchorIndex: number,
  keyPrefix: string,
  ghostUnion?: Union,
): Block {
  void ctx
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
  const anchors = new Map<string, { x: number; y: number }>()

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

  members.forEach((m, i) => {
    if (!m.unionId) return
    const mate = m.partnerIndex ?? anchorIndex
    const from = Math.min(mate, i)
    const to = Math.max(mate, i)

    if (to - from === 1) {
      const x1 = cardX(from) + CARD_W
      const x2 = cardX(to)
      edges.push({ key: `m:${m.unionId}`, kind: 'marriage', x1, y1: barY, x2, y2: barY, row: generation })
      anchors.set(m.unionId, { x: (x1 + x2) / 2, y: barY })
    } else {
      // A third or later marriage would have its bar cross the cards in
      // between, so it swings underneath the row instead.
      const dip = rowY + CARD_H + 22
      const x1 = cardCenter(mate)
      const x2 = cardCenter(i)
      edges.push({
        key: `m:${m.unionId}`,
        kind: 'marriage',
        x1,
        y1: rowY + CARD_H,
        x2,
        y2: rowY + CARD_H,
        dip,
        row: generation,
      })
      anchors.set(m.unionId, { x: (x1 + x2) / 2, y: dip })
    }
  })

  // ── Children: one branch per child, fanning out from the couple ────────────
  let cursor = (width - childrenWidth) / 2
  groups.forEach((grp) => {
    const placed: Block[] = []
    for (const block of grp.blocks) {
      placed.push(shiftX(block, cursor))
      cursor += block.width + SIB_GAP
    }
    cursor += GROUP_GAP - SIB_GAP

    for (const block of placed) {
      cards.push(...block.cards)
      edges.push(...block.edges)
      block.anchors.forEach((a, k) => anchors.set(k, a))
    }

    // Where this marriage's branches grow from: the bar if there are two
    // partners, the bottom of the single card if only one parent is known.
    const anchor = anchors.get(grp.union.id) ?? {
      x: ghostUnion ? cardCenter(0) : cardCenter(anchorIndex),
      y: rowY + CARD_H,
    }
    anchors.set(grp.union.id, anchor)

    const childTop = (generation + 1) * ROW_H
    placed.forEach((block, i) => {
      edges.push({
        key: `b:${grp.union.id}:${grp.blocks[i]?.cards[0]?.key ?? i}`,
        kind: 'branch',
        x1: anchor.x,
        y1: anchor.y,
        x2: block.centerX,
        y2: childTop,
        row: generation + 1,
      })
    })
  })

  // A union with no children drawn here still needs a recorded anchor, so a
  // wing can graft onto it later.
  if (!ghostUnion) {
    members.forEach((m) => {
      if (m.unionId && !anchors.has(m.unionId)) {
        anchors.set(m.unionId, { x: cardCenter(anchorIndex), y: rowY + CARD_H })
      }
    })
  }

  const maxGeneration = groups.reduce(
    (max, grp) => Math.max(max, ...grp.blocks.map((b) => b.maxGeneration)),
    generation,
  )

  return {
    width,
    centerX: ghostUnion ? cardCenter(0) : cardCenter(anchorIndex),
    cards,
    edges,
    anchors,
    maxGeneration,
  }
}

function layoutPerson(ctx: Ctx, personId: string, generation: number): Block {
  const { g, visited, skip } = ctx
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
      anchors: new Map(),
      maxGeneration: generation,
    }
  }

  const unions = g.unionsOf(personId)

  // Order the row so the first two marriages sit either side of the anchor,
  // which keeps their marriage bars short and their children directly below.
  const spouseEntries: RowMember[] = []
  for (const u of unions) {
    const spouseId = u.partner_a === personId ? u.partner_b : u.partner_a
    if (spouseId && !skip.has(spouseId)) spouseEntries.push({ personId: spouseId, unionId: u.id })
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
  members.forEach((m) => visited.add(m.personId))

  const groups = unions
    .map((union) => ({
      union,
      blocks: g
        .childrenOfUnion(union.id)
        .filter((child) => !skip.has(child.id))
        .map((child) => layoutPerson(ctx, child.id, generation + 1)),
    }))
    .filter((grp) => grp.blocks.length > 0)

  return assemble(ctx, members, groups, generation, anchorIndex, `p:${personId}`)
}

export interface RootRef {
  kind: 'union' | 'person'
  id: string
}

/** Where a plain chart should start: the highest union or person above `focusId`. */
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

export function layoutTree(g: FamilyGraph, root: RootRef, opts: LayoutOpts = {}): Layout {
  const ctx: Ctx = { g, visited: new Set(opts.skip), skip: opts.skip ?? new Set() }
  let block: Block

  if (root.kind === 'union') {
    const union = g.union(root.id)
    if (!union) return emptyLayout()
    let partners = [union.partner_a, union.partner_b].filter(
      (x): x is string => !!x && !ctx.skip.has(x),
    )
    if (opts.partnerOrder) {
      const order = opts.partnerOrder
      const rank = (id: string) => {
        const at = order.indexOf(id)
        return at < 0 ? 99 : at
      }
      partners = [...partners].sort((a, b) => rank(a) - rank(b))
    }
    partners.forEach((p) => ctx.visited.add(p))

    const members: RowMember[] = partners.map((personId, i) =>
      i === 0 ? { personId } : { personId, unionId: union.id },
    )
    const groups = [
      {
        union,
        blocks: g
          .childrenOfUnion(union.id)
          .filter((c) => !ctx.skip.has(c.id))
          .map((c) => layoutPerson(ctx, c.id, 1)),
      },
    ].filter((grp) => grp.blocks.length > 0)

    block = assemble(
      ctx,
      members,
      groups,
      0,
      0,
      `u:${union.id}`,
      partners.length === 0 ? union : undefined,
    )
  } else {
    block = layoutPerson(ctx, root.id, 0)
  }

  return finish(block)
}

// ─────────────────────────────────────────────────────────────────────────────
// The main view: you in the middle, your mother's people to the left, your
// father's to the right, each wing grafted onto its parent by a long branch.
// ─────────────────────────────────────────────────────────────────────────────

export function layoutFamily(g: FamilyGraph, meId: string): Layout {
  const parentUnion = g.parentUnionOf(meId)
  const parents = g.parentsOf(meId)

  // Nothing recorded above you yet: the plain chart is the honest picture.
  if (!parentUnion || parents.length === 0) {
    const root = findRoot(g, meId) ?? { kind: 'person' as const, id: meId }
    return layoutTree(g, root)
  }

  // Mother to the left, father to the right; unknown sexes keep record order.
  const mother = parents.find((p) => p.sex === 'female')
  const father = parents.find((p) => p.id !== mother?.id && p.sex === 'male')
  const left = mother ?? parents[0]
  const right = father ?? parents.find((p) => p.id !== left.id) ?? null

  const parentIds = parents.map((p) => p.id)

  // ── Centre: both parents with EVERY marriage they had ──────────────────────
  //
  // A father who married three times has children on either side of yours, and
  // they are your half-brothers and half-sisters — leaving them out of the
  // middle of the chart is not a simplification, it is wrong. The row reads:
  // mother's other partners, mother, father, father's other partners, with the
  // children of each marriage hanging beneath the right couple.
  const partnerOf = (u: Union, of: string) => (u.partner_a === of ? u.partner_b : u.partner_a)
  const leftOthers = g.unionsOf(left.id).filter((u) => u.id !== parentUnion.id)
  const rightOthers = right ? g.unionsOf(right.id).filter((u) => u.id !== parentUnion.id) : []

  const centre = (() => {
    const ctx: Ctx = { g, visited: new Set(), skip: new Set() }
    const members: RowMember[] = []

    for (const u of leftOthers) {
      const sp = partnerOf(u, left.id)
      if (sp) members.push({ personId: sp, unionId: u.id })
    }
    const leftIdx = members.length
    members.push({ personId: left.id })
    let rightIdx = -1
    if (right) {
      rightIdx = members.length
      members.push({ personId: right.id, unionId: parentUnion.id, partnerIndex: leftIdx })
      for (const u of rightOthers) {
        const sp = partnerOf(u, right.id)
        if (sp) members.push({ personId: sp, unionId: u.id, partnerIndex: rightIdx })
      }
    }
    // The other partners of the mother marry HER, not the row anchor default.
    for (let i = 0; i < leftIdx; i++) members[i].partnerIndex = leftIdx
    members.forEach((m) => ctx.visited.add(m.personId))

    const unionOrder: Union[] = [...leftOthers, parentUnion, ...rightOthers]
    const groups = unionOrder
      .map((union) => ({
        union,
        blocks: g.childrenOfUnion(union.id).map((c) => layoutPerson(ctx, c.id, 1)),
      }))
      .filter((grp) => grp.blocks.length > 0)

    return finish(assemble(ctx, members, groups, 0, leftIdx, `centre:${parentUnion.id}`))
  })()

  // ── Wings: each parent's family, minus the parent (they stand in the centre)
  const wing = (parentId: string): { layout: Layout; parentRow: number } | null => {
    const birthUnion = g.parentUnionOf(parentId)
    if (!birthUnion) return null // nothing recorded on this side yet

    const root = findRoot(g, parentId)
    if (!root) return null

    const laid = layoutTree(g, root, {
      // The parent stands in the centre; the other parent belongs to the other
      // wing; you and yours belong to the centre.
      skip: new Set([...parentIds, meId]),
    })
    if (!laid.cards.length) return null

    // The row the missing parent would occupy in this wing — the reference
    // that lines the generations up across all three blocks.
    const depths = ancestorDepths(g, parentId)
    let parentRow: number | null = null
    if (root.kind === 'person') {
      const d = depths.get(root.id)
      if (d !== undefined) parentRow = d
    } else {
      for (const child of g.childrenOfUnion(root.id)) {
        if (child.id === parentId) {
          parentRow = 1
          break
        }
        const d = depths.get(child.id)
        if (d !== undefined) {
          parentRow = d + 1
          break
        }
      }
    }
    if (parentRow === null) return null
    return { layout: laid, parentRow }
  }

  const leftWing = wing(left.id)
  const rightWing = right ? wing(right.id) : null

  // Without at least one wing there is nothing to centre between.
  if (!leftWing && !rightWing) return centre

  // ── Vertical alignment: the parents' row is the shared reference ───────────
  const parentsRow = Math.max(leftWing?.parentRow ?? 0, rightWing?.parentRow ?? 0)

  const place = (laid: Layout, rowShift: number, xShift: number): Layout => ({
    ...laid,
    cards: laid.cards.map((c) => ({
      ...c,
      x: c.x + xShift,
      y: c.y + rowShift * ROW_H,
      generation: c.generation + rowShift,
    })),
    edges: laid.edges.map((e) => ({
      ...e,
      x1: e.x1 + xShift,
      x2: e.x2 + xShift,
      y1: e.y1 + rowShift * ROW_H,
      y2: e.y2 + rowShift * ROW_H,
      dip: e.dip === undefined ? undefined : e.dip + rowShift * ROW_H,
      row: e.row + rowShift,
    })),
    anchors: new Map(
      [...laid.anchors].map(([k, a]) => [k, { x: a.x + xShift, y: a.y + rowShift * ROW_H }]),
    ),
  })

  let x = 0
  const blocks: Layout[] = []

  const placedLeft = leftWing ? place(leftWing.layout, parentsRow - leftWing.parentRow, x) : null
  if (placedLeft) {
    blocks.push(placedLeft)
    x += leftWing!.layout.width + WING_GAP
  }

  const placedCentre = place(centre, parentsRow, x)
  blocks.push(placedCentre)
  x += centre.width

  const placedRight = rightWing
    ? place(rightWing.layout, parentsRow - rightWing.parentRow, x + WING_GAP)
    : null
  if (placedRight) {
    blocks.push(placedRight)
    x += WING_GAP + rightWing!.layout.width
  }

  // ── Merge, then graft each wing onto its parent's card ─────────────────────
  const cards = blocks.flatMap((b) => b.cards)
  const edges = blocks.flatMap((b) => b.edges)
  const anchors = new Map<string, { x: number; y: number }>()
  blocks.forEach((b) => b.anchors.forEach((a, k) => anchors.set(k, a)))

  const index = new Map<string, LaidCard>()
  for (const card of cards) {
    if (card.personId && !card.duplicate && !index.has(card.personId)) {
      index.set(card.personId, card)
    }
  }

  const graft = (placedWing: Layout | null, parentId: string) => {
    if (!placedWing) return
    const birthUnion = g.parentUnionOf(parentId)
    const target = index.get(parentId)
    if (!birthUnion || !target) return
    const from = placedWing.anchors.get(birthUnion.id)
    if (!from) return
    edges.push({
      key: `graft:${parentId}`,
      kind: 'branch',
      x1: from.x,
      y1: from.y,
      x2: target.x + CARD_W / 2,
      y2: target.y,
      row: parentsRow,
    })
  }
  graft(placedLeft, left.id)
  if (right) graft(placedRight, right.id)

  const height = Math.max(...cards.map((c) => c.y + CARD_H))
  const generations = Math.max(...cards.map((c) => c.generation)) + 1

  return { cards, edges, width: x, height, generations, index, anchors }
}

function finish(block: Block): Layout {
  const index = new Map<string, LaidCard>()
  for (const card of block.cards) {
    if (card.personId && !card.duplicate && !index.has(card.personId)) index.set(card.personId, card)
  }
  return {
    cards: block.cards,
    edges: block.edges,
    width: block.width,
    height: (block.maxGeneration + 1) * ROW_H - (ROW_H - CARD_H),
    generations: block.maxGeneration + 1,
    index,
    anchors: block.anchors,
  }
}

const emptyLayout = (): Layout => ({
  cards: [],
  edges: [],
  width: 0,
  height: 0,
  generations: 0,
  index: new Map(),
  anchors: new Map(),
})

// ─────────────────────────────────────────────────────────────────────────────
// Rendering the connectors as branches.
// ─────────────────────────────────────────────────────────────────────────────

/** The path for one edge. Branches are S-curves — the difference between a
 *  wiring diagram and something that reads as a bare-branched tree. */
export function edgePath(e: LaidEdge): string {
  if (e.kind === 'marriage') {
    if (e.dip !== undefined) {
      // Routed under the row: a shallow swoop beneath the cards in between.
      return `M ${e.x1} ${e.y1} C ${e.x1} ${e.dip + 26}, ${e.x2} ${e.dip + 26}, ${e.x2} ${e.y2}`
    }
    return `M ${e.x1} ${e.y1} L ${e.x2} ${e.y2}`
  }
  const midY = e.y1 + (e.y2 - e.y1) * 0.55
  return `M ${e.x1} ${e.y1} C ${e.x1} ${midY}, ${e.x2} ${e.y1 + (e.y2 - e.y1) * 0.45}, ${e.x2} ${e.y2}`
}

/** Branch thickness by generation: boughs near the top of the family are
 *  thick, twigs at the youngest generation are thin. */
export function branchWidth(e: LaidEdge, totalRows: number): number {
  if (e.kind === 'marriage') return 2.25
  const t = totalRows <= 1 ? 1 : Math.min(1, Math.max(0, e.row / (totalRows - 1)))
  return 5.5 - 3.6 * t
}
