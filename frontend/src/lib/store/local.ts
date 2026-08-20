import type {
  Account,
  ChildLink,
  MatchLink,
  Person,
  Tree,
  TreeData,
  TreeMember,
  Union,
} from '../../types'
import { newId, nowIso } from '../id'
import type { Store } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// The browser-only backing.
//
// This exists so Mizu is usable the second you open it: no project to create,
// no keys to paste, no waiting. Everything lives in localStorage under one
// namespace, and the shape of every record is identical to the Supabase tables,
// so moving to the real backend later is a copy, not a rewrite.
//
// It is a demo store, and honest about it: passwords are hashed but they sit in
// the same browser as the data they protect, and nothing is shared between
// devices. The app says so plainly wherever it matters.
// ─────────────────────────────────────────────────────────────────────────────

const NS = 'mizu.v1'
const key = (name: string) => `${NS}.${name}`

interface StoredAccount extends Account {
  password_hash: string
}

function read<T>(name: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key(name))
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write<T>(name: string, value: T): void {
  try {
    localStorage.setItem(key(name), JSON.stringify(value))
  } catch (err) {
    // Photos are the only thing big enough to hit the quota, and losing a save
    // silently would be worse than saying so.
    throw new Error(
      'This browser is out of local storage space. Remove a photo or two, or connect a Supabase project to store them properly.',
      { cause: err },
    )
  }
}

/** Replaces the record with the same id, or appends it. */
function upsert<T extends { id: string }>(name: string, record: T): void {
  const rows = read<T[]>(name, [])
  const at = rows.findIndex((r) => r.id === record.id)
  if (at >= 0) rows[at] = record
  else rows.push(record)
  write(name, rows)
}

function remove<T extends { id: string }>(name: string, id: string): void {
  write(
    name,
    read<T[]>(name, []).filter((r) => r.id !== id),
  )
}

async function hash(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`mizu:${password}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function createLocalStore(): Store {
  const assemble = (tree: Tree): TreeData => ({
    tree,
    people: read<Person[]>('people', []).filter((p) => p.tree_id === tree.id),
    unions: read<Union[]>('unions', []).filter((u) => u.tree_id === tree.id),
    children: read<ChildLink[]>('children', []).filter((c) => c.tree_id === tree.id),
    members: read<TreeMember[]>('members', []).filter((m) => m.tree_id === tree.id),
  })

  return {
    mode: 'local',

    async currentAccount() {
      const id = localStorage.getItem(key('session'))
      if (!id) return null
      const account = read<StoredAccount[]>('accounts', []).find((a) => a.id === id)
      if (!account) return null
      const { password_hash: _hash, ...safe } = account
      return safe
    },

    async signUp(email, password, displayName) {
      const accounts = read<StoredAccount[]>('accounts', [])
      const normalised = email.trim().toLowerCase()
      if (accounts.some((a) => a.email === normalised)) {
        throw new Error('There is already an account with that email on this device.')
      }
      const account: StoredAccount = {
        id: newId('acc'),
        email: normalised,
        display_name: displayName.trim() || normalised.split('@')[0],
        created_at: nowIso(),
        password_hash: await hash(password),
      }
      accounts.push(account)
      write('accounts', accounts)
      localStorage.setItem(key('session'), account.id)
      const { password_hash: _hash, ...safe } = account
      return safe
    },

    async signIn(email, password) {
      const normalised = email.trim().toLowerCase()
      const account = read<StoredAccount[]>('accounts', []).find((a) => a.email === normalised)
      if (!account || account.password_hash !== (await hash(password))) {
        throw new Error('That email and password do not match an account on this device.')
      }
      localStorage.setItem(key('session'), account.id)
      const { password_hash: _hash, ...safe } = account
      return safe
    },

    async signOut() {
      localStorage.removeItem(key('session'))
    },

    async listTrees(accountId) {
      const members = read<TreeMember[]>('members', []).filter((m) => m.user_id === accountId)
      const ids = new Set(members.map((m) => m.tree_id))
      return read<Tree[]>('trees', []).filter((t) => ids.has(t.id) || t.created_by === accountId)
    },

    async createTree(name, account) {
      const tree: Tree = {
        id: newId('tree'),
        name: name.trim() || `${account.display_name}'s family`,
        description: '',
        created_by: account.id,
        created_at: nowIso(),
      }
      upsert('trees', tree)
      upsert<TreeMember>('members', {
        id: newId('mem'),
        tree_id: tree.id,
        user_id: account.id,
        display_name: account.display_name,
        role: 'owner',
        person_id: null,
        created_at: nowIso(),
      })
      return tree
    },

    async renameTree(treeId, name) {
      const tree = read<Tree[]>('trees', []).find((t) => t.id === treeId)
      if (tree) upsert('trees', { ...tree, name })
    },

    async loadTree(treeId) {
      const tree = read<Tree[]>('trees', []).find((t) => t.id === treeId)
      return tree ? assemble(tree) : null
    },

    async loadAllTrees() {
      return read<Tree[]>('trees', []).map(assemble)
    },

    async savePerson(person) {
      upsert('people', { ...person, updated_at: nowIso() })
    },

    async deletePerson(personId) {
      remove<Person>('people', personId)
      // Clear the edges too, or the graph keeps pointing at someone who is gone.
      write(
        'children',
        read<ChildLink[]>('children', []).filter((c) => c.person_id !== personId),
      )
      const unions = read<Union[]>('unions', [])
      const survivors: Union[] = []
      for (const u of unions) {
        if (u.partner_a !== personId && u.partner_b !== personId) {
          survivors.push(u)
          continue
        }
        const other = u.partner_a === personId ? u.partner_b : u.partner_a
        const stillUsed = read<ChildLink[]>('children', []).some((c) => c.union_id === u.id)
        // A union that still has children stays, so the children keep their
        // remaining parent and each other. An empty one goes.
        if (other || stillUsed) {
          survivors.push({
            ...u,
            partner_a: u.partner_a === personId ? null : u.partner_a,
            partner_b: u.partner_b === personId ? null : u.partner_b,
          })
        }
      }
      write('unions', survivors)
      write(
        'members',
        read<TreeMember[]>('members', []).map((m) =>
          m.person_id === personId ? { ...m, person_id: null } : m,
        ),
      )
    },

    async saveUnion(union) {
      upsert('unions', union)
    },

    async deleteUnion(unionId) {
      remove<Union>('unions', unionId)
      write(
        'children',
        read<ChildLink[]>('children', []).filter((c) => c.union_id !== unionId),
      )
    },

    async saveChildLink(link) {
      // A person belongs to exactly one birth union; re-parenting replaces.
      write(
        'children',
        read<ChildLink[]>('children', []).filter((c) => c.person_id !== link.person_id),
      )
      upsert('children', link)
    },

    async deleteChildLink(linkId) {
      remove<ChildLink>('children', linkId)
    },

    async saveMember(member) {
      upsert('members', member)
    },

    async listMatches() {
      return read<MatchLink[]>('matches', [])
    },

    async saveMatch(match) {
      upsert('matches', match)
    },

    async uploadPhoto(_personId, dataUrl) {
      // Nowhere to upload to — the data URL is already the photo. It gets stored
      // inline on the person record, which is why images are downscaled first.
      return dataUrl
    },
  }
}
