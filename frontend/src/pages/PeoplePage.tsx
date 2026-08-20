import { Search, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Avatar, Empty, Spinner } from '../components/ui'
import { fullName, lifespan } from '../lib/graph'
import { kinBucket, kinship, sentenceCase, type Kinship } from '../lib/kinship'
import { useTree } from '../state/TreeContext'
import type { Person } from '../types'

// The order families actually think in: close first, then outwards.
const BUCKET_ORDER = [
  'You',
  'Your partner',
  'Parents',
  'Brothers and sisters',
  'Children',
  'Grandchildren',
  'Grandparents and above',
  'Aunts and uncles',
  'Nieces and nephews',
  'First cousins',
  'Wider cousins',
  'Family by marriage',
  'Not yet connected',
]

export function PeoplePage() {
  const { graph, mePersonId, loading } = useTree()
  const [query, setQuery] = useState('')
  const navigate = useNavigate()

  const rows = useMemo(() => {
    if (!graph) return []
    const term = query.trim().toLowerCase()
    return graph.people
      .filter((p) => !term || `${fullName(p)} ${p.other_names}`.toLowerCase().includes(term))
      .map((p) => ({
        person: p,
        kin: mePersonId ? kinship(graph, mePersonId, p.id) : null,
      }))
  }, [graph, query, mePersonId])

  const grouped = useMemo(() => {
    const buckets = new Map<string, { person: Person; kin: Kinship | null }[]>()
    for (const row of rows) {
      const name = row.kin ? kinBucket(row.kin) : 'Everyone'
      const list = buckets.get(name) ?? []
      list.push(row)
      buckets.set(name, list)
    }
    return [...buckets.entries()].sort((a, b) => {
      const ai = BUCKET_ORDER.indexOf(a[0])
      const bi = BUCKET_ORDER.indexOf(b[0])
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
    })
  }, [rows])

  if (loading) return <Spinner />
  if (!graph) return null

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <header className="mb-5">
        <h1 className="font-display text-2xl font-bold">Everyone in this tree</h1>
        <p className="mt-1 text-sm text-muted">
          {graph.people.length} {graph.people.length === 1 ? 'person' : 'people'}
          {mePersonId ? ', grouped by how they relate to you.' : '. Mark yourself in the tree to see relationships.'}
        </p>
      </header>

      <div className="relative mb-5">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          className="field pl-9"
          placeholder="Search by name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {!rows.length ? (
        <Empty icon={<Users size={22} />} title="Nobody by that name">
          Try a surname, or a name they were also known by.
        </Empty>
      ) : (
        <div className="space-y-7">
          {grouped.map(([bucket, list]) => (
            <section key={bucket}>
              <h2 className="label mb-2">
                {bucket} <span className="ml-1 font-normal normal-case tracking-normal">({list.length})</span>
              </h2>
              <div className="card divide-y divide-line overflow-hidden">
                {list.map(({ person, kin }) => (
                  <button
                    key={person.id}
                    onClick={() => navigate('/', { state: { focus: person.id } })}
                    className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition hover:bg-leaf-soft"
                  >
                    <Avatar person={person} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-semibold">{fullName(person)}</span>
                      <span className="block truncate text-[12.5px] text-muted">
                        {!person.living && '† '}
                        {lifespan(person) || 'Dates unknown'}
                        {person.birth_place && ` · ${person.birth_place}`}
                      </span>
                    </span>
                    {kin && kin.category !== 'unrelated' && (
                      <span className="chip-leaf shrink-0">{sentenceCase(kin.short)}</span>
                    )}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
