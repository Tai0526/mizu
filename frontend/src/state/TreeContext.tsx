import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { buildGraph, type FamilyGraph } from '../lib/graph'
import { joinTrees } from '../lib/join'
import { newId, nowIso } from '../lib/id'
import { applyWrites, connect, makePerson, type Relation } from '../lib/ops'
import { buildExampleFamily, buildNeighbourFamily } from '../lib/seed'
import { store } from '../lib/store'
import { supabase } from '../lib/supabase'
import type { NewPersonInput } from '../lib/store/types'
import type { MatchLink, Person, Tree, TreeData, Union, UnionStatus } from '../types'
import { useAuth } from './AuthContext'

// ─────────────────────────────────────────────────────────────────────────────
// The one place that owns the tree currently on screen.
//
// Every mutation writes to memory first and to storage second. Adding a cousin
// should feel like drawing, not like submitting a form, and a family sitting
// around a phone comparing notes will add people faster than any round trip.
// If a write fails the optimistic state is rolled back and the error surfaces.
// ─────────────────────────────────────────────────────────────────────────────

const ACTIVE_TREE_KEY = 'mizu.activeTree'

interface AddRelativeArgs {
  anchorId: string
  relation: Relation
  /** Either details for someone new, or the id of someone already recorded. */
  input?: NewPersonInput
  existingPersonId?: string
  unionId?: string
  unionStatus?: UnionStatus
  /** When both parent slots are taken: the existing parent this person shares. */
  keepParentId?: string
}

interface TreeValue {
  trees: Tree[]
  tree: Tree | null
  data: TreeData | null
  /** The graph on screen: your tree, with every confirmed-match family joined
   *  in. Ops always run against `data` — your own records. */
  graph: FamilyGraph | null
  /** Name of the linked family a joined-in person belongs to. */
  treeNameOf: (treeId: string) => string | undefined
  loading: boolean
  error: string | null
  /** The node in this tree that the signed-in account says is them. */
  mePersonId: string | null

  selectTree: (treeId: string) => void
  createTree: (name: string) => Promise<Tree | null>
  loadExampleFamily: () => Promise<void>

  addRelative: (args: AddRelativeArgs) => Promise<Person | null>
  addFirstPerson: (input: NewPersonInput) => Promise<Person | null>
  updatePerson: (person: Person) => Promise<void>
  removePerson: (personId: string) => Promise<void>
  updateUnion: (union: Union) => Promise<void>
  removeUnion: (unionId: string) => Promise<void>
  setMePerson: (personId: string | null) => Promise<void>
  refresh: () => Promise<void>
  dismissError: () => void
  /** Bumps whenever a live change arrives from the backend, so screens that
   *  hold their own copies of shared data know to refetch. */
  liveVersion: number
}

const TreeContext = createContext<TreeValue | null>(null)

export function TreeProvider({ children }: { children: ReactNode }) {
  const { account } = useAuth()
  const [trees, setTrees] = useState<Tree[]>([])
  const [activeId, setActiveId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_TREE_KEY),
  )
  const [data, setData] = useState<TreeData | null>(null)
  const [neighbours, setNeighbours] = useState<TreeData[]>([])
  const [links, setLinks] = useState<MatchLink[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const dataRef = useRef<TreeData | null>(null)
  dataRef.current = data
  const [liveVersion, setLiveVersion] = useState(0)
  /** Writes still on their way to the backend. A live refetch that lands in
   *  that window would read the world WITHOUT the change we just drew, and the
   *  card the user added would flicker out — so refetches wait for zero. */
  const writesInFlight = useRef(0)
  const activeIdRef = useRef<string | null>(null)
  activeIdRef.current = activeId

  // ── Loading ────────────────────────────────────────────────────────────────

  const loadTrees = useCallback(async () => {
    if (!account) {
      setTrees([])
      setData(null)
      setLoading(false)
      return
    }
    const list = await store.listTrees(account.id)
    setTrees(list)

    const wanted = list.find((t) => t.id === activeId) ?? list[0]
    if (!wanted) {
      setData(null)
      setLoading(false)
      return
    }
    if (wanted.id !== activeId) {
      setActiveId(wanted.id)
      localStorage.setItem(ACTIVE_TREE_KEY, wanted.id)
    }
    setData(await store.loadTree(wanted.id))
    setLoading(false)

    // Confirmed matches graft other families onto the chart, so their thin
    // records and the links themselves ride along with every load.
    try {
      const [everything, matchLinks] = await Promise.all([store.loadAllTrees(), store.listMatches()])
      setNeighbours(everything)
      setLinks(matchLinks)
    } catch {
      // Matching data failing to load must never take the tree down with it.
      setNeighbours([])
      setLinks([])
    }
  }, [account, activeId])

  useEffect(() => {
    setLoading(true)
    loadTrees().catch((err: Error) => {
      setError(err.message)
      setLoading(false)
    })
  }, [loadTrees])

  /** Refetch everything without touching the loading flag — live updates
   *  should slide in, not blank the screen. */
  const reloadSilently = useCallback(async () => {
    const id = activeIdRef.current
    if (!id) return
    if (writesInFlight.current > 0) {
      // Try again once our own write settles; its confirmation event will
      // also land here.
      setTimeout(() => void reloadSilently(), 600)
      return
    }
    try {
      const [fresh, everything, matchLinks] = await Promise.all([
        store.loadTree(id),
        store.loadAllTrees(),
        store.listMatches(),
      ])
      if (activeIdRef.current !== id) return
      if (fresh) setData(fresh)
      setNeighbours(everything)
      setLinks(matchLinks)
      setLiveVersion((v) => v + 1)
    } catch {
      // A dropped refetch is invisible; the next event or navigation catches up.
    }
  }, [])

  // ── Live changes ───────────────────────────────────────────────────────────
  //
  // Cloud mode: the database publishes every change a member is allowed to see
  // — an aunt adding a cousin, a family accepting a match — and each event
  // nudges a debounced refetch. Local mode: the browser's storage event does
  // the same across tabs. Either way, nobody reloads anything by hand.
  useEffect(() => {
    if (!account) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const nudge = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void reloadSilently(), 400)
    }

    if (store.mode === 'cloud' && supabase) {
      const sb = supabase
      const channel = sb
        .channel('mizu-live')
        .on('postgres_changes', { event: '*', schema: 'public' }, nudge)
        .subscribe()
      return () => {
        clearTimeout(timer)
        void sb.removeChannel(channel)
      }
    }

    const onStorage = (e: StorageEvent) => {
      if (e.key?.startsWith('mizu.v1.')) nudge()
    }
    window.addEventListener('storage', onStorage)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('storage', onStorage)
    }
  }, [account, reloadSilently])

  const selectTree = useCallback((treeId: string) => {
    localStorage.setItem(ACTIVE_TREE_KEY, treeId)
    setActiveId(treeId)
  }, [])

  const tree = useMemo(() => trees.find((t) => t.id === activeId) ?? null, [trees, activeId])

  const graph = useMemo(() => {
    if (!data) return null
    const confirmed = links.filter(
      (l) => l.status === 'confirmed' && (l.tree_a === data.tree.id || l.tree_b === data.tree.id),
    )
    if (!confirmed.length) return buildGraph(data)
    return buildGraph(joinTrees(data, neighbours, confirmed))
  }, [data, neighbours, links])

  const treeNameOf = useCallback(
    (treeId: string) => neighbours.find((t) => t.tree.id === treeId)?.tree.name,
    [neighbours],
  )

  const mePersonId = useMemo(() => {
    if (!data || !account) return null
    const member = data.members.find((m) => m.user_id === account.id)
    // A claim is only real if the person still exists — someone deleting a
    // record must not leave another account pointing at nothing, because an
    // account with a phantom viewpoint computes no relationship labels at all.
    if (member?.person_id && data.people.some((p) => p.id === member.person_id)) {
      return member.person_id
    }
    return data.people.find((p) => p.claimed_by === account.id)?.id ?? null
  }, [data, account])

  // ── Mutations ──────────────────────────────────────────────────────────────

  /** Applies an optimistic change, persists it, and rolls back if the write fails. */
  const commit = useCallback(
    async (next: TreeData, persist: () => Promise<void>): Promise<boolean> => {
      const previous = dataRef.current
      setData(next)
      writesInFlight.current += 1
      try {
        await persist()
        return true
      } catch (err) {
        setData(previous)
        setError(err instanceof Error ? err.message : 'That change could not be saved.')
        return false
      } finally {
        writesInFlight.current -= 1
      }
    },
    [],
  )

  const createTree = useCallback(
    async (name: string) => {
      if (!account) return null
      try {
        const created = await store.createTree(name, account)
        setTrees((prev) => [...prev, created])
        selectTree(created.id)
        setData(await store.loadTree(created.id))
        return created
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The tree could not be created.')
        return null
      }
    },
    [account, selectTree],
  )

  const loadExampleFamily = useCallback(async () => {
    if (!account) return
    try {
      const tembo = await store.createTree('The Mwansa family', account)
      const seeded = buildExampleFamily(tembo, account.id)

      for (const p of seeded.data.people) await store.savePerson(p)
      for (const u of seeded.data.unions) await store.saveUnion(u)
      for (const c of seeded.data.children) await store.saveChildLink(c)

      // createTree already made the membership row. Update that one rather than
      // adding a second, or the lookup for "which person am I" finds the empty
      // one first and nobody is marked as themselves.
      const fresh = await store.loadTree(tembo.id)
      const existing = fresh?.members.find((m) => m.user_id === account.id)
      await store.saveMember(
        existing
          ? { ...existing, person_id: seeded.mePersonId }
          : {
              id: newId('mem'),
              tree_id: tembo.id,
              user_id: account.id,
              display_name: account.display_name,
              role: 'owner',
              person_id: seeded.mePersonId,
              created_at: nowIso(),
            },
      )

      // A second household that overlaps this one, so Discover has something
      // genuine to surface rather than an empty state pretending to be a feature.
      const zulu = await store.createTree('The Zulu family', account)
      const neighbour = buildNeighbourFamily(zulu, account.id)
      for (const p of neighbour.people) await store.savePerson(p)
      for (const u of neighbour.unions) await store.saveUnion(u)
      for (const c of neighbour.children) await store.saveChildLink(c)

      const list = await store.listTrees(account.id)
      setTrees(list)
      selectTree(tembo.id)
      setData(await store.loadTree(tembo.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The example family could not be loaded.')
    }
  }, [account, selectTree])

  const addFirstPerson = useCallback(
    async (input: NewPersonInput) => {
      const current = dataRef.current
      if (!current || !account) return null
      const person = makePerson(current.tree.id, input, account.id)
      const next = { ...current, people: [...current.people, person] }
      const ok = await commit(next, () => store.savePerson(person))
      return ok ? person : null
    },
    [account, commit],
  )

  const addRelative = useCallback(
    async ({ anchorId, relation, input, existingPersonId, unionId, unionStatus, keepParentId }: AddRelativeArgs) => {
      const current = dataRef.current
      if (!current || !account) return null

      const person = existingPersonId
        ? current.people.find((p) => p.id === existingPersonId)
        : input
          ? makePerson(current.tree.id, input, account.id)
          : undefined

      if (!person) {
        setError('Nothing to add — pick a person or fill in a name.')
        return null
      }

      const result = connect({ data: current, anchorId, relation, person, unionId, unionStatus, keepParentId })
      if (result.error) {
        setError(result.error)
        return null
      }

      const next = applyWrites(current, result)
      const ok = await commit(next, async () => {
        for (const p of result.people) await store.savePerson(p)
        for (const u of [...result.unions, ...result.updatedUnions]) await store.saveUnion(u)
        for (const c of result.children) await store.saveChildLink(c)
      })
      return ok ? person : null
    },
    [account, commit],
  )

  const updatePerson = useCallback(
    async (person: Person) => {
      const current = dataRef.current
      if (!current) return
      const updated = { ...person, updated_at: nowIso() }
      const next = {
        ...current,
        people: current.people.map((p) => (p.id === person.id ? updated : p)),
      }
      await commit(next, () => store.savePerson(updated))
    },
    [commit],
  )

  const removePerson = useCallback(
    async (personId: string) => {
      const current = dataRef.current
      if (!current) return

      // Mirror in memory exactly what the store does to the edges, so the chart
      // is right immediately rather than after a reload.
      const children = current.children.filter((c) => c.person_id !== personId)
      const unions = current.unions
        .map((u) =>
          u.partner_a === personId || u.partner_b === personId
            ? {
                ...u,
                partner_a: u.partner_a === personId ? null : u.partner_a,
                partner_b: u.partner_b === personId ? null : u.partner_b,
              }
            : u,
        )
        .filter((u) => u.partner_a || u.partner_b || children.some((c) => c.union_id === u.id))

      const next: TreeData = {
        ...current,
        people: current.people.filter((p) => p.id !== personId),
        unions,
        children: children.filter((c) => unions.some((u) => u.id === c.union_id)),
        members: current.members.map((m) =>
          m.person_id === personId ? { ...m, person_id: null } : m,
        ),
      }
      await commit(next, () => store.deletePerson(personId))
    },
    [commit],
  )

  const updateUnion = useCallback(
    async (union: Union) => {
      const current = dataRef.current
      if (!current) return
      const next = {
        ...current,
        unions: current.unions.map((u) => (u.id === union.id ? union : u)),
      }
      await commit(next, () => store.saveUnion(union))
    },
    [commit],
  )

  const removeUnion = useCallback(
    async (unionId: string) => {
      const current = dataRef.current
      if (!current) return
      const next = {
        ...current,
        unions: current.unions.filter((u) => u.id !== unionId),
        children: current.children.filter((c) => c.union_id !== unionId),
      }
      await commit(next, () => store.deleteUnion(unionId))
    },
    [commit],
  )

  const setMePerson = useCallback(
    async (personId: string | null) => {
      const current = dataRef.current
      if (!current || !account) return
      const existing = current.members.find((m) => m.user_id === account.id)
      const member = existing
        ? { ...existing, person_id: personId }
        : {
            id: newId('mem'),
            tree_id: current.tree.id,
            user_id: account.id,
            display_name: account.display_name,
            role: 'owner' as const,
            person_id: personId,
            created_at: nowIso(),
          }

      const next: TreeData = {
        ...current,
        members: existing
          ? current.members.map((m) => (m.id === member.id ? member : m))
          : [...current.members, member],
      }
      await commit(next, () => store.saveMember(member))
    },
    [account, commit],
  )

  const refresh = useCallback(async () => {
    if (!activeId) return
    setData(await store.loadTree(activeId))
  }, [activeId])

  const value = useMemo<TreeValue>(
    () => ({
      trees,
      tree,
      data,
      graph,
      treeNameOf,
      loading,
      error,
      mePersonId,
      selectTree,
      createTree,
      loadExampleFamily,
      addRelative,
      addFirstPerson,
      updatePerson,
      removePerson,
      updateUnion,
      removeUnion,
      setMePerson,
      refresh,
      dismissError: () => setError(null),
      liveVersion,
    }),
    [
      trees, tree, data, graph, treeNameOf, loading, error, mePersonId,
      selectTree, createTree, loadExampleFamily, addRelative, addFirstPerson,
      updatePerson, removePerson, updateUnion, removeUnion, setMePerson, refresh,
      liveVersion,
    ],
  )

  return <TreeContext.Provider value={value}>{children}</TreeContext.Provider>
}

export function useTree(): TreeValue {
  const ctx = useContext(TreeContext)
  if (!ctx) throw new Error('useTree must be used inside TreeProvider')
  return ctx
}
