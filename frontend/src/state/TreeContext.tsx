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
import { newId, nowIso } from '../lib/id'
import { applyWrites, connect, makePerson, type Relation } from '../lib/ops'
import { buildExampleFamily, buildNeighbourFamily } from '../lib/seed'
import { store } from '../lib/store'
import type { NewPersonInput } from '../lib/store/types'
import type { Person, Tree, TreeData, Union, UnionStatus } from '../types'
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
}

interface TreeValue {
  trees: Tree[]
  tree: Tree | null
  data: TreeData | null
  graph: FamilyGraph | null
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
}

const TreeContext = createContext<TreeValue | null>(null)

export function TreeProvider({ children }: { children: ReactNode }) {
  const { account } = useAuth()
  const [trees, setTrees] = useState<Tree[]>([])
  const [activeId, setActiveId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_TREE_KEY),
  )
  const [data, setData] = useState<TreeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const dataRef = useRef<TreeData | null>(null)
  dataRef.current = data

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
  }, [account, activeId])

  useEffect(() => {
    setLoading(true)
    loadTrees().catch((err: Error) => {
      setError(err.message)
      setLoading(false)
    })
  }, [loadTrees])

  const selectTree = useCallback((treeId: string) => {
    localStorage.setItem(ACTIVE_TREE_KEY, treeId)
    setActiveId(treeId)
  }, [])

  const tree = useMemo(() => trees.find((t) => t.id === activeId) ?? null, [trees, activeId])
  const graph = useMemo(() => (data ? buildGraph(data) : null), [data])

  const mePersonId = useMemo(() => {
    if (!data || !account) return null
    const member = data.members.find((m) => m.user_id === account.id)
    if (member?.person_id) return member.person_id
    // Falls back to whichever node claims this account, which is what a
    // confirmed cross-tree match sets.
    return data.people.find((p) => p.claimed_by === account.id)?.id ?? null
  }, [data, account])

  // ── Mutations ──────────────────────────────────────────────────────────────

  /** Applies an optimistic change, persists it, and rolls back if the write fails. */
  const commit = useCallback(
    async (next: TreeData, persist: () => Promise<void>): Promise<boolean> => {
      const previous = dataRef.current
      setData(next)
      try {
        await persist()
        return true
      } catch (err) {
        setData(previous)
        setError(err instanceof Error ? err.message : 'That change could not be saved.')
        return false
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
    async ({ anchorId, relation, input, existingPersonId, unionId, unionStatus }: AddRelativeArgs) => {
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

      const result = connect({ data: current, anchorId, relation, person, unionId, unionStatus })
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
    }),
    [
      trees, tree, data, graph, loading, error, mePersonId,
      selectTree, createTree, loadExampleFamily, addRelative, addFirstPerson,
      updatePerson, removePerson, updateUnion, removeUnion, setMePerson, refresh,
    ],
  )

  return <TreeContext.Provider value={value}>{children}</TreeContext.Provider>
}

export function useTree(): TreeValue {
  const ctx = useContext(TreeContext)
  if (!ctx) throw new Error('useTree must be used inside TreeProvider')
  return ctx
}
