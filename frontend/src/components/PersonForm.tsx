import { Camera, Loader2, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { preparePhoto } from '../lib/image'
import type { NewPersonInput } from '../lib/store/types'
import type { Person, Sex } from '../types'
import { Avatar, Field, cx } from './ui'

export interface PersonDraft extends NewPersonInput {
  sex: Sex
  living: boolean
}

export const emptyDraft = (family = ''): PersonDraft => ({
  given_name: '',
  family_name: family,
  other_names: '',
  sex: 'unknown',
  birth_year: null,
  birth_place: '',
  death_year: null,
  living: true,
  notes: '',
  photo_url: null,
})

export const draftFromPerson = (p: Person): PersonDraft => ({
  given_name: p.given_name,
  family_name: p.family_name,
  other_names: p.other_names,
  sex: p.sex,
  birth_year: p.birth_year,
  birth_place: p.birth_place,
  death_year: p.death_year,
  living: p.living,
  notes: p.notes,
  photo_url: p.photo_url,
})

const THIS_YEAR = new Date().getFullYear()

/** Shared by "add a relative" and "edit". Only the first name is required —
 *  demanding dates up front is how family trees end up half-filled. */
export function PersonForm({
  draft,
  onChange,
  detailed,
  onToggleDetail,
}: {
  draft: PersonDraft
  onChange: (next: PersonDraft) => void
  detailed: boolean
  onToggleDetail: () => void
}) {
  const set = <K extends keyof PersonDraft>(key: K, value: PersonDraft[K]) =>
    onChange({ ...draft, [key]: value })

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <PhotoPicker
          draft={draft}
          onPhoto={(url) => set('photo_url', url)}
        />
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <Field label="First name">
            <input
              autoFocus
              className="field"
              value={draft.given_name}
              onChange={(e) => set('given_name', e.target.value)}
              placeholder="Beatrice"
            />
          </Field>
          <Field label="Surname">
            <input
              className="field"
              value={draft.family_name}
              onChange={(e) => set('family_name', e.target.value)}
              placeholder="Mwansa"
            />
          </Field>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Sex">
          <div className="flex gap-1.5">
            {(['female', 'male', 'unknown'] as Sex[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => set('sex', option)}
                className={cx(
                  'flex-1 rounded-lg border px-2 py-2 text-[13px] font-medium capitalize transition',
                  draft.sex === option
                    ? 'border-leaf bg-leaf-soft text-leaf'
                    : 'border-line bg-surface text-muted hover:border-leaf/40',
                )}
              >
                {option === 'unknown' ? 'Unknown' : option}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Born">
          <input
            className="field"
            inputMode="numeric"
            value={draft.birth_year ?? ''}
            onChange={(e) => {
              const value = e.target.value.replace(/\D/g, '').slice(0, 4)
              set('birth_year', value ? Number(value) : null)
            }}
            placeholder="1948"
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-canvas/60 px-3.5 py-3">
        <span className="text-sm font-medium">Still living</span>
        <button
          type="button"
          role="switch"
          aria-checked={draft.living}
          onClick={() => set('living', !draft.living)}
          className={cx(
            'relative h-6 w-11 rounded-full transition',
            draft.living ? 'bg-leaf' : 'bg-line',
          )}
        >
          <span
            className={cx(
              'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
              draft.living ? 'left-[22px]' : 'left-0.5',
            )}
          />
        </button>
        {!draft.living && (
          <input
            className="field ml-auto w-28"
            inputMode="numeric"
            value={draft.death_year ?? ''}
            onChange={(e) => {
              const value = e.target.value.replace(/\D/g, '').slice(0, 4)
              set('death_year', value ? Number(value) : null)
            }}
            placeholder={`Died, e.g. ${THIS_YEAR - 5}`}
          />
        )}
      </div>

      <button
        type="button"
        onClick={onToggleDetail}
        className="text-[13px] font-semibold text-leaf hover:underline"
      >
        {detailed ? 'Hide extra details' : 'Add more details'}
      </button>

      {detailed && (
        <div className="grid gap-3 animate-fade">
          <Field label="Also known as" hint="Maiden name, church name, or what everyone actually calls them.">
            <input
              className="field"
              value={draft.other_names ?? ''}
              onChange={(e) => set('other_names', e.target.value)}
              placeholder="née Chanda"
            />
          </Field>
          <Field label="Born in">
            <input
              className="field"
              value={draft.birth_place ?? ''}
              onChange={(e) => set('birth_place', e.target.value)}
              placeholder="Kasama"
            />
          </Field>
          <Field label="Notes" hint="The things that get lost — a trade, a nickname, where they settled.">
            <textarea
              className="field min-h-[84px] resize-y"
              value={draft.notes ?? ''}
              onChange={(e) => set('notes', e.target.value)}
            />
          </Field>
        </div>
      )}
    </div>
  )
}

function PhotoPicker({
  draft,
  onPhoto,
}: {
  draft: PersonDraft
  onPhoto: (url: string | null) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const pick = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setProblem(null)
    try {
      onPhoto(await preparePhoto(file))
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That image could not be read.')
    } finally {
      setBusy(false)
    }
  }

  const preview = {
    given_name: draft.given_name,
    family_name: draft.family_name,
    photo_url: draft.photo_url ?? null,
  } as Person

  return (
    <div className="shrink-0 text-center">
      <div className="relative">
        <Avatar person={preview} size={76} />
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full border border-line bg-surface text-leaf shadow-card hover:brightness-105"
          aria-label="Choose a photo"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
        </button>
      </div>
      {draft.photo_url && (
        <button
          type="button"
          onClick={() => onPhoto(null)}
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted hover:text-danger"
        >
          <Trash2 size={11} /> Remove
        </button>
      )}
      {problem && <p className="mt-1 w-24 text-[11px] text-danger">{problem}</p>}
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void pick(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </div>
  )
}
