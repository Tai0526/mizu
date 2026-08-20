# Turning on the shared backend

Mizu works with nothing configured — see the README. This is what to do when you want a
family spread across several phones to be looking at the same tree.

It takes about ten minutes and you only do it once.

---

## 1. Create the project

1. Go to <https://supabase.com> and create a **New project**.
2. Pick the region closest to your family — `eu-central` or `af-south` if offered.
3. Save the database password somewhere safe. You will not be shown it again.

## 2. Point the app at it

1. In the dashboard: **Project Settings → API**. Copy the **Project URL** and the
   **anon / public** key.
2. Copy `frontend/.env.example` to `frontend/.env` and paste them in:

   ```
   VITE_SUPABASE_URL=https://YOUR-REF.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

`.env` is gitignored and never committed. **Do not** put the `service_role` key anywhere
near the frontend — it bypasses every security rule in the next step.

## 3. Create the schema

1. Dashboard → **SQL Editor → New query**.
2. Paste the whole of [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql)
   and **Run**.

That creates the tables, the row-level security policies, the narrow `*_discovery` views
that matching is allowed to read across families, and the `photos` storage bucket. It is
written to be safe to run again.

## 4. Decide how people sign up

By default Supabase emails a confirmation link to every new account.

- **Keeping it on** is the right answer for anything real.
- **Turning it off** — Authentication → Providers → Email → uncheck *Confirm email* — is
  convenient while you and two cousins are testing, because accounts work instantly.

## 5. Check it took

Restart the dev server (Vite only reads `.env` at startup):

```bash
cd frontend && npm run dev
```

Create an account. The note at the bottom of the sign-in screen that says *"Running on this
device only"* should now be gone — that line is driven by whether the keys are present, so
its absence is the confirmation.

Then open the app on a second device, sign in with the same account, and check your tree is
there.

---

## Deploying

The repo is already set up for Netlify (`netlify.toml` builds `frontend/` and publishes
`dist/`). Point Netlify at the repo and add the same two variables under
**Site settings → Environment variables**:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

They are build-time variables, so a change to either needs a redeploy, not just a refresh.

---

## Things worth knowing

**The anon key is meant to be public.** It identifies your project, it does not grant
access. Everything is gated by the row-level security policies in the migration, which is
why those matter far more than key hygiene.

**Photos are in a public bucket.** Anyone with the exact URL can view an image, though the
paths carry a random id and are not listable. If that is the wrong trade for your family,
set `public` to `false` on the bucket in the migration and change `uploadPhoto()` in
`frontend/src/lib/store/cloud.ts` to use `createSignedUrl()`.

**Discovery is opt-out per tree.** Matching only ever reads the `*_discovery` views, and
those skip any tree with `discoverable = false`. To take a family out of matching entirely:

```sql
update public.trees set discoverable = false where id = 'tree_xxxxx';
```

**Local trees do not migrate themselves.** Anything created before you connected Supabase
stays in that browser's storage. There is no import yet — worth knowing before you spend an
evening filling one in.
