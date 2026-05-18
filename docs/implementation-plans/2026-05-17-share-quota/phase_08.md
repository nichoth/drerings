# Phase 8: Test Cleanup and Final Verification Implementation Plan

**Goal:** Sweep removed/renamed code paths out of the test suite;
confirm end-to-end behavior; achieve a clean `npm test && npm run lint`.

**Architecture:** No production code is modified in this phase. The
job is to delete obsolete test files, update fixtures that bridge to
the new shapes, and run the verification gauntlet.

**Tech Stack:** vitest + `@substrate-system/tapzero` (test/index.ts +
tapout pipeline).

**Scope:** 8 of 8 phases. Depends on all prior phases.

**Codebase verified:** 2026-05-17

---

## Codebase Investigation Findings

- The test suite has two runners:
  - `npm test` runs `esbuild ./test/index.ts --bundle | tapout` — TAP
    tests via `@substrate-system/tapzero`.
  - `npm run test:e2e` runs `vitest run` — vitest-style tests (mostly
    in `test/us*.test.ts`).
- Tests that exercise removed flows and will need deletion:
  - `test/us016-paid-gating.test.ts` — `isPaid` signal gating.
    **DELETE.**
  - `test/us004-magic-link-api.test.ts` — magic-link endpoint.
    **DELETE.**
  - `test/us004-auth-helpers.test.ts` — magic-link helpers.
    **DELETE.**
  - `test/us005-passkey-api.test.ts`,
    `test/us005-passkey-helpers.test.ts`,
    `test/us005-passkey-ui.test.ts` — all passkey-related.
    **DELETE all three.**
  - `test/us017-billing-cancel.test.ts` — subscription cancel.
    **DELETE.**
  - `test/us013-pricing-page.test.ts` — old two-tier pricing.
    **DELETE** (Phase 7's `us020-pricing-page.test.ts` replaces it).
  - `test/us014-billing-checkout-api.test.ts` — exercised the
    subscription checkout via email. **REVIEW**: if it asserts on
    subscription flow specifically, delete; if it covers stamp pack
    checkout via Autumn (the path still in use), keep and update.
- Tests that will need fixture updates (NOT deletion) because they
  reference `subscription_status` only as part of test scaffolding:
  - `test/us008-save-drawing-api.test.ts` — used to require
    `subscription_status: 'active'` to gate save. After Phase 2 the
    gate is gone, so the fixture should just create an authed user.
  - `test/us008-zero-balance-send.test.ts`,
    `test/us011-publish-post-api.test.ts`,
    `test/us009-signup-grant.test.ts`,
    `test/us017-account-api.test.ts`,
    `test/us017-account-store.test.ts`,
    `test/us017-account-ui.test.ts`,
    `test/us018-logout.test.ts`,
    several others.
  - For each: remove `subscription_status: 'active'` from fixtures and
    replace `email: 'x@y.z'` with `did: 'did:plc:...'`, `handle:
    'x.bsky.social'`. Where the test verified subscription gating
    behavior specifically, delete that assertion.
- Tests that still pass without modification: pure utility tests
  (`home-route.color-picker.test.ts`, `login-route.flows.test.ts` —
  the latter will need the new Bluesky form flow tested).
- **`verifyStampInvariants`** — investigator found this in
  `netlify/lib/stamps.ts` with its test at
  `test/us025-stamp-invariants.test.ts`. The function compares
  `users.stamps_balance` vs sum of `stamp_lots.remaining_count` vs
  sum of `stamp_transactions`. Adding `'share'` to the reason enum
  does not break this. The test still passes — confirm.

---

## Acceptance Criteria Coverage

### share-quota.AC8: Suite-level cleanup
- **share-quota.AC8.1 Success:** `npm test && npm run lint` is clean;
  no tests reference subscription gating, `subscription_status`,
  magic links, passkeys, or the removed stamp pack IDs.

---

## Tasks

<!-- START_TASK_1 -->
### Task 1: Delete obsolete test files

**Files:**
- Delete: `/Users/nick/code/drerings/test/us016-paid-gating.test.ts`
- Delete: `/Users/nick/code/drerings/test/us004-magic-link-api.test.ts`
- Delete: `/Users/nick/code/drerings/test/us004-auth-helpers.test.ts`
- Delete: `/Users/nick/code/drerings/test/us005-passkey-api.test.ts`
- Delete: `/Users/nick/code/drerings/test/us005-passkey-helpers.test.ts`
- Delete: `/Users/nick/code/drerings/test/us005-passkey-ui.test.ts`
- Delete: `/Users/nick/code/drerings/test/us017-billing-cancel.test.ts`
- Delete: `/Users/nick/code/drerings/test/us013-pricing-page.test.ts`

**Step 1: Delete each file**

```bash
cd /Users/nick/code/drerings
rm test/us016-paid-gating.test.ts \
   test/us004-magic-link-api.test.ts \
   test/us004-auth-helpers.test.ts \
   test/us005-passkey-api.test.ts \
   test/us005-passkey-helpers.test.ts \
   test/us005-passkey-ui.test.ts \
   test/us017-billing-cancel.test.ts \
   test/us013-pricing-page.test.ts
```

**Step 2: Check `test/index.ts` for explicit imports**

The TAP tests are bundled from `test/index.ts`. If any of the deleted
files were imported there, remove those imports.

```bash
cd /Users/nick/code/drerings
grep -n "us016-paid-gating\\|us004-magic-link\\|us004-auth-helpers\\|us005-passkey\\|us017-billing-cancel\\|us013-pricing-page" \\
    test/index.ts
```

If any matches, edit `test/index.ts` to remove those imports.

**Step 3: Run the suite**

```bash
cd /Users/nick/code/drerings
npm test
npx vitest run
```

Expected: both runners no longer reference the deleted files. Other
tests still have failures — they get fixed in Tasks 2–3.

**Step 4: Commit**

```bash
cd /Users/nick/code/drerings
git add -A test/
git commit -m "test: delete obsolete subscription/passkey/magic-link tests"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Audit `test/us014-billing-checkout-api.test.ts`

**Files:**
- Modify or delete:
  `/Users/nick/code/drerings/test/us014-billing-checkout-api.test.ts`

**Step 1: Read the file**

Read the whole file (use the Read tool). Determine:

- Does it test subscription checkout (via email)? If yes, those tests
  go away.
- Does it test stamp pack checkout (via product ID)? If yes, those
  tests should pass with the renamed product IDs after Phase 3 — but
  may need fixture updates.

**Step 2: Update or delete**

- Delete any subscription-checkout test cases.
- Update stamp-pack-checkout test cases to use `'10_stamps'` /
  `'25_stamps'` instead of the old IDs (Phase 3 should have updated
  these already, but verify).

If the entire file was subscription-checkout, delete it.

**Step 3: Run**

```bash
cd /Users/nick/code/drerings
npx vitest run test/us014-billing-checkout-api.test.ts
```

Expected: pass, or file gone.

**Step 4: Commit**

```bash
cd /Users/nick/code/drerings
git add -A test/
git commit -m "test(billing-checkout): drop subscription cases; keep stamp-pack"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Sweep `subscription_status`, `email`, `passkeys` references in fixtures

**Files:**
- Bulk update across: `test/us008-*.test.ts`, `test/us009-*.test.ts`,
  `test/us010-*.test.ts`, `test/us011-*.test.ts`,
  `test/us014-*.test.ts`, `test/us015-*.test.ts`,
  `test/us016-stamp-*.test.ts`, `test/us017-*.test.ts`,
  `test/us018-*.test.ts`, `test/us006-session-whoami.test.ts`,
  any others surfaced by grep.

**Step 1: List affected files**

```bash
cd /Users/nick/code/drerings
grep -rln "subscription_status\\|subscription_current_period_end" test/ \\
    2>/dev/null | sort
```

For each file in the result:

- Open the file.
- Remove any property like `subscription_status: 'active'` from
  test-fixture objects representing users.
- Replace `email: 'x@y'` with `did: 'did:plc:test-' + Math.random()`,
  `handle: 'x.bsky.social'` if the user fixture is a `SessionUser`
  shape. (After Phase 4, `SessionUser` has `did`, `handle`, not
  `email`.)
- If a test asserts gating behavior on `subscription_status`, remove
  that assertion entirely (the gate is gone).
- If a test checks that a non-paid user is rejected from saving /
  publishing, delete that test case — every authed user can now save.

**Step 2: Sweep `passkeys` references in fixtures**

```bash
cd /Users/nick/code/drerings
grep -rln "passkeys\\|removePasskey\\|magic_link" test/ 2>/dev/null
```

For each file, remove fixtures referencing the dropped tables. If a
whole test exercises the email-update flow (which is gone), delete
it.

**Step 3: Sweep `email:` in user fixtures**

```bash
cd /Users/nick/code/drerings
grep -rn "email: '" test/ 2>/dev/null | head -50
```

For each fixture creating a user object that should have shape
`SessionUser`, replace `email` with `did` + `handle`. The Postgres
mock results returned by `vi.doMock` should match the new SELECT
columns (`id, did, handle, stamps_balance, autumn_customer_id`).

**Step 4: Run the suite**

```bash
cd /Users/nick/code/drerings
npm test
npx vitest run
```

Iterate: fix each failure, re-run, repeat. The expected outcome is:
- Tests that exercise removed flows: gone.
- Tests that exercise still-valid flows with updated fixtures: pass.

Failures that are NOT shape-related (genuine logic bugs in code from
prior phases) are real bugs — surface them, do not paper over them.

**Step 5: Commit**

Commit in logical batches. For example:
- `test: drop subscription_status from auth fixtures`
- `test: update SessionUser fixtures to DID/handle shape`
- `test: remove magic-link/passkey-only test cases`

Each commit should be testable in isolation. Do not bundle all
changes into one mega-commit.
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Update `test/login-route.flows.test.ts` for Bluesky login UI

**Files:**
- Modify: `/Users/nick/code/drerings/test/login-route.flows.test.ts`

**Step 1: Read the current flow**

The current tests likely exercise email magic-link submission. Phase 4
replaced the login form with a single Bluesky handle input.

**Step 2: Rewrite or delete tests as appropriate**

- Tests that submit an email form: delete or rewrite to submit the
  handle form.
- Tests that exercise the passkey button: delete.
- Add at least one test: submitting a valid handle navigates to
  `/api/auth/login?handle=…`. The redirect is handled via
  `location.assign`; in tests, mock `location.assign` and assert the
  argument.

```ts
import { test } from '@substrate-system/tapzero'
import { render, fireEvent } from '@testing-library/preact'
import { html } from 'htm/preact'
import { LoginRoute } from '../src/routes/login'
import { State } from '../src/state'

test('submitting the handle navigates to /api/auth/login', async t => {
    const state = State()
    const assigned:string[] = []
    const originalAssign = location.assign
    // @ts-expect-error: monkey-patch for test
    location.assign = (url:string) => { assigned.push(url) }

    try {
        const { getByLabelText, getByText } = render(
            html`<${LoginRoute} state=${state} />`
        )

        const input = getByLabelText('Bluesky handle') as HTMLInputElement
        fireEvent.input(input, { target: { value: 'alice.bsky.social' } })
        fireEvent.click(getByText('Sign in with Bluesky'))

        t.equal(assigned.length, 1)
        t.ok(
            assigned[0].startsWith('/api/auth/login?handle='),
            'navigates to login endpoint'
        )
    } finally {
        // @ts-expect-error: restore
        location.assign = originalAssign
    }
})
```

(Note: this file uses `@substrate-system/tapzero` style per the
existing pattern; if `login-route.flows.test.ts` originally used
vitest, mirror that runner instead.)

**Step 3: Run**

```bash
cd /Users/nick/code/drerings
npm test
```

Expected: the rewritten test passes; the TAP bundle continues to
build.

**Step 4: Commit**

```bash
cd /Users/nick/code/drerings
git add test/login-route.flows.test.ts
git commit -m "test(login): exercise Bluesky handle submit"
```
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Verify `verifyStampInvariants` with `share` reason

**Files:**
- Modify (if needed): `/Users/nick/code/drerings/test/us025-stamp-invariants.test.ts`

**Step 1: Read the test**

`verifyStampInvariants` in `netlify/lib/stamps.ts` sums
`stamp_transactions.delta` per user and compares against
`stamp_lots.remaining_count` and `users.stamps_balance`. Adding
`'share'` to the reason enum does not change this calculation — it
only adds another valid `reason` value.

**Step 2: Add coverage**

Add a test case that creates a `share` debit row in the
`stamp_transactions` mock and asserts `verifyStampInvariants` reports
no drift when balances align.

```ts
it('treats reason=share rows as normal debits in the invariant',
    async () => {
        vi.resetModules()
        // setup mock that returns a user with stamps_balance:9,
        // one stamp_lot with remaining_count:9, and two
        // stamp_transactions: one with reason='grant' delta=10 and
        // one with reason='share' delta=-1
        // Assert verifyStampInvariants returns driftCount=0.
    })
```

(Match the existing test file's mocking conventions. The implementor
writes the full mock setup at execution time; the AC text is the
spec.)

**Step 3: Run**

```bash
cd /Users/nick/code/drerings
npx vitest run test/us025-stamp-invariants.test.ts
```

**Step 4: Commit**

```bash
cd /Users/nick/code/drerings
git add test/us025-stamp-invariants.test.ts
git commit -m "test(invariants): share reason rows count as normal debits"
```
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Final verification — `npm test && npm run lint`

**Step 1: Run both gauntlets**

```bash
cd /Users/nick/code/drerings
npm test && npm run lint && npx vitest run
```

Expected: all three exit 0. Both test runners green; lint clean.

**Step 2: Final cross-search**

```bash
cd /Users/nick/code/drerings
echo "=== production code ==="
grep -rn "subscription_status\\|isPaid\\|StartCheckout\\|stamps_starter\\|stamps_bundle\\|stamps_big_bundle\\|passkeys\\|magic_link" \\
    src/ netlify/ --include="*.ts" --include="*.tsx" 2>/dev/null

echo "=== migrations ==="
grep -rn "subscription_status\\|stamps_starter\\|stamps_bundle\\|stamps_big_bundle\\|email_change_requests" \\
    netlify/database/migrations/ 2>/dev/null
```

Expected: production code (src/, netlify/) has zero matches. The
migrations directory legitimately has the names in *old* migration
files (Phase 1's reset references them only to TRUNCATE / DROP);
those references are historical and stay.

**Step 3: Manual end-to-end** (optional but recommended)

Start the dev server. Walk through:

1. Visit `/`. Not signed in: see the draw page.
2. Visit `/login`. Submit your Bluesky handle. Approve at the PDS.
3. Land back on `/`. The site shows you as signed in.
4. Visit `/pricing`. See the single-tier card + two pack rows.
5. Draw and save. Verify it persists across reload.
6. Publish. Visit the public post URL.
7. Click Share on the public post. **First share of the month:**
   share sheet opens immediately.
8. Click Share again. **Second share:** confirm dialog. Cancel. Click
   Share again, Confirm. Share sheet opens.
9. Spend all stamps (send postcards) and try a third share. Blocked
   message with link to `/pricing`.
10. Click the link, buy a pack. Stamp balance updates.
11. Logout. The Share button no longer appears on the public post.

If any step fails, surface the bug — do not paper over with test
disables.

**Step 4: Final commit (if needed)**

If steps 1–3 produced no additional edits, skip. Otherwise:

```bash
cd /Users/nick/code/drerings
git add -A
git commit -m "test: final sweep — npm test && npm run lint clean"
```
<!-- END_TASK_6 -->

---

## Done When

- `npm test` exits 0.
- `npx vitest run` exits 0.
- `npm run lint` exits 0.
- `grep -rn 'subscription_status\\|isPaid\\|stamps_starter\\|stamps_bundle\\|stamps_big_bundle\\|passkeys\\|magic_link' src/ netlify/ --include='*.ts'`
  returns zero matches in production code.
- Manual end-to-end walkthrough succeeds for the golden path and the
  blocked path.
