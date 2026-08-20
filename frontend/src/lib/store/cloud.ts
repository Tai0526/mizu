import type {
  Account,
  ChildLink,
  MatchLink,
  Person,
  Tree,
  TreeMember,
  Union,
} from '../../types'
import { newId, nowIso } from '../id'
import { requireSupabase } from '../supabase'
import type { Store } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// The shared backing.
//
// Same interface as the local store, same record shapes — the difference is
// that these rows are visible to the rest of your family, and that the database
// itself enforces who may read what (see supabase/migrations/0001_init.sql).
// Nothing here re-checks permissions in JavaScript, because a check in the
// browser is a suggestion, not a rule.
// ─────────────────────────────────────────────────────────────────────────────

/** Supabase caps a plain select at 1000 rows, which a large family will pass.
 *  Every full-table read pages until it runs dry. */
async function selectAll<T>(table: string, column: string, value: string): Promise<T[]> {
  const db = requireSupabase()
  const page = 1000
  const out: T[] = []
  for (let from = 0; ; from += page) {
    const { data, error } = await db
      .from(table)
      .select('*')
      .eq(column, value)
      .range(from, from + page - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < page) return out
  }
}

async function selectEverything<T>(table: string): Promise<T[]> {
  const db = requireSupabase()
  const page = 1000
  const out: T[] = []
  for (let from = 0; ; from += page) {
    const { data, error } = await db.from(table).select('*').range(from, from + page - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < page) return out
  }
}

const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message)
}

export function createCloudStore(): Store {
  return {
    mode: 'cloud',

    async currentAccount(): Promise<Account | null> {
      const db = requireSupabase()
      const { data } = await db.auth.getUser()
      const user = data.user
      if (!user) return null
      return {
        id: user.id,
        email: user.email ?? '',
        display_name:
          (user.user_metadata?.display_name as string | undefined) ?? user.email?.split('@')[0] ?? 'You',
        created_at: user.created_at ?? nowIso(),
      }
    },

    async signUp(email, password, displayName) {
      const db = requireSupabase()
      const { data, error } = await db.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: { data: { display_name: displayName.trim() } },
      })
      if (error) throw new Error(error.message)
      if (!data.user) throw new Error('Check your inbox to confirm the account, then sign in.')
      return {
        id: data.user.id,
        email: data.user.email ?? '',
        display_name: displayName.trim(),
        created_at: data.user.created_at ?? nowIso(),
      }
    },

    async signIn(email, password) {
      const db = requireSupabase()
      const { data, error } = await db.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })
      if (error) throw new Error(error.message)
      const user = data.user
      return {
        id: user.id,
        email: user.email ?? '',
        display_name:
          (user.user_metadata?.display_name as string | undefined) ?? user.email?.split('@')[0] ?? 'You',
        created_at: user.created_at ?? nowIso(),
      }
    },

    async signOut() {
      await requireSupabase().auth.signOut()
    },

    async listTrees(_accountId) {
      const db = requireSupabase()
      // Row-level security already limits this to trees the caller belongs to.
      const { data, error } = await db.from('trees').select('*').order('created_at')
      fail(error)
      return (data ?? []) as Tree[]
    },

    async createTree(name, account) {
      const db = requireSupabase()
      const tree: Tree = {
        id: newId('tree'),
        name: name.trim() || `${account.display_name}'s family`,
        description: '',
        created_by: account.id,
        created_at: nowIso(),
      }
      fail((await db.from('trees').insert(tree)).error)
      fail(
        (
          await db.from('tree_members').insert({
            id: newId('mem'),
            tree_id: tree.id,
            user_id: account.id,
            display_name: account.display_name,
            role: 'owner',
            person_id: null,
            created_at: nowIso(),
          })
        ).error,
      )
      return tree
    },

    async renameTree(treeId, name) {
      fail((await requireSupabase().from('trees').update({ name }).eq('id', treeId)).error)
    },

    async loadTree(treeId) {
      const db = requireSupabase()
      const { data, error } = await db.from('trees').select('*').eq('id', treeId).maybeSingle()
      fail(error)
      if (!data) return null
      const [people, unions, children, members] = await Promise.all([
        selectAll<Person>('people', 'tree_id', treeId),
        selectAll<Union>('unions', 'tree_id', treeId),
        selectAll<ChildLink>('child_links', 'tree_id', treeId),
        selectAll<TreeMember>('tree_members', 'tree_id', treeId),
      ])
      return { tree: data as Tree, people, unions, children, members }
    },

    async loadAllTrees() {
      // Matching has to see across families, so this reads the *_discovery
      // views rather than the tables. Those expose names, years, sex and the
      // shape of the relationships — never photos, notes, or who claimed whom —
      // and only for trees whose owners left discovery switched on. Reading the
      // tables directly here would quietly hand every family's private details
      // to every account on the service.
      const [trees, people, unions, children] = await Promise.all([
        selectEverything<Tree>('trees_discovery'),
        selectEverything<Person>('people_discovery'),
        selectEverything<Union>('unions_discovery'),
        selectEverything<ChildLink>('child_links_discovery'),
      ])
      // The views return fewer columns than a Person has. Filling the gaps
      // explicitly keeps the rest of the app from reading undefined off a
      // record that merely looks complete.
      const asPerson = (row: Person): Person => ({
        ...row,
        other_names: row.other_names ?? '',
        birth_place: row.birth_place ?? '',
        photo_url: null,
        notes: '',
        claimed_by: null,
        created_by: '',
        updated_at: row.created_at,
      })

      return trees.map((tree) => ({
        tree: { ...tree, description: tree.description ?? '', created_by: tree.created_by ?? '' },
        people: people.filter((p) => p.tree_id === tree.id).map(asPerson),
        unions: unions.filter((u) => u.tree_id === tree.id),
        children: children.filter((c) => c.tree_id === tree.id),
        members: [],
      }))
    },

    async savePerson(person) {
      fail(
        (await requireSupabase().from('people').upsert({ ...person, updated_at: nowIso() })).error,
      )
    },

    async deletePerson(personId) {
      // The foreign keys in the migration cascade the edges, so one delete is
      // enough and there is no window where half the graph points at a ghost.
      fail((await requireSupabase().from('people').delete().eq('id', personId)).error)
    },

    async saveUnion(union) {
      fail((await requireSupabase().from('unions').upsert(union)).error)
    },

    async deleteUnion(unionId) {
      fail((await requireSupabase().from('unions').delete().eq('id', unionId)).error)
    },

    async saveChildLink(link) {
      const db = requireSupabase()
      fail((await db.from('child_links').delete().eq('person_id', link.person_id)).error)
      fail((await db.from('child_links').insert(link)).error)
    },

    async deleteChildLink(linkId) {
      fail((await requireSupabase().from('child_links').delete().eq('id', linkId)).error)
    },

    async saveMember(member) {
      fail((await requireSupabase().from('tree_members').upsert(member)).error)
    },

    async listMatches() {
      const { data, error } = await requireSupabase().from('match_links').select('*')
      fail(error)
      return (data ?? []) as MatchLink[]
    },

    async saveMatch(match) {
      fail((await requireSupabase().from('match_links').upsert(match)).error)
    },

    async uploadPhoto(personId, dataUrl) {
      const db = requireSupabase()
      const blob = await (await fetch(dataUrl)).blob()
      const path = `${personId}/${newId()}.jpg`
      const { error } = await db.storage
        .from('photos')
        .upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: true })
      if (error) throw new Error(error.message)
      const { data } = db.storage.from('photos').getPublicUrl(path)
      return data.publicUrl
    },
  }
}
