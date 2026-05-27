# Flatten `/api/*` Route Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the 15-entry routing tables in `netlify.toml` and
`vite.config.js` to one splat rule each, by flattening every nested
URL (`/api/auth/login` → `/api/auth-login`) to match the existing flat
Netlify Function file names.

**Architecture:** Single PR, hard cutover. Phase 1 moves four
directory-style function files (`whoami/whoami.ts` → `whoami.ts`,
etc.) — pure tidying, no URL change, four small commits. Phase 2
is one atomic commit that flattens every nested `/api/*` URL,
collapses both routing tables, fixes two path parsers that anchor on
the URL shape, and updates all client `fetch` sites, the OAuth
callback constant, and the tests. Phase 3 updates `README.md`.

**Tech Stack:** TypeScript 5.8 (ES2022, ESM), Node ≥20.19, Vite 7,
`@netlify/functions`, `@preact/preset-vite`, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-27-flatten-api-routes-design.md`

---

## File Structure

Files moved (Phase 1, four `git mv`s):

```
netlify/functions/whoami/whoami.ts      → netlify/functions/whoami.ts
netlify/functions/account/account.ts    → netlify/functions/account.ts
netlify/functions/drawings/drawings.ts  → netlify/functions/drawings.ts
netlify/functions/posts/posts.ts        → netlify/functions/posts.ts
```

(Each moved file changes `../../lib/…` imports to `../lib/…`.)

Files modified (Phase 2, atomic commit):

```
netlify.toml                                   collapse 15 redirects → 2
vite.config.js                                 collapse apiRewrites array
netlify/functions/stamps-refund.ts             fix lotIdFromPath anchor
netlify/functions/stamps-gifts-refund.ts       fix lotIdFromPath anchor
netlify/lib/auth/atproto.ts                    callback URL constant (×2)
src/state.ts                                   fetch URLs (16 sites)
src/routes/login.ts                            fetch URL (1 site)
test/us016-stamp-lots-api.test.ts              event.path string
test/us020-share-state.test.ts                 fetch-mock URLs
test/us031-postcard-send-route.test.ts         fetch-mock URLs (postcards only)
test/us039-rate-limit-endpoints.test.ts        describe titles
```

Files modified (Phase 3, separate commit):

```
README.md                                      operator-facing endpoint docs
```

Files NOT touched (intentionally):

- `netlify/functions/oauth-client-metadata.ts` (URL is RFC-fixed).
- Any file under `netlify/lib/` other than `auth/atproto.ts`.
- The SPA fallback redirects under `[context.*.redirects]` in
  `netlify.toml`.
- `docs/SPEC.md`, `docs/pricing.md`, `docs/monetization.md`,
  `docs/audit-2026-05-18.md` (point-in-time historical docs).
- Rate-limit key strings inside handlers (e.g.
  `postcards/send`) — out of scope per spec.
- `test/us010-delete-drawing-ui.test.ts`,
  `test/us012-public-post-api.test.ts` — they reference
  `/api/drawings/*` and `/api/posts/*` which are unchanged URLs.

---

## Phase 1: Flatten directory-style function files

These four moves don't change any URL — Netlify resolves both
`functions/foo/foo.ts` and `functions/foo.ts` as `/foo`. The point
is consistency and removing the silly `whoami/whoami.ts`-style
redundancy. Each is its own commit and leaves the test suite green.

---

### Task 1: Move `whoami/whoami.ts` to flat

**Files:**
- Move: `netlify/functions/whoami/whoami.ts` → `netlify/functions/whoami.ts`
- Modify: `netlify/functions/whoami.ts` (imports)

- [ ] **Step 1: Move the file with git**

Run:
```bash
git mv netlify/functions/whoami/whoami.ts netlify/functions/whoami.ts
rmdir netlify/functions/whoami
```

Expected: file moved, empty directory removed cleanly.

- [ ] **Step 2: Update relative imports**

Open `netlify/functions/whoami.ts`. The file is now one directory
shallower, so all `../../lib/…` imports must become `../lib/…`.

Replace lines 2–3:

```ts
import { json } from '../lib/http.js'
import { getSession } from '../lib/session.js'
```

(Old: `'../../lib/http.js'`, `'../../lib/session.js'`.)

- [ ] **Step 3: Run the test suite**

Run: `npm test`

Expected: PASS. The `/api/whoami` URL is unchanged and Netlify resolves
the flat file the same way it resolved the directory form.

- [ ] **Step 4: Run the linter**

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/whoami.ts
git commit -m "refactor: flatten whoami function to top-level file"
```

---

### Task 2: Move `account/account.ts` to flat

**Files:**
- Move: `netlify/functions/account/account.ts` → `netlify/functions/account.ts`
- Modify: `netlify/functions/account.ts` (imports)

- [ ] **Step 1: Move the file with git**

Run:
```bash
git mv netlify/functions/account/account.ts netlify/functions/account.ts
rmdir netlify/functions/account
```

- [ ] **Step 2: Update relative imports**

Open `netlify/functions/account.ts`. Change every `../../lib/…` to
`../lib/…`. As of writing, the imports are:

```ts
import { json } from '../lib/http.js'
import { clearSessionCookie, getSession } from '../lib/session.js'
import {
    deleteAccountData,
    getAccountDetails
} from '../lib/account.js'
```

(Old: `'../../lib/http.js'`, `'../../lib/session.js'`,
`'../../lib/account.js'`.)

If you find any other `../../` imports beyond the three above, fix
them the same way — drop one `../`.

- [ ] **Step 3: Run the test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 4: Run the linter**

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/account.ts
git commit -m "refactor: flatten account function to top-level file"
```

---

### Task 3: Move `drawings/drawings.ts` to flat

**Files:**
- Move: `netlify/functions/drawings/drawings.ts` → `netlify/functions/drawings.ts`
- Modify: `netlify/functions/drawings.ts` (imports)

- [ ] **Step 1: Move the file with git**

Run:
```bash
git mv netlify/functions/drawings/drawings.ts netlify/functions/drawings.ts
rmdir netlify/functions/drawings
```

- [ ] **Step 2: Update relative imports**

Open `netlify/functions/drawings.ts`. Change every `../../lib/…` to
`../lib/…`. Do not touch the body of `drawingIdFromPath` — its
anchor is the literal segment `'drawings'`, which is still present
in the URL `/api/drawings/:id`.

- [ ] **Step 3: Run the test suite**

Run: `npm test`

Expected: PASS. `test/us010-delete-drawing-ui.test.ts` references
`/api/drawings/drawing-1` — unchanged URL, still passes.

- [ ] **Step 4: Run the linter**

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/drawings.ts
git commit -m "refactor: flatten drawings function to top-level file"
```

---

### Task 4: Move `posts/posts.ts` to flat

**Files:**
- Move: `netlify/functions/posts/posts.ts` → `netlify/functions/posts.ts`
- Modify: `netlify/functions/posts.ts` (imports)

- [ ] **Step 1: Move the file with git**

Run:
```bash
git mv netlify/functions/posts/posts.ts netlify/functions/posts.ts
rmdir netlify/functions/posts
```

- [ ] **Step 2: Update relative imports**

Open `netlify/functions/posts.ts`. Change every `../../lib/…` to
`../lib/…`. Do not touch `postIdFromPath` — its anchor is the literal
segment `'posts'`, which is still present in the URL
`/api/posts/:id`.

- [ ] **Step 3: Run the test suite**

Run: `npm test`

Expected: PASS. `test/us012-public-post-api.test.ts` synthesises
`event.path: '/api/posts/42'` — unchanged URL, still passes.

- [ ] **Step 4: Run the linter**

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/posts.ts
git commit -m "refactor: flatten posts function to top-level file"
```

---

## Phase 2: Atomic URL flattening cutover

**This entire phase is ONE commit.** Between starting Phase 2 and
its final commit step, intermediate states leave the routing
tables and the SPA out of sync — `/api/auth/login` no longer
resolves at one moment, then `/api/auth-login` does. Do not push,
test against dev, or `npm start` until the final commit step lands.

All work happens on the same branch as Phase 1.

---

### Task 5: Update SPA-side fetch-mock tests to expect new URLs

The SPA tests in `test/us020-…` and `test/us031-…` assert that the
state layer calls specific URLs. Updating those assertions FIRST
puts the test suite in a red state that the rest of Phase 2 turns
back to green. This is the TDD lever for Phase 2.

**Files:**
- Modify: `test/us020-share-state.test.ts`
- Modify: `test/us031-postcard-send-route.test.ts`
- Modify: `test/us016-stamp-lots-api.test.ts`
- Modify: `test/us039-rate-limit-endpoints.test.ts`

- [ ] **Step 1: Update `test/us020-share-state.test.ts`**

Replace every `'/api/shares/precheck'` with `'/api/shares-precheck'`
and every `'/api/shares/confirm'` with `'/api/shares-confirm'`.

Specifically the six occurrences at lines 13, 19, 41, 45, 103, 109:

```ts
// line 13
if (url.endsWith('/api/shares-precheck')) {
// line 19
if (url.endsWith('/api/shares-confirm')) {
// line 41
expect.stringContaining('/api/shares-precheck'),
// line 45
expect.stringContaining('/api/shares-confirm'),
// line 103
if (url.endsWith('/api/shares-precheck')) {
// line 109
if (url.endsWith('/api/shares-confirm')) {
```

- [ ] **Step 2: Update `test/us031-postcard-send-route.test.ts`**

Replace every `'/api/postcards/send'` with `'/api/postcards-send'`.
Do NOT change the `'/api/drawings'` strings — that URL is unchanged.
Lines 55 and 96:

```ts
// line 55
url.includes('/api/postcards-send')) {
// line 96
url.includes('/api/postcards-send')) {
```

- [ ] **Step 3: Update `test/us016-stamp-lots-api.test.ts`**

Change the synthetic event's path/rawUrl fields at lines 17 and 19:

```ts
rawUrl: 'https://drerings.app/api/stamps-lots',
// ...
path: '/api/stamps-lots',
```

Note: the handler `stamps-lots.ts` does not read `event.path` to
dispatch — this change is cosmetic for the test fixture, but
keeping it in sync with the real URL avoids future confusion.

- [ ] **Step 4: Update `test/us039-rate-limit-endpoints.test.ts`**

The four `describe(...)` titles at lines 18, 123, 230, 333 use the
old URLs for readability:

```ts
// line 18
describe('POST /api/postcards-send rate limiting', () => {
// line 123
describe('POST /api/shares-confirm rate limiting', () => {
// line 230
describe('POST /api/billing-checkout rate limiting', () => {
// line 333
describe('POST /api/stamps-gifts-checkout rate limiting', () => {
```

(If `us039` also has fetch-mock URLs in its bodies, update those too
with the same mapping — grep `/api/` inside the file before
finishing the step. None were present at plan-write time.)

- [ ] **Step 5: Run the test suite, expect failures**

Run: `npm test`

Expected: FAIL. The SPA tests in `us020` and `us031` now assert the
new URLs but `src/state.ts` still calls the old ones, so the
fetch-mock branches don't fire and the test assertions blow up. The
`us016` and `us039` updates don't cause failures on their own —
they're cosmetic — but `us020` and `us031` should both go red here.

If `us020` and `us031` go GREEN at this step, something is wrong —
either the assertions weren't actually updated or the tests don't
assert URLs the way you think. Re-grep before continuing.

- [ ] **Step 6: Do not commit yet**

The rest of Phase 2 must land in the same commit. Move on to Task 6.

---

### Task 6: Update SPA fetch sites in `src/state.ts`

**Files:**
- Modify: `src/state.ts` (16 fetch sites)

- [ ] **Step 1: Apply the URL mapping to every `fetch` call**

The complete list of edits, by line, follows the URL mapping in the
spec. (Line numbers are accurate as of plan-write; if `git blame`
shows churn, grep `'/api/'` to relocate.)

```
line 309   '/api/auth/logout'         → '/api/auth-logout'
line 326   `/api/drawings/${...}`     unchanged
line 327   '/api/drawings'            unchanged
line 374   '/api/drawings'            unchanged
line 411   '/api/stamps/lots'         → '/api/stamps-lots'
line 460   `/api/stamps/refund/${id}` → `/api/stamps-refund/${id}`
line 507   `/api/stamps/gifts/refund/${id}` → `/api/stamps-gifts-refund/${id}`
line 550   `/api/stamps/transactions?before=…` → `/api/stamps-transactions?before=…`
line 551   '/api/stamps/transactions' → '/api/stamps-transactions'
line 610   `/api/drawings/${...}`     unchanged
line 634   `/api/drawings/${...}`     unchanged
line 675   '/api/posts'               unchanged
line 710   '/api/postcards/send'      → '/api/postcards-send'
line 812   '/api/shares/precheck'     → '/api/shares-precheck'
line 933   '/api/shares/confirm'      → '/api/shares-confirm'
line 1081  '/api/billing/checkout'    → '/api/billing-checkout'
line 1129  '/api/stamps/gifts/checkout' → '/api/stamps-gifts-checkout'
line 1175  '/api/account'             unchanged
line 1210  '/api/account'             unchanged
line 1230  `/api/posts/${id}`         unchanged
```

The five `unchanged` lines and the three `unchanged` posts/account
lines are listed only so the engineer can confirm they were
consciously skipped — leave them alone.

Use `Edit` with `replace_all` only when the string is unique in the
file; otherwise edit by line with enough surrounding context to
disambiguate.

- [ ] **Step 2: Update `src/routes/login.ts`**

Line 19, replace `/api/auth/login?handle=…` with
`/api/auth-login?handle=…`:

```ts
const url = `/api/auth-login?handle=${encodeURIComponent(value)}`
```

- [ ] **Step 3: Do not run tests yet**

Backend still needs work. Move on to Task 7.

---

### Task 7: Fix the OAuth callback URL constant

**Files:**
- Modify: `netlify/lib/auth/atproto.ts` (lines 19 and 38)

- [ ] **Step 1: Update both occurrences of the callback URL**

In `netlify/lib/auth/atproto.ts`:

Line 19 — replace `${origin}/api/auth/callback` inside the local
`getClientId()` branch:

```ts
const redirect = encodeURIComponent(
    `${origin}/api/auth-callback`
)
```

Line 38 — replace `${origin}/api/auth/callback` inside the
`redirect_uris` array of `getClientMetadata()`:

```ts
redirect_uris: [`${origin}/api/auth-callback`],
```

These two strings MUST stay byte-identical to each other for the
OAuth flow to validate — they are the same callback URL written
twice. Change them together.

- [ ] **Step 2: Do not run tests yet**

Move on to Task 8.

---

### Task 8: Fix `stamps-refund.ts` path parser

**Files:**
- Modify: `netlify/functions/stamps-refund.ts` (function `lotIdFromPath`)

- [ ] **Step 1: Replace the anchor segment**

The current parser at lines 57–63 finds the literal `'refund'`
segment in `event.path`. After Phase 2, `event.path` is
`/api/stamps-refund/<lot_id>` — `'refund'` is no longer a standalone
segment, so the lookup fails. Anchor on `'stamps-refund'` instead.

Replace the function body:

```ts
function lotIdFromPath (path:string):string|null {
    const parts = path.split('/').filter(Boolean)
    const idx = parts.lastIndexOf('stamps-refund')
    if (idx === -1) return null
    const lotId = parts[idx + 1]

    return lotId && lotId.trim() ? lotId : null
}
```

The added `if (idx === -1) return null` guards against `lastIndexOf`
returning `-1`, which would otherwise make `parts[-1 + 1]` equal to
`parts[0]` (always `'api'`) and that string would silently pass the
truthy check. The original code had the same latent bug but never
hit it because `'refund'` was always present.

- [ ] **Step 2: Do not run tests yet**

Move on to Task 9.

---

### Task 9: Fix `stamps-gifts-refund.ts` path parser

**Files:**
- Modify: `netlify/functions/stamps-gifts-refund.ts` (function `lotIdFromPath`)

- [ ] **Step 1: Replace the anchor segment**

Mirror the change from Task 8, anchoring on `'stamps-gifts-refund'`:

```ts
function lotIdFromPath (path:string):string|null {
    const parts = path.split('/').filter(Boolean)
    const idx = parts.lastIndexOf('stamps-gifts-refund')
    if (idx === -1) return null
    const lotId = parts[idx + 1]

    return lotId && lotId.trim() ? lotId : null
}
```

- [ ] **Step 2: Do not run tests yet**

Move on to Task 10.

---

### Task 10: Collapse `netlify.toml` redirects

**Files:**
- Modify: `netlify.toml` (replace lines 20–98)

- [ ] **Step 1: Replace the 15 redirect blocks**

Delete the 15 existing `[[redirects]]` blocks (currently lines
20–98) and replace them with exactly two:

```toml
[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200

[[redirects]]
  from = "/.well-known/oauth-client-metadata.json"
  to = "/.netlify/functions/oauth-client-metadata"
  status = 200
```

Leave everything below the redirects block alone: the
`[context.production.redirects]`,
`[context.deploy-preview.redirects]`,
`[context.branch-deploy.redirects]` SPA fallbacks, plus the
`[functions]`, `[build]`, `[context.staging]` blocks, are all
untouched.

Leave the `[[headers]]` block at the top of the file alone.

- [ ] **Step 2: Do not run tests yet**

Move on to Task 11.

---

### Task 11: Collapse `vite.config.js` proxy

**Files:**
- Modify: `vite.config.js`

- [ ] **Step 1: Delete the `apiRewrites` array and `rewriteApi` function**

Delete the comment block on lines 7–10 (the warning to keep
`apiRewrites` in sync with `netlify.toml` is moot once the table is
gone), the `apiRewrites` array on lines 11–73, and the
`rewriteApi` function on lines 75–86.

- [ ] **Step 2: Replace `server.proxy` with the simpler form**

Replace the existing `proxy: { ... }` block (currently lines
117–128) with:

```js
proxy: {
    '/api': {
        target: 'http://127.0.0.1:9999',
        changeOrigin: false,
        rewrite: (path) => '/.netlify/functions' + path.slice(4),
    },
    '/.well-known/oauth-client-metadata.json': {
        target: 'http://127.0.0.1:9999',
        changeOrigin: false,
        rewrite: () => '/.netlify/functions/oauth-client-metadata',
    },
},
```

`path.slice(4)` strips the leading `/api`. Vite passes the path WITH
the query string in this hook (the old code split on `?` before
running its regex; the new form doesn't need to, because everything
after `/api` — path tail plus query — is preserved verbatim).

The final shape of `vite.config.js` keeps the file `// @ts-check`
header, the four imports (`defineConfig`, `browserslist`,
`browserslistToTargets`, `preact`), and the `defineConfig({...})`
default export with `define`, `plugins`, `esbuild`, `publicDir`,
`css`, `server` (now containing only `port`, `strictPort`, `host`,
`proxy`), and `build` blocks.

- [ ] **Step 3: Do not run tests yet**

Move on to Task 12.

---

### Task 12: Run the full suite, verify green, commit atomically

**Files:**
- (Verification only; no edits.)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: PASS. Every test that previously asserted an old URL now
asserts a new URL, and the SPA + backend now use that new URL.
`us010` and `us012` were not touched (drawings/posts URLs unchanged)
and should still pass.

If anything fails, do NOT commit. Diagnose:
- `us020` failing? — check `src/state.ts` lines 812 and 933 actually
  got updated.
- `us031` failing? — check `src/state.ts` line 710 actually got
  updated.
- A `200 → 404` failure in a dev smoke or e2e test? — likely the
  rewrite in `vite.config.js` Step 2 has a wrong slice index or the
  `netlify.toml` splat rule is mistyped.

- [ ] **Step 2: Run the linter**

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 3: Manual dev-server smoke test**

Run (in a separate terminal): `npm start`

Then in a browser, open `http://127.0.0.1:8888`. Verify:

1. The page loads.
2. Sign in with an atproto handle. The OAuth round-trip must
   complete and land on `/api/auth-callback` (visible briefly in the
   address bar before the SPA takes over).
3. After login, `http://127.0.0.1:8888/api/whoami` returns 200 with
   the session payload.
4. `http://127.0.0.1:8888/.well-known/oauth-client-metadata.json`
   returns a document whose `redirect_uris` array is
   `["http://127.0.0.1:8888/api/auth-callback"]`.

If any of those fail, stop and diagnose before committing.

- [ ] **Step 4: Commit Phase 2 as one atomic change**

```bash
git add netlify.toml vite.config.js \
    netlify/functions/stamps-refund.ts \
    netlify/functions/stamps-gifts-refund.ts \
    netlify/lib/auth/atproto.ts \
    src/state.ts src/routes/login.ts \
    test/us016-stamp-lots-api.test.ts \
    test/us020-share-state.test.ts \
    test/us031-postcard-send-route.test.ts \
    test/us039-rate-limit-endpoints.test.ts

git commit -m "$(cat <<'EOF'
refactor: flatten /api/* URL paths to single-segment names

Every nested /api/foo/bar URL becomes /api/foo-bar so that
netlify.toml and vite.config.js can each carry a single splat
rule instead of a 15-entry mapping table that must stay in sync.

The two refund handlers parsed event.path by anchoring on the
literal 'refund' segment, which no longer exists in the new URL;
both anchors updated to match the new path shape.

External webhook URLs (Resend, Autumn) must be updated in the
respective provider dashboards immediately after this lands.
EOF
)"
```

---

## Phase 3: Update operator documentation

### Task 13: Update `README.md` endpoint references

**Files:**
- Modify: `README.md` (lines 128, 132, 141, 142, 143, 165, 174, 178, 200)

- [ ] **Step 1: Update the atproto OAuth flow section**

Replace, by line:

```
line 128:  /api/auth/login   → /api/auth-login
line 132:  /api/auth/callback → /api/auth-callback
line 141:  /api/auth/login   → /api/auth-login
line 142:  /api/auth/callback → /api/auth-callback
line 143:  /api/auth/logout  → /api/auth-logout
```

- [ ] **Step 2: Update the Autumn webhook setup section**

```
line 165:  /api/billing/webhook → /api/billing-webhook
line 200:  /api/billing/webhook → /api/billing-webhook
```

- [ ] **Step 3: Update the Resend webhook setup section**

```
line 174:  /api/webhooks/resend → /api/webhooks-resend
line 178:  /api/webhooks/resend → /api/webhooks-resend
```

- [ ] **Step 4: Verify no stale paths remain in README**

Run: `grep -n '/api/[a-z]*/' README.md`

Expected: only matches the unchanged URLs `/api/drawings/...`,
`/api/posts/...`, or the splat reference `/api/*`. If anything like
`/api/auth/...`, `/api/shares/...`, `/api/billing/webhook`,
`/api/webhooks/resend` shows up, edit the offending line.

- [ ] **Step 5: Run lint (markdown only — README isn't a JS file)**

Run: `npm run lint`

Expected: PASS. (`npm run lint` covers TS/JS only; this is a smoke
check that nothing else got broken in passing. Skip if lint scope
doesn't include docs.)

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: update README endpoint references to flat /api/* paths"
```

---

### Task 14: Update `CLAUDE.md` routing guidance

**Files:**
- Modify: `CLAUDE.md` (the "Local development" section)

- [ ] **Step 1: Replace the stale `apiRewrites` paragraph**

The current `CLAUDE.md` instructs future devs to keep
`apiRewrites` in `vite.config.js` in sync with `[[redirects]]` in
`netlify.toml`. After Phase 2 there is no `apiRewrites` array.

Find the paragraph that begins:
"Vite's `server.proxy` (in `vite.config.js`) forwards `/api/*`…"
and replace the entire paragraph (everything up to but not
including the next paragraph that begins "`server.strictPort:
true`…") with:

```markdown
Vite's `server.proxy` (in `vite.config.js`) forwards `/api/*`
and `/.well-known/oauth-client-metadata.json` to `:9999`, mirroring
the two `[[redirects]]` entries in `netlify.toml`. Both the
redirect table and the proxy use a single splat (`/api/* →
/.netlify/functions/:splat`) — to add a new endpoint, create
`netlify/functions/<kebab-name>.ts` and call `/api/<kebab-name>`
from the SPA. URLs never have more than one segment after `/api/`;
nested URL paths like `/api/foo/bar` will 404 by design. Path
parameters (e.g. `/api/stamps-refund/:lot_id`) are fine — the
splat passes them through to the function.
```

- [ ] **Step 2: Verify nothing else in CLAUDE.md still describes the old shape**

Run: `grep -n 'apiRewrites\|/api/auth/\|/api/shares/\|/api/postcards/\|/api/billing/webhook\|/api/webhooks/resend\|/api/stamps/' CLAUDE.md`

Expected: no matches. If matches appear, update each in-place to
the new flat form.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md routing guidance for flat /api/* shape"
```

---

## Post-merge operator runbook

After this PR merges and deploys (NOT part of the PR itself, but
required for the cutover):

1. Open the Resend dashboard webhook configuration. Change the URL
   from `/api/webhooks/resend` to `/api/webhooks-resend`. Hit save.
   (The webhook secret stays the same.)
2. Open the Autumn dashboard webhook configuration. Change the URL
   from `/api/billing/webhook` to `/api/billing-webhook`. Hit save.
3. From each dashboard, fire a "test event" and confirm a 200 comes
   back from the function logs.

Any events queued by Resend or Autumn between deploy and dashboard
update will retry until they hit the new URL. Both
`refundPostcardBounce` (Resend bounce path) and `applyStampCheckout`
(Autumn checkout path) are idempotent under retry — re-deliveries
of the same event cannot double-credit or double-refund. See spec
Section "Deploy choreography" for the full rationale.

---

## Self-review

Coverage of spec sections:

- "URL mapping" — Tasks 5–7 (tests + SPA + OAuth constant) +
  Task 10 (netlify.toml) + Task 11 (vite.config.js).
- "Function-file changes / No rename needed" — confirmed in Phase 1
  preamble (the kebab-case files are untouched).
- "Function-file changes / Flatten the four directory-style
  functions" — Tasks 1–4.
- "Function-file changes / Fix two path parsers" — Tasks 8–9.
- "Routing collapse / netlify.toml" — Task 10.
- "Routing collapse / vite.config.js" — Task 11.
- "Client call-sites" — Tasks 6 (state.ts + login.ts), 7 (atproto.ts),
  and 5 (tests).
- "Operator docs" — Task 13.
- CLAUDE.md routing guidance (caught in self-review, not in spec
  but logically scoped to this refactor) — Task 14.
- "Deploy choreography" — Post-merge runbook section above.
- "Verification" — Task 12 Steps 1–3.
- "Implementation phases" — directly mapped: spec phase 1 = plan
  Phase 1, spec phase 2 = plan Phase 2 (atomic), spec phase 3 =
  plan Phase 3.

No placeholders. All file paths exact. All replacement code is
shown in full where edits are required. Path-parser fix is consistent
between Tasks 8 and 9 (same idx-guard pattern, different anchor
string).
