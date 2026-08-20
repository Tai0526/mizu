import type {
  Account,
  ChildLink,
  MatchLink,
  MemberRole,
  Person,
  Tree,
  TreeData,
  TreeMember,
  Union,
} from '../../types'

/**
 * One interface, two backings.
 *
 * Mizu runs with nothing configured — everything lands in the browser so you can
 * try it in a minute — and switches to a real shared backend the moment Supabase
 * keys exist. Keeping both behind this interface means no screen in the app ever
 * has to know which one it is talking to.
 */
export interface Store {
  readonly mode: 'local' | 'cloud'

  // ── Accounts ───────────────────────────────────────────────────────────────
  currentAccount(): Promise<Account | null>
  signUp(email: string, password: string, displayName: string): Promise<Account>
  signIn(email: string, password: string): Promise<Account>
  signOut(): Promise<void>

  // ── Trees ──────────────────────────────────────────────────────────────────
  listTrees(accountId: string): Promise<Tree[]>
  createTree(name: string, account: Account): Promise<Tree>
  renameTree(treeId: string, name: string): Promise<void>
  loadTree(treeId: string): Promise<TreeData | null>
  /** Every tree the account may compare against when hunting for matches. */
  loadAllTrees(): Promise<TreeData[]>

  // ── Records ────────────────────────────────────────────────────────────────
  savePerson(person: Person): Promise<void>
  deletePerson(personId: string): Promise<void>
  saveUnion(union: Union): Promise<void>
  deleteUnion(unionId: string): Promise<void>
  saveChildLink(link: ChildLink): Promise<void>
  deleteChildLink(linkId: string): Promise<void>
  saveMember(member: TreeMember): Promise<void>

  // ── Cross-tree links ───────────────────────────────────────────────────────
  listMatches(): Promise<MatchLink[]>
  saveMatch(match: MatchLink): Promise<void>

  // ── Photos ─────────────────────────────────────────────────────────────────
  uploadPhoto(personId: string, dataUrl: string): Promise<string>
}

export interface NewPersonInput {
  given_name: string
  family_name: string
  other_names?: string
  sex?: Person['sex']
  birth_year?: number | null
  birth_place?: string
  death_year?: number | null
  living?: boolean
  notes?: string
  photo_url?: string | null
}

export type { Account, ChildLink, MatchLink, MemberRole, Person, Tree, TreeData, TreeMember, Union }
