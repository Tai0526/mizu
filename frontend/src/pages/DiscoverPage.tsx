import { Check, Link2, Loader2, Sparkles, TreeDeciduous, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Avatar, Banner, Empty, Spinner } from '../components/ui'
import { buildGraph, fullName, lifespan } from '../lib/graph'
import { newId, nowIso } from '../lib/id'
import { joinTrees } from '../lib/join'
import { kinship, sentenceCase } from '../lib/kinship'
import { confidenceLabel, findCandidates, type Candidate } from '../lib/matching'
import { store } from '../lib/store'
import { useAuth } from '../state/AuthContext'
import { useTree } from '../state/TreeContext'
import type { MatchLink, Person, TreeData } from '../types'

/**
 * The reason Mizu is not a private notebook.
 *
 * Nothing on this page happens automatically. It reads across the trees it can
 * see, points at pairs of records that look like the same human, shows its
 * reasoning in words, and waits. Confirming links the two trees; it does not
 * merge them, and either side can say no.
 */
export function DiscoverPage() {
  const { account } = useAuth()
  const { data, trees, mePersonId, liveVersion } = useTree()
  const [allTrees, setAllTrees] = useState<TreeData[]>([])
  const [matches, setMatches] = useState<MatchLink[]>([])
  const [loading, setLoading] = useState(true)
  const [busyPair, setBusyPair] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [everything, links] = await Promise.all([store.loadAllTrees(), store.listMatches()])
      setAllTrees(everything)
      setMatches(links)
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not look for matches just now.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // A proposal answered on another phone, or a new person recorded anywhere we
  // can see, lands here without anyone pulling to refresh.
  useEffect(() => {
    if (liveVersion > 0) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveVersion])

  const myTreeIds = useMemo(() => new Set(trees.map((t) => t.id)), [trees])

  const decided = useMemo(
    () => new Set(matches.map((m) => [m.person_a, m.person_b].sort().join('|'))),
    [matches],
  )

  const candidates = useMemo(() => {
    if (!data) return []
    return findCandidates(data, allTrees, { excludePairs: decided })
  }, [data, allTrees, decided])

  const confirmed = useMemo(
    () =>
      matches.filter(
        (m) => m.status === 'confirmed' && (m.tree_a === data?.tree.id || m.tree_b === data?.tree.id),
      ),
    [matches, data],
  )

  // The other family says one of your people is one of theirs. This is the
  // moment the user called "the merge" — nothing joins until you say yes here.
  const incoming = useMemo(
    () =>
      matches.filter(
        (m) =>
          m.status === 'proposed' &&
          m.proposed_by !== account?.id &&
          (m.tree_a === data?.tree.id || m.tree_b === data?.tree.id),
      ),
    [matches, account, data],
  )

  const awaitingThem = useMemo(
    () =>
      matches.filter(
        (m) =>
          m.status === 'proposed' &&
          m.proposed_by === account?.id &&
          (m.tree_a === data?.tree.id || m.tree_b === data?.tree.id),
      ),
    [matches, account, data],
  )

  // Relatives that only exist on the other side of a confirmed link — the
  // actual payoff, named and labelled rather than left as "8 records imported".
  const newRelatives = useMemo(() => {
    if (!data || !mePersonId || !confirmed.length) return []
    const joined = joinTrees(data, allTrees, confirmed)
    const graph = buildGraph(joined)
    const mineAlready = new Set(data.people.map((p) => p.id))

    // Someone I have already written down myself will also be sitting in the
    // other tree as a separate record until that pair is linked too. Listing
    // them as "not recorded" would be untrue, so they are matched out by name
    // and year rather than by id.
    const mineByName = new Set(
      data.people.map((p) => `${fullName(p).toLowerCase()}|${p.birth_year ?? ''}`),
    )

    return joined.people
      .filter((p) => !mineAlready.has(p.id))
      .filter((p) => !mineByName.has(`${fullName(p).toLowerCase()}|${p.birth_year ?? ''}`))
      .map((person) => ({ person, kin: kinship(graph, mePersonId, person.id) }))
      .filter((row) => row.kin.category !== 'unrelated')
      .sort((a, b) => (a.kin.up ?? 9) + (a.kin.down ?? 9) - ((b.kin.up ?? 9) + (b.kin.down ?? 9)))
  }, [data, allTrees, confirmed, mePersonId])

  const respond = async (link: MatchLink, agreed: boolean) => {
    if (!account) return
    setBusyPair(link.id)
    try {
      const updated: MatchLink = {
        ...link,
        status: agreed ? 'confirmed' : 'declined',
        responded_by: account.id,
      }
      await store.saveMatch(updated)
      setMatches((prev) => prev.map((m) => (m.id === link.id ? updated : m)))
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That could not be saved.')
    } finally {
      setBusyPair(null)
    }
  }

  const decide = async (candidate: Candidate, agreed: boolean) => {
    if (!data || !account) return
    const pairKey = [candidate.mine.id, candidate.theirs.id].sort().join('|')
    setBusyPair(pairKey)
    try {
      // When both trees are yours there is nobody to negotiate with, so the
      // link takes effect at once. Across accounts it waits for the other side.
      const bothMine = myTreeIds.has(candidate.theirTree.tree.id)
      const link: MatchLink = {
        id: newId('mch'),
        person_a: candidate.mine.id,
        tree_a: data.tree.id,
        person_b: candidate.theirs.id,
        tree_b: candidate.theirTree.tree.id,
        status: !agreed ? 'declined' : bothMine ? 'confirmed' : 'proposed',
        score: candidate.score,
        reasons: candidate.reasons,
        proposed_by: account.id,
        responded_by: bothMine || !agreed ? account.id : null,
        created_at: nowIso(),
      }
      await store.saveMatch(link)
      setMatches((prev) => [...prev, link])
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That could not be saved.')
    } finally {
      setBusyPair(null)
    }
  }

  if (loading) return <Spinner label="Comparing your family against the others…" />

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold">Matches</h1>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted">
          When somebody else records a person you have already written down, that is a doorway into
          a whole branch you have never met. Mizu never joins anything by itself — it shows you why
          it thinks two records are one person, and you decide.
        </p>
      </header>

      {problem && (
        <div className="mb-5">
          <Banner tone="error" onDismiss={() => setProblem(null)}>{problem}</Banner>
        </div>
      )}

      {newRelatives.length > 0 && (
        <section className="mb-8">
          <h2 className="label mb-2.5">
            Relatives you had not recorded ({newRelatives.length})
          </h2>
          <div className="card divide-y divide-line overflow-hidden">
            {newRelatives.slice(0, 25).map(({ person, kin }) => (
              <div key={person.id} className="flex items-center gap-3 px-3.5 py-3">
                <Avatar person={person} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-semibold">{fullName(person)}</p>
                  <p className="truncate text-[12.5px] text-muted">
                    {lifespan(person) || 'Dates unknown'}
                  </p>
                </div>
                <span className="chip-leaf shrink-0">{sentenceCase(kin.short)}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[12.5px] text-muted">
            These come from a tree you are linked to. They stay in their owner&rsquo;s tree — copy
            anyone across by adding them to yours.
          </p>
        </section>
      )}

      {incoming.length > 0 && (
        <section className="mb-8">
          <h2 className="label mb-2.5">A family is asking you ({incoming.length})</h2>
          <div className="space-y-3">
            {incoming.map((link) => {
              const mine = data?.people.find((p) => p.id === link.person_a || p.id === link.person_b)
              const otherId = link.tree_a === data?.tree.id ? link.tree_b : link.tree_a
              const other = allTrees.find((t) => t.tree.id === otherId)
              return (
                <article key={link.id} className="card overflow-hidden border-leaf/40">
                  <div className="flex items-center gap-3 px-4 py-3.5">
                    <Avatar person={mine} size={44} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] leading-snug">
                        <strong>{other?.tree.name ?? 'Another family'}</strong> says your{' '}
                        <strong>{fullName(mine)}</strong> is the same person as theirs.
                      </p>
                      <p className="mt-0.5 text-[12px] text-muted">
                        {confidenceLabel(link.score)} · {link.score}% match
                      </p>
                    </div>
                  </div>
                  {link.reasons.length > 0 && (
                    <ul className="space-y-1 border-t border-line px-4 py-3">
                      {link.reasons.map((reason) => (
                        <li key={reason} className="flex gap-2 text-[12.5px] text-muted">
                          <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-leaf" />
                          {reason}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
                    <button
                      onClick={() => void respond(link, true)}
                      disabled={busyPair === link.id}
                      className="btn-primary btn-sm"
                    >
                      {busyPair === link.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                      Accept — join our trees
                    </button>
                    <button
                      onClick={() => void respond(link, false)}
                      disabled={busyPair === link.id}
                      className="btn-ghost btn-sm text-muted"
                    >
                      <X size={14} /> Different people
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
          <p className="mt-2 text-[12.5px] text-muted">
            Accepting links the two trees: both families see across, including phone numbers where
            they have been added. Your records stay yours, and either side can step back later.
          </p>
        </section>
      )}

      {awaitingThem.length > 0 && (
        <section className="mb-8">
          <h2 className="label mb-2.5">Waiting on the other family ({awaitingThem.length})</h2>
          <div className="card divide-y divide-line overflow-hidden">
            {awaitingThem.map((link) => {
              const person = data?.people.find(
                (p) => p.id === link.person_a || p.id === link.person_b,
              )
              return (
                <div key={link.id} className="flex items-center gap-3 px-3.5 py-3 text-sm">
                  <Link2 size={15} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate">
                    You said <strong>{fullName(person)}</strong> is the same person. They have not
                    answered yet.
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="label mb-2.5">Possible matches ({candidates.length})</h2>
        {!candidates.length ? (
          <Empty icon={<Sparkles size={22} />} title="Nothing to compare yet">
            {allTrees.length <= 1
              ? 'Matches appear once another family records someone you both know. Ask a cousin to start their tree.'
              : 'No records look close enough to be the same person right now. As your tree grows, this fills up.'}
          </Empty>
        ) : (
          <div className="space-y-3">
            {candidates.slice(0, 20).map((candidate) => {
              const pairKey = [candidate.mine.id, candidate.theirs.id].sort().join('|')
              return (
                <article key={pairKey} className="card overflow-hidden">
                  <div className="flex items-center justify-between gap-2 border-b border-line bg-canvas/60 px-4 py-2">
                    <span className="text-[12.5px] font-semibold text-leaf">
                      {confidenceLabel(candidate.score)}
                    </span>
                    <span className="chip tabular-nums">{candidate.score}% match</span>
                  </div>

                  <div className="grid gap-3 px-4 py-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                    <Side person={candidate.mine} caption="In your tree" />
                    <div className="hidden h-9 w-9 place-items-center rounded-full border border-line bg-canvas text-muted sm:grid">
                      <Link2 size={15} />
                    </div>
                    <Side
                      person={candidate.theirs}
                      caption={`In ${candidate.theirTree.tree.name}`}
                    />
                  </div>

                  <ul className="space-y-1 border-t border-line px-4 py-3">
                    {candidate.reasons.map((reason) => (
                      <li key={reason} className="flex gap-2 text-[12.5px] text-muted">
                        <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-leaf" />
                        {reason}
                      </li>
                    ))}
                  </ul>

                  <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
                    <button
                      onClick={() => void decide(candidate, true)}
                      disabled={busyPair === pairKey}
                      className="btn-primary btn-sm"
                    >
                      {busyPair === pairKey ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Check size={14} />
                      )}
                      Yes, the same person
                    </button>
                    <button
                      onClick={() => void decide(candidate, false)}
                      disabled={busyPair === pairKey}
                      className="btn-ghost btn-sm text-muted"
                    >
                      <X size={14} /> Different people
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {confirmed.length > 0 && (
        <section className="mt-8">
          <h2 className="label mb-2.5">Linked families ({confirmed.length})</h2>
          <div className="card divide-y divide-line overflow-hidden">
            {confirmed.map((link) => {
              const otherId = link.tree_a === data?.tree.id ? link.tree_b : link.tree_a
              const other = allTrees.find((t) => t.tree.id === otherId)
              const mine = data?.people.find(
                (p) => p.id === link.person_a || p.id === link.person_b,
              )
              return (
                <button
                  key={link.id}
                  onClick={() => mine && navigate('/', { state: { focus: mine.id } })}
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition hover:bg-leaf-soft"
                >
                  <TreeDeciduous size={16} className="shrink-0 text-leaf" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">
                      {other?.tree.name ?? 'Another family'}
                    </span>
                    <span className="block truncate text-[12.5px] text-muted">
                      Joined through {fullName(mine)}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

function Side({ person, caption }: { person: Person; caption: string }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar person={person} size={44} />
      <div className="min-w-0">
        <p className="truncate text-[14.5px] font-semibold">{fullName(person)}</p>
        <p className="truncate text-[12.5px] text-muted">
          {lifespan(person) || 'Dates unknown'}
          {person.birth_place && ` · ${person.birth_place}`}
        </p>
        <p className="mt-0.5 truncate text-[11px] uppercase tracking-wide text-muted/80">{caption}</p>
      </div>
    </div>
  )
}
