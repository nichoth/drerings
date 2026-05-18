# Share Quota — Test Requirements

Maps every acceptance criterion in
`docs/design-plans/2026-05-17-share-quota.md` to either an automated
test or a documented human verification procedure. Cross-references
the implementation phases in
`docs/implementation-plans/2026-05-17-share-quota/phase_01.md` through
`phase_08.md`.

## Test infrastructure overview

The project has two test runners (per CLAUDE.md and Phase 8):

- **`npm test`**: bundles `test/index.ts` via esbuild and pipes
  through `tapout`. Used for pure-logic / TAP-style tests written
  with `@substrate-system/tapzero`.
- **`npx vitest run`** (or `npm run test:e2e`): runs vitest-style
  `test/us*.test.ts` files. Used for DB-mocked tests where
  `@netlify/database` is replaced via `vi.doMock`. Canonical mocking
  pattern lives in `test/us003-debit-stamp.test.ts`.

No tests hit a real Postgres — every "DB-touching" test mocks the
database. This is a known trade-off: integration-flavored ACs
(AC4.4 timezone-driven `month_key`, AC4.5 concurrent confirms via
`SELECT … FOR UPDATE`, AC4.6 unique-constraint violations) are
covered by mock-driven simulations of the SQL contract rather than
by a real Postgres transaction. The corresponding mocks therefore
need to **mimic the SQL semantics that the test is asserting on**:
return increasing `count` values across calls for AC4.5, raise
Postgres error code `23505` to test AC4.6's
`IdempotencyConflictError` mapping, and exercise
`Intl.DateTimeFormat` directly for AC4.4. Each entry below calls
out where this is load-bearing.

New test files added by this feature follow the `test/us020-*.test.ts`
pattern.

---

## AC1 — Bluesky OAuth login works

Verified primarily in Phase 4 (atproto OAuth revival). Most of AC1
is end-to-end behavior against the live Bluesky PDS that cannot
sensibly be unit-tested; AC1.4 has dedicated automated coverage
because the failure modes (missing/mismatched state) are
deterministic at the handler boundary.

### AC1.1
**Verbatim:** "User submits a valid Bluesky handle on `/login`;
after redirect they return authed with a `users` row keyed by their
DID."

**Approach:** Human verification.

**Justification:** Exercises the full OAuth handshake against a
real Bluesky PDS (handle resolution → PDS discovery → PAR →
authorize → token exchange). No mock substitute can prove the
integration works; Phase 4 explicitly lists this as a manual step
(`phase_04.md` Task 8 Step 3 "End-to-end test (manual)").

**Manual steps:**
1. Start the dev server.
2. Navigate to `/login`.
3. Submit a known-good Bluesky handle (e.g. `yourhandle.bsky.social`).
4. Approve the consent screen at the PDS.
5. Confirm: browser lands back on `/` with the `drerings_auth`
   cookie set.
6. Curl `/api/whoami` with the cookie: expect 200 with
   `{ id, did, handle, stamps_balance }`.
7. `psql ... -c "SELECT id, did, handle FROM users WHERE did =
   '<your-did>'"` returns exactly one row whose `did` matches the
   handle's DID.

### AC1.2
**Verbatim:** "Returning user with an existing `users.did` row logs
in again; their `handle` and `handle_updated_at` columns are
refreshed (no duplicate row)."

**Approach:** Automated (vitest, mock-based) **plus** human
verification of the SQL-level upsert.

**Phase / file:** Phase 4, Task 12B.
**File path:** `/Users/nick/code/drerings/test/us020-auth-callback.test.ts`
**Test name (pattern):** `it('refreshes handle on re-login for
existing DID (AC1.2)', ...)` — already specified in `phase_04.md`
Task 12B.

**What it asserts:** The callback handler calls
`upsertOAuthUser(did, handle)` with the freshly-fetched handle. The
mock returns `wasInserted: false`, proving the returning-user code
path was exercised. The SQL contract (`INSERT … ON CONFLICT (did)
DO UPDATE SET handle = EXCLUDED.handle, handle_updated_at = now()`)
is enforced by Phase 1 migration 0010's `UNIQUE (did)` constraint.

**Trade-off note:** the actual `ON CONFLICT` semantics live in SQL
and are not asserted by the mock. A human verification step covers
the SQL contract:

**Manual steps (SQL contract):**
1. Log in with a handle, confirm a `users` row exists.
2. Change your Bluesky handle (or simulate it by updating the PDS
   response).
3. Log in again with the same DID.
4. `SELECT count(*) FROM users WHERE did = '<your-did>'` returns 1
   (no duplicate).
5. `SELECT handle, handle_updated_at FROM users WHERE did = ...`
   shows the new handle and a fresh timestamp.

### AC1.3
**Verbatim:** "Logout clears the `drerings_auth` cookie and
`whoami` returns 401."

**Approach:** Human verification (no dedicated automated test
in any phase).

**Justification:** Phase 4 Task 9 (logout endpoint) lists only a
manual verification step. Tests in Phase 8 confirm `whoami`'s 401
path on missing/invalid session generally, but no automated test
specifically asserts that a successful `POST /api/auth/logout`
emits a cookie-clearing `Set-Cookie` header AND that a subsequent
`whoami` returns 401. **Gap noted below — see Gaps section.**

**Manual steps:**
1. Log in (per AC1.1).
2. `POST /api/auth/logout` with the `drerings_auth` cookie.
3. Inspect response `Set-Cookie`: expect
   `drerings_auth=; Max-Age=0` (or equivalent expiry-in-the-past).
4. Curl `/api/whoami` with the same (now-cleared) cookie jar:
   expect 401.

### AC1.4
**Verbatim:** "Callback called with a missing or mismatched
`state` parameter returns 400 and writes no `users` row."

**Approach:** Automated, unit test.

**Phase / file:** Phase 4, Task 12B.
**File path:** `/Users/nick/code/drerings/test/us020-auth-callback.test.ts`
**Test names:**
- `it('returns 400 when state is missing from query', ...)`
- `it('returns 400 when code is missing from query', ...)`
- `it('returns 400 when client.callback rejects (mismatched state)', ...)`

**What it asserts:** For each of the three failure shapes, the
handler returns `statusCode === 400` AND the mocked
`upsertOAuthUser` spy is never called (proving no `users` row
write was attempted).

---

## AC2 — Subscription model is fully removed

Verified by Phases 2 (code removal) and 3 (stamp pack collapse),
plus Phase 8 (test suite cleanup).

### AC2.1
**Verbatim:** "Any authed user can save a drawing, reopen it, and
publish it to a public URL — the subscription gate is gone."

**Approach:** Automated (vitest, mock-based) for the save/publish
endpoints; human verification for the full UI roundtrip.

**Phase / file:** Phase 2 (gates removed) + Phase 8 Task 3 (test
fixtures updated). Tests live in existing files updated during
Phase 8:
- `/Users/nick/code/drerings/test/us008-save-drawing-api.test.ts`
- `/Users/nick/code/drerings/test/us011-publish-post-api.test.ts`

**What it asserts:** After Phase 8 Task 3 sweeps
`subscription_status: 'active'` out of the fixtures, these tests
exercise the save/publish endpoints with a plain authed-user
fixture (no subscription field) and assert the endpoints succeed.
A subscription-required failure case (if any survived from prior
phases) is removed in Phase 8 Task 3.

**Note:** Phase 2 also deletes `test/us016-paid-gating.test.ts`,
which previously asserted the inverse (non-paid users blocked from
save/publish). Its absence after Phase 8 is itself part of the
AC2.1 verification — see AC8.1.

**Manual steps (UI roundtrip):**
1. Sign in as a brand-new account (no purchases).
2. Draw something.
3. Click Save — succeeds (no "Subscribe to save" CTA).
4. Reload the page; reopen the saved drawing.
5. Publish to a public URL — succeeds.
6. Visit the public URL anonymously: page loads.

### AC2.2
**Verbatim:** "`users` rows have no `subscription_status` or
`subscription_current_period_end` columns; `SessionUser` and
`AccountDetails` do not expose them."

**Approach:** Two-part — schema half by human verification of the
applied migration; type half automated by Phase 8's final grep.

**Phase / file:** Phase 1 Task 1 (migration 0010 drops the columns),
Phase 2 (removes type fields), Phase 8 Task 6 (`grep` sweep).

**Automated check:** Phase 8 Task 6's verification script:

```bash
grep -rn "subscription_status\|subscription_current_period_end" \
    src/ netlify/ --include="*.ts" --include="*.tsx"
```

Must return zero matches in production code. This is run as part of
the Done-When checklist; it has no dedicated `.test.ts` file but it
**is** an automated grep gate. If desired, codify this as a
TAP-style test in `test/index.ts` that reads each `.ts` file under
`src/` + `netlify/` and asserts no matches. Recommend adding such a
test as a regression guard.

**Manual steps (schema):**
1. After migration 0010 applies, run `\d users` in psql.
2. Confirm `subscription_status` and
   `subscription_current_period_end` are not in the column list.

### AC2.3
**Verbatim:** "Stamp packs in `src/stamp-packs.ts` reduce to
exactly two entries with IDs `10_stamps` (10 stamps / $5) and
`25_stamps` (25 stamps / $10)."

**Approach:** Automated.

**Phase / file:** Phase 3 Task 4 updates existing tests.
**File path:** `/Users/nick/code/drerings/test/us005-stamp-packs.test.ts`

**What it asserts:** After the Phase 3 updates,
`us005-stamp-packs.test.ts` asserts:
- Exactly two keys in `PACK_DEFINITIONS`.
- Keys are `'10_stamps'` and `'25_stamps'`.
- `count` and `priceCents` match the design (10/$500, 25/$1000).

**Companion tests (also updated in Phase 3 Task 4):**
- `/Users/nick/code/drerings/test/us007-buy-pack-modal.test.ts` —
  fixtures use new IDs.
- `/Users/nick/code/drerings/test/us014-billing-store.test.ts` —
  product ID mapping uses new IDs.

### AC2.4
**Verbatim:** "`State.StartCheckout`, `isPaid`, and the
subscription email form on `/pricing` no longer exist; references
to them anywhere in the codebase fail a search."

**Approach:** Automated grep gate (run as part of Phase 8 Task 6's
final cross-search). The Phase 7 pricing-page test also covers
half of this.

**Phase / file:**
- Phase 7 Task 4: `/Users/nick/code/drerings/test/us020-pricing-page.test.ts`
- Phase 8 Task 6: grep sweep.

**`us020-pricing-page.test.ts` asserts:**
- `it('does NOT include a subscription email form', ...)` — queries
  `container.querySelector('form.pricing-checkout-form')` and
  expects `null`.

**Grep gate (Phase 8 Task 6):** Must return zero matches in
production code for `StartCheckout`, `isPaid`,
`subscription_status`. Recommend codifying as a TAP-style
regression test (same recommendation as AC2.2).

---

## AC3 — Authed-only sharing

Split across server endpoints (Phase 5) and client wiring (Phase 6).

### AC3.1
**Verbatim:** "An authed user viewing a post they own sees a Share
button."

**Approach:** Automated (component test) + human smoke test.

**Phase / file:** Phase 6 Task 5 ships the wiring. No dedicated
component test for AC3.1 is specified in the phase plans.

**What should be asserted (recommended new test):** Render the
`PostRoute` (or the relevant component) with a state where
`state.auth.value.authenticated === true` and `post.value` is owned
by the user. Assert the Share button is in the rendered DOM (query
by role/label, not by text per CLAUDE.md). **Gap noted — see Gaps
section.**

**Manual steps:**
1. Sign in.
2. Open one of your saved drawings and publish it.
3. Navigate to its public URL.
4. Confirm: Share button is visible.

### AC3.2
**Verbatim:** "An anonymous viewer of the same public post URL
does not see a Share button."

**Approach:** Automated (component test) + human smoke test.

**Phase / file:** Phase 6 Task 5 (`canShowShare = …
state.canShare.value …`). No dedicated component test specified.

**What should be asserted (recommended new test):** Same render as
AC3.1 but with `state.auth.value.authenticated === false`. Assert
the Share button is absent. **Gap noted — see Gaps section.**

**Manual steps:**
1. From an incognito window, visit a published public post URL.
2. Confirm: no Share button.

### AC3.3
**Verbatim:** "Calling `POST /api/shares/precheck` without a valid
session returns 401."

**Approach:** Automated (vitest, mock-based).

**Phase / file:** Phase 5 Task 6 ships the endpoint. The phase plan
does not call out an explicit per-AC test file for AC3.3, but the
behavior is small enough to add to the precheck test bundle.

**File path:** `/Users/nick/code/drerings/test/us020-shares-precheck.test.ts`
**Test name (recommended addition):** `it('returns 401 when no
session cookie is present', ...)`

**What it asserts:** Mock `getSession` to return `null`; invoke
the handler; expect `response.statusCode === 401` and no DB calls.

### AC3.4
**Verbatim:** "Calling `POST /api/shares/confirm` without a valid
session returns 401."

**Approach:** Automated (vitest, mock-based).

**Phase / file:** Phase 5 Task 7 ships the endpoint. Mirror of
AC3.3 against the confirm handler.

**File path:** `/Users/nick/code/drerings/test/us020-shares-confirm.test.ts`
(new — add alongside the existing record/precheck tests, or fold
into `us020-shares-record.test.ts` since both handler tests share
session-mocking infrastructure).

**Test name (recommended):** `it('returns 401 when no session
cookie is present', ...)`

**What it asserts:** Mock `getSession` to return `null`; invoke
`netlify/functions/shares/confirm.ts`'s handler; expect
`response.statusCode === 401` and no `recordShare` call.

### AC3.5
**Verbatim:** "First share of the month: server pre-check returns
`{type:'free'}`; client opens the share sheet immediately; no
confirm dialog appears."

**Approach:** Automated. Two layers — server precheck and client
helper.

**Phase / file:**
- Server: Phase 5 Task 8 (`precheckShare` returns `free`).
  `/Users/nick/code/drerings/test/us020-shares-precheck.test.ts` —
  `it('returns free when user has no prior share this month', ...)`.
- Client: Phase 6 Task 7 (`State.ShareDrawing` opens share sheet
  on free).
  `/Users/nick/code/drerings/test/us020-share-state.test.ts` —
  `it('opens share sheet immediately on free precheck', ...)`.

**What they assert:**
- Server test: `precheckShare` returns `{ type: 'free', month_key }`
  when the DB mock reports zero free events this month.
- Client test: When `/api/shares/precheck` returns `free`,
  `State.ShareDrawing` calls `openShareSheet`, no
  `state.shareDialog` is set to type `confirm`, and `result.ok ===
  true`.

### AC3.6
**Verbatim:** "Second share of the same month with stamps_balance
> 0: pre-check returns `{type:'paid'}`; client shows the confirm
dialog with a Cancel and a Confirm button."

**Approach:** Automated. Two layers — server precheck and client
helper, plus the dialog component.

**Phase / file:**
- Server precheck (paid path):
  `/Users/nick/code/drerings/test/us020-shares-precheck.test.ts`
  — Phase 5 Task 8 (recommended test case `it('returns paid when
  free used and stamps available', ...)`).
- Client helper:
  `/Users/nick/code/drerings/test/us020-share-state.test.ts` —
  `it('sets shareDialog to confirm on paid precheck', ...)`.
- Dialog component:
  `/Users/nick/code/drerings/test/us020-confirm-stamp-dialog.test.ts`
  — Phase 6 Task 6 (cancel + confirm click handlers).

**What they assert:**
- Server: precheck returns `{ type: 'paid', stamps_balance,
  month_key }` when the free count is non-zero and balance > 0.
- Client: `state.shareDialog.value.type === 'confirm'` after the
  precheck; `fetch` was called exactly once (no automatic
  confirm).
- Dialog: Cancel and Confirm buttons render and call their
  respective callbacks.

### AC3.7
**Verbatim:** "Pre-check + confirm with the same `idempotency_key`
for the same `drawing_id` is treated as one share (no duplicate
row, no double debit)."

**Approach:** Automated (vitest, mock-based) at the server lib
level; the client helper test covers the key-reuse side.

**Phase / file:**
- Server: Phase 5 Task 8 — `precheckShare` returns `reused` when an
  existing event matches.
  `/Users/nick/code/drerings/test/us020-shares-precheck.test.ts` —
  recommended `it('returns reused when an existing event matches
  (user_id, idempotency_key)', ...)`.
- Server: Phase 5 Task 9 — `recordShare`'s "earlyDup" branch
  returns the existing event without re-inserting.
  `/Users/nick/code/drerings/test/us020-shares-record.test.ts` —
  recommended `it('does not double-insert or double-debit when
  the same idempotency_key is replayed for the same drawing_id',
  ...)`.
- Client: `/Users/nick/code/drerings/test/us020-share-state.test.ts`
  — `it('reuses the supplied idempotencyKey on confirm', ...)`
  (Phase 6 Task 7).

**What they assert:**
- Server precheck: when an event with the given key already exists
  for the user and matches the drawing_id, return
  `{ type: 'reused', was_free }` without any INSERT.
- Server record: replay does not call `INSERT INTO share_events`
  again, does not call `debitStamp`, and returns
  `{ type: 'recorded', was_free, stamps_balance }` mirroring the
  prior outcome.
- Client: the same `idempotency_key` is sent on confirm as was
  generated for the precheck.

**Trade-off:** Mock-based; the actual UNIQUE constraint
enforcement happens in Phase 1's migration 0011. AC4.6 (below)
exercises the constraint-violation path directly.

---

## AC4 — Quota accounting is correct

The accounting-correctness ACs are the heaviest cluster. All are
covered by Phase 5's `recordShare` tests
(`test/us020-shares-record.test.ts`). AC4.4, AC4.5, AC4.6 each
carry an integration-vs-mock trade-off; flagged where relevant.

### AC4.1
**Verbatim:** "First confirmed share of a user's calendar month
(in their browser TZ) writes a `share_events` row with `was_free =
true` and no `stamp_transactions` row."

**Approach:** Automated (vitest, mock-based).

**Phase / file:** Phase 5 Task 9.
**File path:** `/Users/nick/code/drerings/test/us020-shares-record.test.ts`
**Test name (Phase 5 Task 9 — "Free path"):** `it('records was_free
=true and does not debit on first share of the month', ...)` (case
1 in the phase plan).

**What it asserts:** Mock DB returns `count=0` for the free-this-
month query; `recordShare` executes the free-path INSERT (params
include `was_free=true`); `debitStamp` is not called (no INSERT
into `stamp_transactions`); the result is
`{ type: 'recorded', was_free: true, stamps_balance }`.

### AC4.2
**Verbatim:** "Subsequent confirmed share in the same month writes
a `share_events` row with `was_free = false` AND a
`stamp_transactions` row with `reason = 'share'`, `delta = -1`,
and `reference_id = share_events.id`."

**Approach:** Automated (vitest, mock-based). Two complementary
tests cover the wiring at different layers.

**Phase / file:**
- Phase 5 Task 1+2 — `debitStamp` records `reason='share'`.
  `/Users/nick/code/drerings/test/us003-debit-stamp.test.ts` —
  `it('records reason=share when reason option is share', ...)`
  AND `it('defaults reason to send when not provided', ...)`.
- Phase 5 Task 9 — `recordShare` calls `debitStamp` with
  `reason: 'share'` and `referenceId = share_events.id`.
  `/Users/nick/code/drerings/test/us020-shares-record.test.ts` —
  paid-path test (case 2 in the phase plan).

**What they assert:**
- `debitStamp` test: the INSERT INTO `stamp_transactions` is called
  with `'share'` in the params array, and the supplied
  `referenceId` is in the params.
- `recordShare` test: when `count=1` (free used) and balance > 0,
  the share_events INSERT has `was_free=false`, `debitStamp` is
  called with `{ reason: 'share', referenceId: <inserted id> }`,
  and the COMMIT happens before returning.

### AC4.3
**Verbatim:** "A share in a new calendar month is free again, even
if the previous month's free was already used."

**Approach:** Automated (vitest, mock-based) for the partial-index
read; pure-helper test for the month key derivation.

**Phase / file:** Phase 5 Tasks 3 and 4 (`monthKeyFor`,
`precheckShare`).
**File path:** `/Users/nick/code/drerings/test/us020-shares-precheck.test.ts`
**Test name (recommended addition):** `it('returns free when prior
month had free used but this month has none', ...)`.

**What it asserts:** Mock returns `count=0` for the query filtered
by the *current* `month_key` (different string from the prior
month's key). `precheckShare` returns `{ type: 'free' }` regardless
of any historical events tagged with a different `month_key`. The
test seeds the mock to return `count=0` when params include the
new month, and `count=1` when they include the old month, proving
the partial-index lookup is month-scoped.

### AC4.4
**Verbatim:** "Month boundaries are computed in the IANA timezone
the client supplies — same instant in different TZs can yield
different `month_key` values."

**Approach:** Automated (pure-helper test, no DB needed).

**Phase / file:** Phase 5 Task 8.
**File path:** `/Users/nick/code/drerings/test/us020-shares-precheck.test.ts`
**Test name:** `it('formats year-month using the supplied
timezone', ...)` (existing in the phase plan).

**What it asserts:** `monthKeyFor('America/New_York',
new Date('2026-01-01T00:30:00Z')) === '2025-12'` AND
`monthKeyFor('UTC', new Date('2026-01-01T00:30:00Z')) === '2026-01'`.
Same instant, different IANA names, different keys.

**Trade-off:** This is a pure-function test. The
**server-side** behavior of writing the right `month_key` into
`share_events` is covered indirectly by the `recordShare` test
(which assembles the INSERT params from `monthKeyFor`'s output).
A real integration test against Postgres would prove the column
actually persists the right value — out of scope per the project's
mock-only pattern.

### AC4.5
**Verbatim:** "Two concurrent confirms for the same user with no
prior share that month: at most one is recorded as `was_free =
true`; the other either records as paid (if stamps available) or
returns `blocked`."

**Approach:** Automated (vitest, mock-based simulation).

**Phase / file:** Phase 5 Task 9.
**File path:** `/Users/nick/code/drerings/test/us020-shares-record.test.ts`
**Test name:** `it('serializes concurrent confirms via FOR UPDATE
re-check', ...)` (specified in the phase plan).

**What it asserts:** The mock returns `count=0` on the *first*
free-count query and `count=1` on the *second* (simulating that
the first transaction's INSERT became visible before the second's
re-check under the FOR UPDATE lock). The two `recordShare` calls
yield exactly one `was_free=true` outcome; the second is either
paid (when balance > 0) or blocked (when balance is 0).

**Trade-off:** This is a *simulation* of the lock semantics, not a
real concurrency test. A real Postgres-backed test could spawn two
transactions and observe genuine row-lock contention. The project
does not currently run such tests; the design plan accepts that
risk because the SQL contract is small (`SELECT … FROM users …
FOR UPDATE`). If a future regression is suspected, a one-off
integration test against a real Postgres instance is the
recommended escalation. **Documented trade-off.**

### AC4.6
**Verbatim:** "A `confirm` request with an `idempotency_key` that
was already used for a different `drawing_id` returns 409."

**Approach:** Automated (vitest, mock-based) at two layers:
the lib (throws `IdempotencyConflictError`) and the handler (maps
to HTTP 409).

**Phase / file:** Phase 5 Tasks 7, 8, 9.
**File paths:**
- `/Users/nick/code/drerings/test/us020-shares-precheck.test.ts` —
  recommended `it('throws IdempotencyConflictError when prior
  event has a different drawing_id', ...)`.
- `/Users/nick/code/drerings/test/us020-shares-record.test.ts` —
  recommended `it('throws IdempotencyConflictError when prior
  event has a different drawing_id (early-dup branch)', ...)`
  AND a follow-up `it('maps Postgres 23505 unique_violation to
  IdempotencyConflictError', ...)`.
- A handler-level test in `test/us020-shares-confirm.test.ts` (new
  — recommended): `it('returns 409 when IdempotencyConflictError
  is thrown', ...)`. Mock `recordShare` to throw the error; assert
  `response.statusCode === 409`.

**What they assert:**
- Lib: `precheckShare` and `recordShare` both detect the
  `(user_id, idempotency_key)` collision against a different
  `drawing_id` and throw `IdempotencyConflictError`. The
  `recordShare` test additionally proves the constraint-violation
  fallback by simulating a `23505` error from the INSERT (`code:
  '23505'` on the thrown object) — `isUniqueViolation(err)` must
  re-throw as `IdempotencyConflictError`.
- Handler: 409 is returned when the lib throws.

**Trade-off:** Same as AC4.5 — the actual UNIQUE constraint is
enforced by Phase 1's migration 0011, not by the mock. The test
asserts the *error mapping*; a real Postgres run would prove the
INSERT actually fails. The fallback `isUniqueViolation` check
in `recordShare` exists precisely because a race between the
early-dup read and the INSERT could surface as a `23505` — testing
that path with `code: '23505'` in the mock is the closest the
project's harness can get.

---

## AC5 — Blocked path when out of free + stamps

### AC5.1
**Verbatim:** "User has 0 stamps and has used their free share
this month; pre-check returns `{type:'blocked',
reason:'no_free_no_stamps'}`; confirm also returns `blocked`."

**Approach:** Automated (vitest, mock-based).

**Phase / file:**
- Phase 5 Task 8 — `precheckShare` blocked path.
  `/Users/nick/code/drerings/test/us020-shares-precheck.test.ts` —
  recommended `it('returns blocked when free used and stamps=0',
  ...)`.
- Phase 5 Task 9 — `recordShare` blocked path.
  `/Users/nick/code/drerings/test/us020-shares-record.test.ts` —
  blocked-path case (case 3 in the phase plan).

**What they assert:**
- precheck: `{ type: 'blocked', reason: 'no_free_no_stamps',
  stamps_balance: 0, month_key }`.
- record: `{ type: 'blocked', reason: 'no_free_no_stamps' }` with
  no INSERT into `share_events` and no debit.

### AC5.2
**Verbatim:** "Client renders a 'You're out of stamps' message
containing a link to `/pricing`; the Buy Stamps modal is NOT
auto-opened."

**Approach:** Automated (vitest component test) for the message
component; client-helper test for the state transition.

**Phase / file:** Phase 6 Task 4 (`NoStampsMessage`) and Phase 6
Task 7 (state helper).

**Files / tests:**
- `/Users/nick/code/drerings/test/us020-share-state.test.ts` —
  `it('renders blocked dialog on blocked precheck', ...)` —
  asserts `state.shareDialog.value.type === 'blocked'` after the
  blocked precheck response.
- `NoStampsMessage` itself has no dedicated test in the phase
  plans. **Gap noted — see Gaps section.**

**What `us020-share-state.test.ts` asserts:** After a `blocked`
precheck, `state.shareDialog.value` is set to `{ type: 'blocked',
message }` and `state.buyPackModalOpen.value` is never set to
`true` (the modal is not auto-opened — the message links to
`/pricing` instead).

**Recommended addition:** A small component test for
`NoStampsMessage` asserting it renders an `<a href="/pricing">`
element. Per CLAUDE.md, query by role/href, not by text content.

---

## AC6 — Confirm-dialog interactions

### AC6.1
**Verbatim:** "User clicks Cancel on the confirm dialog; no
`confirm` request is sent; no `share_events` row is written;
stamps_balance is unchanged."

**Approach:** Automated (component + state tests).

**Phase / file:** Phase 6 Task 6 (dialog component test) and Phase 6
Task 2 (`State.CancelShareDialog`).

**File paths and tests:**
- `/Users/nick/code/drerings/test/us020-confirm-stamp-dialog.test.ts`
  — `it('calls onCancel when Cancel is clicked', ...)` — asserts
  `onCancel` is called and `onConfirm` is not.
- Recommended state-level test in
  `/Users/nick/code/drerings/test/us020-share-state.test.ts`:
  `it('CancelShareDialog clears the dialog and sends no fetch',
  ...)` — assert no `fetch` call occurs.

### AC6.2
**Verbatim:** "User clicks Confirm; the `confirm` request is sent
exactly once; on success the share sheet opens."

**Approach:** Automated (component + state tests).

**Phase / file:** Phase 6 Tasks 6 and 7.

**Files / tests:**
- Component: `us020-confirm-stamp-dialog.test.ts` — `it('calls
  onConfirm when Use 1 stamp is clicked', ...)`.
- State: `us020-share-state.test.ts` — `it('reuses the supplied
  idempotencyKey on confirm', ...)` AND (recommended addition)
  `it('calls openShareSheet after a successful recorded confirm',
  ...)` — assert the `openShareSheet` callback was invoked exactly
  once and `fetch` was called exactly once.

### AC6.3
**Verbatim:** "Network error on `confirm` results in a visible
error state and no `share_events` row; retrying with the same
`idempotency_key` is safe."

**Approach:** Automated. Two halves — the network-error UI state
(client) and the retry safety (server).

**Phase / file:**
- Client: Phase 6 Task 7.
  `/Users/nick/code/drerings/test/us020-share-state.test.ts` —
  `it('surfaces a network error and does NOT clear dialog', ...)`.
- Server (retry safety): Phase 5 Task 9 — the early-dup branch
  test (AC3.7 / AC4.6 coverage).

**What they assert:**
- Client: `fetch` throws; `state.shareError.value` is set to a
  user-visible string; `result.ok === false` with
  `reason === 'network'`; `state.shareDialog.value` is not
  cleared (the user can retry from the same dialog).
- Server: a replay with the same `idempotency_key` short-circuits
  via the early-dup branch and returns the original outcome
  without writing again. (This is the same assertion as AC3.7's
  server side.)

---

## AC7 — Pricing page reflects the new model

### AC7.1
**Verbatim:** "`/pricing` shows one info card ('Sign in (free)')
summarizing the included features and the 1-free-share-per-month
rule."

**Approach:** Automated (component test) plus human visual check.

**Phase / file:** Phase 7 Task 4.
**File path:** `/Users/nick/code/drerings/test/us020-pricing-page.test.ts`

**What it asserts:** The phase plan ships three tests in this file.
Two relate to AC7.1 indirectly:
- `it('shows two pack rows', ...)` — confirms the page renders the
  pack section.
- `it('does NOT include a subscription email form', ...)` —
  confirms the legacy form is gone.

**Gap:** No test specifically asserts the *presence* of the
"Sign in (free)" info card. Per CLAUDE.md "do not test for
specific text content in HTML," a text-content assertion is
discouraged, but a structural assertion is fine — query for
`.pricing-tier-card` (the class added by Phase 7's CSS) and
expect exactly one element. **Recommended addition — see Gaps
section.**

**Manual visual check:**
1. Visit `/pricing`.
2. Confirm a card with the heading "Sign in (free)" is at the top,
   listing the feature bullets and the "1 free share per month"
   rule.

### AC7.2
**Verbatim:** "`/pricing` shows two stamp pack rows (`10_stamps` /
$5, `25_stamps` / $10), each with a Buy button that opens
`BuyPackModal` for the matching pack."

**Approach:** Automated.

**Phase / file:** Phase 7 Task 4.
**File path:** `/Users/nick/code/drerings/test/us020-pricing-page.test.ts`
**Test names:**
- `it('shows two pack rows', ...)` — `querySelectorAll('.pack-row')
  .length === 2`.
- `it('opens BuyPackModal with productId when Buy is clicked',
  ...)` — spies on `State.OpenBuyPackModal`, clicks the first Buy
  button, asserts the spy was called with the pack's productId
  (matching `/^(10|25)_stamps$/`).

**What they assert:** Exactly two pack rows render, and each Buy
button dispatches `State.OpenBuyPackModal(state, productId)` with
the matching pack ID.

---

## AC8 — Suite-level cleanup

### AC8.1
**Verbatim:** "`npm test && npm run lint` is clean; no tests
reference subscription gating, `subscription_status`, magic links,
passkeys, or the removed stamp pack IDs."

**Approach:** Automated (gauntlet of two CI commands plus a grep
gate), executed as the final verification in Phase 8 Task 6.

**Phase / file:** Phase 8 Task 6.

**Commands (CI gate):**
```bash
npm test && npm run lint && npx vitest run
```

All three must exit 0.

**Grep gate (additional check in Phase 8 Task 6):**
```bash
grep -rn "subscription_status\|isPaid\|StartCheckout\|\
stamps_starter\|stamps_bundle\|stamps_big_bundle\|\
passkeys\|magic_link" \
    src/ netlify/ --include="*.ts" --include="*.tsx"
```

Must return zero matches in production code. The phase plan does
not codify this grep as a TAP test, but doing so is recommended:
add `test/us020-removed-symbols.test.ts` that reads source files
and asserts no occurrence. **Recommended addition — see Gaps
section.**

---

## Gaps and recommended additions

This section lists ACs whose verification path is incomplete or
human-only, with the recommended automated coverage to close the
gap. None of these block shipping, but they reduce regression
risk.

| AC | Status | Recommendation |
|---|---|---|
| AC1.3 (logout clears cookie + whoami 401) | Manual only | Add `test/us020-logout.test.ts` that mocks `getSession` for the pre-logout state, invokes `POST /api/auth/logout`, asserts the `Set-Cookie` header clears `drerings_auth`, then invokes `/api/whoami` with no cookie and asserts 401. |
| AC2.2 (production code has no `subscription_status`) | Grep-only | Codify the grep as a TAP test in `test/index.ts` that walks `src/` and `netlify/` and asserts zero matches. |
| AC2.4 (production code has no `StartCheckout`/`isPaid`) | Grep-only | Same — fold into the same TAP test. |
| AC3.1 (authed user sees Share button) | No dedicated test | Add a component test in `test/us020-post-route.test.ts` rendering the route with an authed state and asserting the Share button is present (query by role). |
| AC3.2 (anonymous user does not see Share button) | No dedicated test | Same file as AC3.1, opposite assertion with an unauthed state. |
| AC3.3, AC3.4 (401 paths for shares endpoints) | Tests not specified in phase plan | Add the 401 cases to `test/us020-shares-precheck.test.ts` and (new) `test/us020-shares-confirm.test.ts`. |
| AC3.7 / AC4.6 (handler-level 409 mapping) | Lib-level only | Add a handler-level test that mocks `recordShare` to throw `IdempotencyConflictError` and asserts the handler returns 409. |
| AC4.5 (real concurrent transactions) | Mock-based simulation | Documented trade-off. Optional: add a one-off integration test against a real local Postgres if the simulation ever fails to catch a regression. |
| AC5.2 (`NoStampsMessage` renders link to `/pricing`) | Component test not specified | Add a small component test for `NoStampsMessage` asserting the rendered DOM contains an `a[href="/pricing"]`. |
| AC6.1 (Cancel sends no `fetch`) | Component covered; helper not | Add `it('CancelShareDialog clears dialog and sends no fetch', ...)` to `test/us020-share-state.test.ts`. |
| AC6.2 (Confirm calls `openShareSheet` exactly once) | Partial | Add an explicit "called exactly once" assertion to the existing `us020-share-state.test.ts` confirm test. |
| AC7.1 (info card presence) | Structural assertion missing | Add `it('renders exactly one .pricing-tier-card', ...)` to `test/us020-pricing-page.test.ts`. |
| AC8.1 (removed-symbol grep) | Manual-shell-only | Codify as `test/us020-removed-symbols.test.ts` (TAP) walking `src/` and `netlify/`. |

## Per-phase summary

| Phase | Provides tests for |
|---|---|
| Phase 1 (migrations) | Schema-shape substrate for AC2.2, AC4.1, AC4.2, AC4.6 (no behavior tests). |
| Phase 2 (remove subscription) | AC2.1, AC2.2, AC2.4 (via grep + type checks). |
| Phase 3 (stamp packs) | AC2.3 (`test/us005-stamp-packs.test.ts` updates). |
| Phase 4 (atproto OAuth) | AC1.4 (`test/us020-auth-callback.test.ts`), AC1.2 partial. Manual for AC1.1, AC1.3 fully. |
| Phase 5 (share endpoints) | AC3.3, AC3.4, AC4.1, AC4.2, AC4.3, AC4.4, AC4.5, AC4.6, AC5.1 (`test/us020-shares-precheck.test.ts`, `test/us020-shares-record.test.ts`, `test/us003-debit-stamp.test.ts` update). |
| Phase 6 (client share flow) | AC3.5, AC3.6, AC3.7 client-side, AC5.2 partial, AC6.1, AC6.2, AC6.3 (`test/us020-share-state.test.ts`, `test/us020-confirm-stamp-dialog.test.ts`). |
| Phase 7 (pricing page) | AC7.1, AC7.2, plus AC2.4 reinforcement (`test/us020-pricing-page.test.ts`). |
| Phase 8 (suite cleanup) | AC8.1 (final `npm test && npm run lint` gauntlet + grep sweep + invariant test for share reason). |
