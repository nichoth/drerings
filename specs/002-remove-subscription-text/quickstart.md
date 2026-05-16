# Quickstart — Remove Subscription Messaging from Home Screen

## What this change does

Deletes the "Drawings aren't saved without a subscription. Subscribe to keep
them and share them with the world" banner from the home route (`/`). No
other behavior changes.

## Files touched

- `src/routes/home.ts` — remove the `${state.isPaid.value ? null : html\`<aside
  class="free-account-warning" …>…</aside>\`}` block (currently lines
  ~181–192).
- `src/routes/home.css` — remove the `& .free-account-warning { … }` rule
  (currently lines ~13–22).

No other files should change.

## Verification

Run all of these from the repo root.

### 1. Static checks

```bash
# Grep should return zero hits for any of these strings across src/.
grep -rn "Drawings aren't saved" src/ ; echo "exit=$?"
grep -rn "Subscribe to keep them" src/ ; echo "exit=$?"
grep -rn "free-account-warning" src/ ; echo "exit=$?"
grep -rn "Save warning" src/ ; echo "exit=$?"
# Each grep should print exit=1 (no matches).
```

### 2. Lint + unit tests

```bash
npm test && npm run lint
```

Both must pass. No tests are added or removed by this change, so the only
acceptable outcome is the same set of passes as before the edit.

### 3. Manual smoke (dev server)

```bash
npm start
```

Open `http://localhost:5173/` (or whatever Vite reports) and verify:

| State | Expectation |
|-------|-------------|
| Signed-out visitor | No banner above the canvas. Intro `<p>` and canvas render normally. |
| Signed-in non-paid user | Same as above — banner is gone. Paid-feature controls (those gated by `state.isPaid` *other than* the banner) behave exactly as before. |
| Signed-in paid user | Unchanged from before the edit — they never saw the banner. |

### 4. Accessibility-tree check

In DevTools → Accessibility panel (Chrome) or Accessibility Inspector
(Firefox), confirm the home page tree contains **no** node with
`role="status"` and `aria-label="Save warning"`. There must not be an
empty live region in its place.

## Rollback

`git revert` the implementation commit. The change is two-file, deletion-only,
with no schema or state migration, so rollback is trivial and safe.

## What is NOT changed

- `/pricing` route and the account page subscription controls — still present.
- `state.isPaid` signal — still computed and consumed by other features.
- Drawing persistence (stamps system) — untouched.
- Service worker / cache busting — no version bump required; old cached pages
  pick up the new markup on next fresh load.
