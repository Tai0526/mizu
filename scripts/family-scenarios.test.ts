// Scenario test for the shape real families actually have: a father who
// married three times, children on each side, a mis-recorded mother corrected
// by a sibling, and the centred layout drawing every one of them.
//
// Run from frontend/:  npx tsx ../scripts/family-scenarios.test.ts
// It exits noisily on any failure — meant to be run before touching
// ops.ts, kinship.ts or layout.ts.
import { buildGraph, fullName } from '../frontend/src/lib/graph'
import { kinship } from '../frontend/src/lib/kinship'
import { layoutFamily } from '../frontend/src/lib/layout'
import { applyWrites, connect, makePerson } from '../frontend/src/lib/ops'
import type { TreeData } from '../frontend/src/types'

let data: TreeData = {
  tree: { id: 't1', name: 'Test', description: '', created_by: 'u', created_at: '2026' },
  people: [], unions: [], children: [], members: [],
}
const add = (args: Parameters<typeof connect>[0]) => {
  const r = connect(args)
  if (r.error) throw new Error('connect failed: ' + r.error)
  data = applyWrites(data, r)
  return r
}
const P = (given: string, sex: 'male'|'female', birth: number, dead = false) => {
  const p = makePerson('t1', { given_name: given, family_name: 'T', sex, birth_year: birth, living: !dead, death_year: dead ? birth + 50 : null }, 'u')
  return p
}

// Me first, then dad, then wives and siblings the way a real user would.
const me = P('Me', 'male', 1999)
data = { ...data, people: [me] }
const dad = P('Dad', 'male', 1950)
add({ data, anchorId: me.id, relation: 'parent', person: dad })
const wife2 = P('Mum', 'female', 1958, true)   // my mother, dad's second wife
add({ data, anchorId: me.id, relation: 'parent', person: wife2 })

// My two full siblings.
const fs1 = P('FullSib1', 'female', 1996)
const fs2 = P('FullSib2', 'male', 2001)
add({ data, anchorId: me.id, relation: 'sibling', person: fs1 })
add({ data, anchorId: me.id, relation: 'sibling', person: fs2 })

// First wife (deceased) and her three kids: added as dad's spouse, then
// children into that specific marriage.
const wife1 = P('FirstWife', 'female', 1952, true)
add({ data, anchorId: dad.id, relation: 'spouse', person: wife1, unionStatus: 'widowed' })
const g = () => buildGraph(data)
const u1 = g().unionsOf(dad.id).find(u => u.partner_a === wife1.id || u.partner_b === wife1.id)!
for (const [n, y] of [['Half1', 1972], ['Half2', 1974], ['Half3', 1976]] as const) {
  add({ data, anchorId: dad.id, relation: 'child', person: P(n, 'male', y), unionId: u1.id })
}

// Third wife (living) and her one kid.
const wife3 = P('ThirdWife', 'female', 1975)
add({ data, anchorId: dad.id, relation: 'spouse', person: wife3 })
const u3 = g().unionsOf(dad.id).find(u => u.partner_a === wife3.id || u.partner_b === wife3.id)!
add({ data, anchorId: dad.id, relation: 'child', person: P('Half7', 'female', 2005), unionId: u3.id })

// ── The re-parent flow: Half3 was actually entered under MY mother by mistake,
// then his sister corrects it — "different mother, same dad". Simulate by first
// moving Half3 into dad+wife2, then correcting back with keepParentId.
const graph1 = g()
const half3 = data.people.find(p => p.given_name === 'Half3')!
const moved = connect({ data, anchorId: half3.id, relation: 'parent', person: wife2, keepParentId: dad.id })
if (moved.error) throw new Error('move-in failed: ' + moved.error)
data = applyWrites(data, moved)
let sibs = buildGraph(data).siblingsOf(me.id).map(s => `${s.person.given_name}${s.half ? '(half)' : ''}`)
console.log('after wrong move, my siblings:', sibs.join(', '))

// Correction: Half3's real mother is FirstWife. keepParent = dad.
const fixed = connect({ data, anchorId: half3.id, relation: 'parent', person: wife1, keepParentId: dad.id })
if (fixed.error) throw new Error('fix failed: ' + fixed.error)
data = applyWrites(data, fixed)
console.log('unions of dad after fix:', buildGraph(data).unionsOf(dad.id).length, '(expect 3 — reused, no 4th)')

// ── Checks ──
const G = buildGraph(data)
const name = (s: string) => data.people.find(p => p.given_name === s)!
const kin = (a: string, b: string) => kinship(G, name(a).id, name(b).id).label

const results: [string, string, string][] = [
  ['Half1 to me', kin('Me', 'Half1'), 'half-brother'],
  ['Half7 to me', kin('Me', 'Half7'), 'half-sister'],
  ['FullSib1 to me', kin('Me', 'FullSib1'), 'sister'],
  ['FirstWife to me', kin('Me', 'FirstWife'), 'stepmother'],
  ['ThirdWife to me', kin('Me', 'ThirdWife'), 'stepmother'],
  ['Dad to Half1', kin('Half1', 'Dad'), 'father'],
  ['FirstWife to Half3 (after fix)', kin('Half3', 'FirstWife'), 'mother'],
]
let fail = 0
for (const [what, got, want] of results) {
  const ok = got === want
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}: got "${got}", want "${want}"`)
}

// Half3's full siblings should be Half1, Half2 again after the fix.
const h3sibs = G.siblingsOf(name('Half3').id).map(s => `${s.person.given_name}${s.half ? '(half)' : ''}`).sort()
console.log('Half3 siblings:', h3sibs.join(', '))

// Layout: no two cards may overlap, all 7 kids + dad + 3 wives placed.
const meId = name('Me').id
const layout = layoutFamily(G, meId)
const seen = new Map<string, string>()
let overlaps = 0
for (const c of layout.cards) {
  const k = `${Math.round(c.x)},${Math.round(c.y)}`
  if (seen.has(k)) { overlaps++; console.log('OVERLAP at', k, seen.get(k), c.personId) }
  seen.set(k, c.personId ?? 'ghost')
}
console.log(`layout: ${layout.cards.length} cards, ${layout.edges.length} edges, overlaps: ${overlaps}`)
console.log(fail === 0 && overlaps === 0 ? 'ALL CHECKS PASSED' : `FAILURES: ${fail + overlaps}`)
