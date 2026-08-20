# Mizu

**Every family loses touch one generation at a time.** Your grandmother knew all five of
her brothers and sisters and every one of their children. Two generations on, most of us
can name a handful of cousins and guess at the rest.

Mizu is where a family writes it down together. One person adds their branch, someone else
adds theirs, and where the two overlap, the tree joins itself up.

---

## What it does

**Grows outward from you.** You put yourself in first, then a parent, then their brothers
and sisters, then whoever those marriages brought in. Every card on the canvas has a small
`+` that asks one question: parent, partner, child, or sibling. Nothing else is required —
not a date, not a photo, not a surname.

**Tells you how you are actually related.** Not names in boxes. *Your grandmother's
brother's granddaughter — your second cousin.* Every label on screen is computed from where
**you** stand in the graph, and the person panel shows its working:

> Chileshe is your aunt.
> You both descend from Beatrice Mwansa — your grandmother, Chileshe's mother.

It handles what real families look like: half siblings, remarriage, adoption, single
parents, people who never married, and the very common case where you know your grandmother
had five siblings but nobody alive can name her parents.

**Finds relatives you never met.** When another family records someone you have already
written down, Mizu spots it, shows you *why* it thinks the two records are the same human —
same birth year, same spouse, two children in common — and asks. Confirm, and you get a
list of living relatives you had never heard of, each labelled with exactly how they connect
to you.

Nothing is ever merged automatically. A common surname is not evidence, and welding two
families together on one is not something you can unpick afterwards.

---

## Running it

```bash
cd frontend && npm install && npm run dev
```

That is the whole setup. With no backend configured Mizu runs entirely in your browser:
accounts, trees, photos and cross-tree matching all work, but only for trees created on
that device, and nothing leaves it. It is a real, complete version of the app — good enough
to sit down with family and fill in an afternoon — just not a shared one.

To make it shared, follow [SUPABASE_SETUP.md](SUPABASE_SETUP.md). Paste two keys into
`frontend/.env` and the same code starts talking to a real database instead. No other change.

---

## How it is put together

```
frontend/src/
  lib/
    graph.ts      Adjacency over the raw records — parents, siblings, spouses, children
    kinship.ts    "How am I related to this person?" — the heart of it
    layout.ts     Tidy-tree layout adapted for couples rather than single nodes
    matching.ts   Scoring two records as the same human, with reasons in words
    ops.ts        The four ways to add someone, as pure functions
    join.ts       What a confirmed match actually buys you
    store/        One interface, two backings: local.ts and cloud.ts
  components/
    TreeCanvas    The pan/zoom chart
    PersonPanel   One person, and how they connect to you
  pages/          Auth · Start · Tree · People · Matches
supabase/migrations/0001_init.sql
```

### The data model

The shape genealogists settled on decades ago, because it is the one that survives contact
with real families:

- **people** — the individuals
- **unions** — a couple. *Either partner may be null*, which is how a single parent, or a
  sibling group whose parents nobody can name, is recorded without inventing fictional people
- **child_links** — attaches a person to the union they were born into

Siblings are siblings because they share a union. That one decision is what lets you enter
"Grandma and her five brothers and sisters" before you know a thing about the generation
above, and still have every cousin relationship below resolve correctly.

Relationship labels are never stored. A relationship is only true relative to who is
looking, so it is computed fresh for each viewer.

### Working out a relationship

Find the nearest ancestor two people share, count the generations each stands below it, and
read the answer off those two numbers:

| you | them | relationship |
|-----|------|--------------|
| 1 | 1 | brother or sister |
| 2 | 1 | your aunt or uncle |
| 1 | 2 | your niece or nephew |
| 2 | 2 | first cousin |
| 2 | 3 | first cousin once removed |
| *n* | *m* | cousin, degree `min(n,m)-1`, removed `\|n-m\|` |

Then a second pass covers family by marriage — the people your relatives married, and the
relatives of the person you married — one hop in each direction, which is as far as labels
anybody actually says will stretch.

The ancestor walk goes through *unions*, not just through named parents. That is what makes
the nameless-grandparents case work.

---

## Privacy

Family data about living people deserves more care than a side project usually gives it.

- **Trees are private.** Only members can read one, and the database enforces that through
  row-level security, not the app. A check in the browser is a suggestion, not a rule.
- **Matching sees a deliberately thin slice.** Names, years, sex, birthplace, and the shape
  of relationships — through the `*_discovery` views. Never photos, never notes.
- **A tree can opt out entirely** with `trees.discoverable = false`. Everything else keeps
  working; it just never appears in anyone else's suggestions.
- **Photos** live in a public bucket at unguessable paths, so a card renders without a
  signing round trip. That trade is documented at the bottom of the migration, along with
  how to switch to signed URLs if it is the wrong one for your family.

---

## Where it would go next

Honest about what is not built yet:

- **Invitations.** Today you find another family through matching. Sending your uncle a link
  that drops him straight into the right tree is the obvious next step.
- **Answering a match from the other side.** Proposals are recorded and shown as pending;
  the screen for the other family to accept or reject one still needs building.
- **Stories, not just dates.** A notes field exists. Voice notes from the people who still
  remember would be worth far more.
- **Export.** GEDCOM out, so a family is never locked in here.
