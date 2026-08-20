import type { ChildLink, Person, Sex, Tree, TreeData, Union, UnionStatus } from '../types'
import { newId, nowIso } from './id'

// ─────────────────────────────────────────────────────────────────────────────
// An example family, for anyone who wants to see what a filled-in tree looks
// like before typing their own in.
//
// It is deliberately the shape people actually describe when they explain their
// family: a grandmother and her five brothers and sisters, who they each
// married, the children that came from those marriages, and the generation
// below that — which is where first cousins, second cousins and "once removed"
// stop being abstractions.
//
// Nobody's parents are named at the top. That is on purpose: it is the normal
// state of a real family's memory, and the sibling group still holds without it.
// ─────────────────────────────────────────────────────────────────────────────

interface Draft {
  given: string
  family: string
  sex: Sex
  birth?: number
  death?: number
  place?: string
  notes?: string
}

function builder(treeId: string, createdBy: string) {
  const people: Person[] = []
  const unions: Union[] = []
  const children: ChildLink[] = []

  const person = (d: Draft): Person => {
    const p: Person = {
      id: newId('per'),
      tree_id: treeId,
      given_name: d.given,
      family_name: d.family,
      other_names: '',
      sex: d.sex,
      birth_year: d.birth ?? null,
      birth_place: d.place ?? '',
      death_year: d.death ?? null,
      living: d.death == null,
      photo_url: null,
      notes: d.notes ?? '',
      claimed_by: null,
      created_by: createdBy,
      created_at: nowIso(),
      updated_at: nowIso(),
    }
    people.push(p)
    return p
  }

  const union = (
    a: Person | null,
    b: Person | null,
    status: UnionStatus = 'married',
    year?: number,
  ): Union => {
    const u: Union = {
      id: newId('uni'),
      tree_id: treeId,
      partner_a: a?.id ?? null,
      partner_b: b?.id ?? null,
      status,
      year: year ?? null,
      created_at: nowIso(),
    }
    unions.push(u)
    return u
  }

  const kids = (u: Union, ...list: Person[]) => {
    for (const p of list) {
      children.push({
        id: newId('cld'),
        tree_id: treeId,
        union_id: u.id,
        person_id: p.id,
        relation: 'biological',
        created_at: nowIso(),
      })
    }
  }

  return { people, unions, children, person, union, kids }
}

export interface SeedResult {
  data: TreeData
  /** The person the demo treats as "you", so relationships have a viewpoint. */
  mePersonId: string
}

export function buildExampleFamily(tree: Tree, accountId: string): SeedResult {
  const b = builder(tree.id, accountId)
  const { person, union, kids } = b

  // ── The grandparents' generation ───────────────────────────────────────────
  const beatrice = person({ given: 'Beatrice', family: 'Mwansa', sex: 'female', birth: 1948, place: 'Kasama' })
  const grace = person({ given: 'Grace', family: 'Mwansa', sex: 'female', birth: 1950, place: 'Kasama' })
  const josephat = person({ given: 'Josephat', family: 'Mwansa', sex: 'male', birth: 1953, death: 2019, place: 'Kasama' })
  const agnes = person({ given: 'Agnes', family: 'Mwansa', sex: 'female', birth: 1956, place: 'Kasama' })
  const christopher = person({ given: 'Christopher', family: 'Mwansa', sex: 'male', birth: 1959, place: 'Kasama' })

  // Their parents' names are lost, but they were unmistakably siblings.
  const mwansaHome = union(null, null, 'partners')
  kids(mwansaHome, beatrice, grace, josephat, agnes, christopher)

  const elias = person({
    given: 'Elias', family: 'Chanda', sex: 'male', birth: 1945, death: 2012, place: 'Ndola',
    notes: 'Worked on the railways for thirty-one years.',
  })
  const peter = person({ given: 'Peter', family: 'Zulu', sex: 'male', birth: 1947 })
  const mary = person({ given: 'Mary', family: 'Phiri', sex: 'female', birth: 1958 })
  const ruth = person({ given: 'Ruth', family: 'Banda', sex: 'female', birth: 1962 })

  const gBeatrice = union(beatrice, elias, 'widowed', 1969)
  const gGrace = union(grace, peter, 'married', 1972)
  const gJosephat = union(josephat, mary, 'married', 1980)
  const gChristopher = union(christopher, ruth, 'married', 1988)
  // Agnes never married — a family tree that cannot say that is not much use.

  // ── The parents' generation ────────────────────────────────────────────────
  const mercy = person({ given: 'Mercy', family: 'Chanda', sex: 'female', birth: 1972 })
  const bwalya = person({ given: 'Bwalya', family: 'Chanda', sex: 'male', birth: 1975 })
  const chileshe = person({ given: 'Chileshe', family: 'Chanda', sex: 'female', birth: 1978 })
  kids(gBeatrice, mercy, bwalya, chileshe)

  const aaron = person({ given: 'Aaron', family: 'Zulu', sex: 'male', birth: 1974 })
  const linda = person({ given: 'Linda', family: 'Zulu', sex: 'female', birth: 1977 })
  kids(gGrace, aaron, linda)

  const kelvin = person({ given: 'Kelvin', family: 'Mwansa', sex: 'male', birth: 1982 })
  kids(gJosephat, kelvin)

  const temwani = person({ given: 'Temwani', family: 'Mwansa', sex: 'female', birth: 1990 })
  kids(gChristopher, temwani)

  const lawrence = person({ given: 'Lawrence', family: 'Tembo', sex: 'male', birth: 1970 })

  // Lawrence's side — the father's wing of the chart. His parents' names are
  // gone too, but his brother and sister are not.
  const moses = person({ given: 'Moses', family: 'Tembo', sex: 'male', birth: 1965 })
  const esther = person({ given: 'Esther', family: 'Tembo', sex: 'female', birth: 1973 })
  const temboHome = union(null, null, 'partners')
  kids(temboHome, moses, lawrence, esther)

  const brenda = person({ given: 'Brenda', family: 'Musonda', sex: 'female', birth: 1969 })
  const gMoses = union(moses, brenda, 'married', 1992)
  const daliso = person({ given: 'Daliso', family: 'Tembo', sex: 'male', birth: 1995 })
  const thandiwe = person({ given: 'Thandiwe', family: 'Tembo', sex: 'female', birth: 1999 })
  kids(gMoses, daliso, thandiwe)

  const joyce = person({ given: 'Joyce', family: 'Sakala', sex: 'female', birth: 1979 })
  const faith = person({ given: 'Faith', family: 'Mulenga', sex: 'female', birth: 1978 })

  const pMercy = union(mercy, lawrence, 'married', 1996)
  const pBwalya = union(bwalya, joyce, 'married', 2002)
  const pAaron = union(aaron, faith, 'married', 2000)

  // ── This generation ────────────────────────────────────────────────────────
  const natasha = person({
    given: 'Natasha', family: 'Tembo', sex: 'female', birth: 1998, place: 'Lusaka',
    notes: 'Started this tree after a funeral where she recognised almost nobody.',
  })
  const mubita = person({ given: 'Mubita', family: 'Tembo', sex: 'male', birth: 2001 })
  kids(pMercy, natasha, mubita)

  const kondwani = person({ given: 'Kondwani', family: 'Chanda', sex: 'male', birth: 2004 })
  const chipo = person({ given: 'Chipo', family: 'Chanda', sex: 'female', birth: 2007 })
  kids(pBwalya, kondwani, chipo)

  const sipho = person({ given: 'Sipho', family: 'Zulu', sex: 'male', birth: 2002 })
  kids(pAaron, sipho)

  return {
    data: { tree, people: b.people, unions: b.unions, children: b.children, members: [] },
    mePersonId: natasha.id,
  }
}

/**
 * A second, separate family that overlaps with the first through one shared
 * grandmother. It exists so the Discover screen has something real to find on a
 * fresh install — which is the only honest way to demonstrate the feature the
 * whole idea rests on.
 */
export function buildNeighbourFamily(tree: Tree, accountId: string): TreeData {
  const b = builder(tree.id, accountId)
  const { person, union, kids } = b

  // The same Grace Mwansa as above, entered independently by a different family
  // with slightly different details — exactly how a real match turns up.
  const grace = person({ given: 'Grace', family: 'Mwansa', sex: 'female', birth: 1950, place: 'Kasama' })
  const peter = person({ given: 'Peter', family: 'Zulu', sex: 'male', birth: 1947 })
  const home = union(grace, peter, 'married', 1972)

  const aaron = person({ given: 'Aaron', family: 'Zulu', sex: 'male', birth: 1974 })
  const linda = person({ given: 'Linda', family: 'Zulu', sex: 'female', birth: 1977 })
  kids(home, aaron, linda)

  const faith = person({ given: 'Faith', family: 'Mulenga', sex: 'female', birth: 1978 })
  const aaronHome = union(aaron, faith, 'married', 2000)

  const sipho = person({ given: 'Sipho', family: 'Zulu', sex: 'male', birth: 2002 })
  const naomi = person({ given: 'Naomi', family: 'Zulu', sex: 'female', birth: 2005 })
  kids(aaronHome, sipho, naomi)

  // Linda's side, which the first family has never met.
  const gift = person({ given: 'Gift', family: 'Sichone', sex: 'male', birth: 1975 })
  const lindaHome = union(linda, gift, 'married', 2003)
  const mapalo = person({ given: 'Mapalo', family: 'Sichone', sex: 'female', birth: 2006 })
  const chanda = person({ given: 'Chanda', family: 'Sichone', sex: 'male', birth: 2009 })
  kids(lindaHome, mapalo, chanda)

  return { tree, people: b.people, unions: b.unions, children: b.children, members: [] }
}
