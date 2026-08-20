import { ArrowRight, Loader2, Sparkles, TreeDeciduous } from 'lucide-react'
import { useState } from 'react'
import { PersonForm, emptyDraft, type PersonDraft } from '../components/PersonForm'
import { Banner } from '../components/ui'
import { useAuth } from '../state/AuthContext'
import { useTree } from '../state/TreeContext'

/**
 * The first minute.
 *
 * A blank canvas is where family trees go to die, so this asks for exactly one
 * thing — you — and then hands over to the chart, where adding a parent is one
 * tap. Everything else can wait; the point is to get something on screen that
 * is recognisably the beginning of a family.
 */
export function StartPage() {
  const { account } = useAuth()
  const { trees, data, createTree, addFirstPerson, setMePerson, loadExampleFamily, error, dismissError } = useTree()
  const [draft, setDraft] = useState<PersonDraft>(() => emptyDraft())
  const [detailed, setDetailed] = useState(false)
  const [busy, setBusy] = useState(false)

  const needsTree = trees.length === 0 || !data

  const begin = async () => {
    setBusy(true)
    try {
      await createTree(`${account?.display_name?.split(' ')[0] ?? 'My'} family`)
    } finally {
      setBusy(false)
    }
  }

  const example = async () => {
    setBusy(true)
    try {
      await loadExampleFamily()
    } finally {
      setBusy(false)
    }
  }

  const addMe = async () => {
    setBusy(true)
    try {
      const person = await addFirstPerson({ ...draft })
      if (person) await setMePerson(person.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col justify-center px-5 py-12">
      {error && (
        <div className="mb-5">
          <Banner tone="error" onDismiss={dismissError}>{error}</Banner>
        </div>
      )}

      {needsTree ? (
        <div className="text-center">
          <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-leaf-soft text-leaf">
            <TreeDeciduous size={30} />
          </div>
          <h1 className="font-display text-3xl font-bold">Let us plant it</h1>
          <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-muted">
            One tree holds one extended family. You will start with yourself and work outwards —
            parents, then their brothers and sisters, then everyone those marriages brought in.
          </p>

          <button onClick={() => void begin()} disabled={busy} className="btn-primary mt-7 w-full sm:w-auto sm:px-8">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <TreeDeciduous size={16} />}
            Start my family tree
          </button>

          <div className="mt-8 border-t border-line pt-6">
            <p className="text-sm text-muted">Rather see one that is already filled in?</p>
            <button
              onClick={() => void example()}
              disabled={busy}
              className="btn-outline mt-3"
            >
              <Sparkles size={15} /> Open the example family
            </button>
            <p className="mx-auto mt-3 max-w-xs text-[12px] leading-relaxed text-muted">
              Four generations, five siblings at the top, and a second household that overlaps it —
              so the matching has something real to find.
            </p>
          </div>
        </div>
      ) : (
        <div>
          <h1 className="font-display text-3xl font-bold">Start with you</h1>
          <p className="mt-2.5 text-[15px] leading-relaxed text-muted">
            Everything on the chart is described from where you stand, so this first card is the one
            that turns names into <em>your aunt</em> and <em>your second cousin</em>.
          </p>

          <div className="card mt-6 p-5">
            <PersonForm
              draft={draft}
              onChange={setDraft}
              detailed={detailed}
              onToggleDetail={() => setDetailed((d) => !d)}
            />
          </div>

          <button
            onClick={() => void addMe()}
            disabled={busy || !draft.given_name.trim()}
            className="btn-primary mt-5 w-full"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : null}
            Add me and open the tree
            <ArrowRight size={16} />
          </button>

          <p className="mt-4 text-center text-[12.5px] text-muted">
            Next you will add your parents, then their brothers and sisters. The chart grows a new
            branch each time.
          </p>
        </div>
      )}
    </div>
  )
}
