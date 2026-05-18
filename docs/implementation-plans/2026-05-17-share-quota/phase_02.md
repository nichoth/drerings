# Phase 2: Remove Subscription Code Paths Implementation Plan

**Goal:** Rip out the obsolete subscription tier; collapse the
`isPaid` notion. Every reference to subscription gating disappears
from non-test code (test cleanup is Phase 8).

**Architecture:** Sequential code removal across `src/state.ts`,
`src/routes/`, `netlify/lib/`, and `netlify/functions/billing/`. The
TypeScript compiler is the safety net — after each removal, the build
must still succeed so we know we caught every reference.

**Tech Stack:** TypeScript 5.8 (ES2022, ESM), Preact 10,
`@preact/signals` 2.

**Scope:** 2 of 8 phases. Depends on Phase 1 (schema columns dropped).

**Codebase verified:** 2026-05-17

---

## Codebase Investigation Findings

The investigator surfaced a wider footprint than the design plan
listed:

- **`netlify/lib/paid.ts`** is its own file exporting `isPaid()`. It
  must be deleted, not just trimmed.
- **`src/routes/home.ts:136`** uses `state.isPaid.value` to gate
  whether the send/save button is enabled. Must change to
  `state.isAuthed.value` (or similar — design says all features become
  available to any authed user).
- **`src/routes/account.ts`** has TWO subscription touchpoints:
  - line 231: cancel button `disabled` on `subscription_status !== 'active'`
  - line 297: `status = account?.subscription_status || 'free'`
- **`src/state.ts`** has FAR more checkout machinery than just
  `State.StartCheckout`. The following are stamp-pack-related and must
  STAY: `State.StartStampCheckout`, `State.OpenBuyPackModal`,
  `State.CloseBuyPackModal`, the `checkoutLoading` / `checkoutError`
  signals (used by stamp pack flows AND gift flows). Only the
  subscription-specific `State.StartCheckout` and the `isPaid` signal
  go away.
- **`State.CancelSubscription`** (state.ts:981) and the matching
  `State.OpenCancelDialog` flow exist. Delete entirely.
- **`netlify/lib/account.ts`** has email-change functions
  (`requestEmailUpdate`, `confirmEmailUpdate`) and a `removePasskey`
  function that read from `magic_link_tokens` and `passkeys`. Those
  tables are gone after Phase 1. These functions must be removed.
  `deleteAccountData` also DELETEs from `passkeys` and
  `magic_link_tokens` — those statements must be removed.
- **`account.ts:60`** has `email: user.email` in the returned
  `AccountDetails` object — `users.email` is gone after Phase 1. The
  SELECT must change to read `did`, `handle`, `handle_updated_at`
  instead, and `AccountDetails` interface must follow suit. The full
  shape change of `SessionUser` happens in Phase 4; this phase only
  removes the subscription pieces. To bridge:
  - **In this phase**, keep `email` as a placeholder TODO comment
    pointing to Phase 4, OR temporarily change `email` to `''` so the
    code compiles. **Preferred:** stop selecting `email` in the SQL
    here and have the return object carry only the subscription-free
    fields, putting the DID/handle migration entirely in Phase 4. Use
    a stub `email: ''` in `AccountDetails` for now to keep the type
    compatible with `SessionUser`. Phase 4 replaces `SessionUser`
    wholesale.
  - **Note this hand-off in a comment** so Phase 4 cleanly takes over.
- **`netlify/functions/billing/cancel.ts`** is a subscription-only
  endpoint. Delete it entirely.
- **`netlify/functions/billing/webhook.ts`** routes through
  `applyAutumnCheckout` which has subscription branches. The webhook
  function itself stays (stamp packs still use it), but the
  subscription branches go away.
- **The test files** that reference `subscription_status` /
  `isPaid` / passkeys / magic_link will mostly fail after this phase.
  **Do not fix them in Phase 2.** Phase 8 sweeps the test suite. The
  acceptance criterion for this phase is "build is green," NOT "tests
  pass."

---

## Acceptance Criteria Coverage

### share-quota.AC2: Subscription model is fully removed
- **share-quota.AC2.1 Success:** Any authed user can save a drawing,
  reopen it, and publish it to a public URL — the subscription gate
  is gone.
  *(Verified by: removing `state.isPaid` from `src/routes/home.ts:136`
  and any other gating site, then confirming a logged-in user can
  invoke the save/publish actions in the dev UI.)*
- **share-quota.AC2.2 Success:** `users` rows have no
  `subscription_status` or `subscription_current_period_end` columns;
  `SessionUser` and `AccountDetails` do not expose them.
  *(Schema half done in Phase 1; type half is done here. Verified by
  searching the codebase: no production type or interface declares
  these fields.)*
- **share-quota.AC2.4 Failure:** `State.StartCheckout`, `isPaid`, and
  the subscription email form on `/pricing` no longer exist;
  references to them anywhere in the codebase fail a search.
  *(Verified by `grep -rn 'StartCheckout\\|isPaid\\|subscription_status'
  src/ netlify/`.)*

`share-quota.AC2.3` (stamp pack collapse) is verified in Phase 3.

---

## Tasks

<!-- START_TASK_1 -->
### Task 1: Remove `netlify/lib/paid.ts` and inline references

**Files:**
- Delete: `/Users/nick/code/drerings/netlify/lib/paid.ts`
- Modify: any file importing from `./paid.js`

**Step 1: Find every importer**

```bash
cd /Users/nick/code/drerings
grep -rln "from '.*paid.js'" netlify/ src/ 2>/dev/null
grep -rln "from '.*paid'" netlify/ src/ 2>/dev/null
```

For each match, change the gate from `isPaid(user)` to `!!user` (a
plain authed check). The semantics shift: every previously paid-gated
feature is now any-authed-user. This is exactly what design AC2.1
mandates.

**Step 2: Delete the file**

```bash
rm /Users/nick/code/drerings/netlify/lib/paid.ts
```

**Step 3: Build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

Expected: zero TypeScript errors. If TypeScript reports an unresolved
import for `./paid.js`, fix that import in step 1.

**Step 4: Commit**

```bash
cd /Users/nick/code/drerings
git add -A netlify/ src/
git commit -m "refactor: remove netlify/lib/paid.ts and isPaid gating"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Strip subscription signals and helpers from `src/state.ts`

**Files:**
- Modify: `/Users/nick/code/drerings/src/state.ts`

**Step 1: Remove the type and field declarations**

In `/Users/nick/code/drerings/src/state.ts`:

- Line 26: delete `export type SubscriptionStatus = ...`
- Lines 28–31 (`interface CurrentUser`): delete the
  `subscription_status:SubscriptionStatus` field. The result:
  ```ts
  export interface CurrentUser extends UserState {
      stamps_balance?:number;
  }
  ```
- Lines 38–41 (`interface AccountDetails`): delete the
  `subscription_current_period_end:string|null;` line. (Keep
  `passkeys` for now — it disappears in Phase 4 when SessionUser
  changes shape; Phase 8 handles tests. To keep the build green here,
  leave `passkeys:AccountPasskey[]` in place.)

  Actually — `passkeys` is also removed by Phase 4. We are in a
  transition. **Leave the `passkeys` field in `AccountDetails` for
  this phase.** It survives the build because:
  - `account.ts` (the netlify lib) used to read from a `passkeys`
    table that no longer exists. We are NOT calling that code
    anymore — `getAccountDetails` will be rewritten in Phase 4 with
    a stub or removed. To keep the type green here, retain the
    `AccountPasskey[]` field even though no code will populate it
    after this phase. Phase 4 cleans it up.

**Step 2: Remove `isPaid` from the State factory's return type and
implementation**

In `src/state.ts`:

- Line 157: delete `isPaid:ReadonlySignal<boolean>;` from the return
  type interface.
- Lines 218–220: delete the `isPaid` computed in the `state` object
  literal.

**Step 3: Update `canShare` (line 221–223) to drop the subscription
check**

Replace lines 221–223 (the `canShare` computed) with a computed that
reads from `auth.value.authenticated`. The design says
`canShare` collapses to `isAuthed`.

```ts
canShare: computed<boolean>(() => {
    return !!state.auth.value?.authenticated
})
```

Or, alternatively, declare `canShare` to reuse `isAuthed`:

```ts
canShare: computed<boolean>(() => state.isAuthed.value)
```

Pick the first form (no inter-computed dependency) for simplicity.
This change is also part of Phase 6's client wiring, but doing it now
keeps the build green.

**Step 4: Remove `State.StartCheckout`**

Delete `State.StartCheckout` entirely. In the current file this is
lines 742–783. Carefully leave `State.StartStampCheckout` (lines ~796+),
`State.OpenBuyPackModal` (line 785), and `State.CloseBuyPackModal`
(line 790) intact — those handle stamp packs, which remain.

**Step 5: Remove `State.CancelSubscription`**

Search the file for `CancelSubscription`. The function is defined
around line 981. Delete it. Also delete any other state methods that
are subscription-only: `State.OpenCancelDialog`,
`State.CloseCancelDialog`, `State.ConfirmCancelSubscription`, etc.
Cross-reference by searching the file for `subscription_status`.

**Step 6: Remove subscription_status reads from State methods that
remain**

Search for `subscription_status` in the file (`grep -n
"subscription_status" src/state.ts`). For each match in a State method
(e.g., `State.LoadAccount`, `State.LoadCurrentUser`), remove the field
from the destructured response and remove it from any object
constructed from a server response.

For `state.ts:922` (in some account-loading function), the line
`subscription_status: account.subscription_status` should be deleted
from the object literal.

For `state.ts:1124`, the cast `maybeUser.subscription_status as
SubscriptionStatus` should be removed entirely.

**Step 7: Verify build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

Expected: any remaining errors point to call sites of the deleted
functions (those are addressed in Tasks 3 and 4).

**Step 8: Commit**

```bash
cd /Users/nick/code/drerings
git add src/state.ts
git commit -m "refactor(state): remove isPaid, StartCheckout, subscription fields"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Strip subscription form from `src/routes/pricing.ts`

**Files:**
- Modify: `/Users/nick/code/drerings/src/routes/pricing.ts`

**Step 1: Delete the subscription tier and checkout form**

The current file has 116 lines. Replace it with a minimal stub that
keeps the stamp-pack section and `BuyPackModal` working. The full
single-tier rewrite happens in Phase 7; for this phase, the goal is
just to keep the build green and remove the subscription UI.

Use Edit tool to remove:
- Lines 17–20: the `startCheckout` useCallback
- Lines 38–62: the entire `pricing-tiers` `<section>` (Free + Paid
  tier cards)
- Lines 78–106: the entire `pricing-checkout` `<section>` (email form
  and Subscribe button)
- Line 14: `const currentUser = state.currentUser.value`
- Line 15: `const email = useSignal<string>(currentUser?.email || '')`
- Line 4: `import { useSignal } from '@preact/signals'`
- Line 6: `import { Input } from '../components/input'`

(`Input` is unused after the checkout form is gone; `useSignal` is
unused after `email` is removed.)

The result file should look roughly like:

```ts
import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useCallback } from 'preact/hooks'
import { Button } from '../components/button'
import { State, type AppState } from '../state'
import { BuyPackModal } from '../components/buy-pack-modal'
import './pricing.css'

export const PricingRoute:FunctionComponent<{
    state:AppState;
}> = function PricingRoute ({ state }) {
    const openBuyPacks = useCallback(() => {
        State.OpenBuyPackModal(state)
    }, [state])

    const closeBuyPacks = useCallback(() => {
        State.CloseBuyPackModal(state)
    }, [state])

    return html`<div class="route pricing">
        <section class="pricing-intro">
            <h2>Pricing</h2>
            <p>
                Draw for free. Buy stamps to send postcards.
            </p>
        </section>

        <section class="stamp-pack-cta" aria-label="Stamps">
            <div>
                <h3>Stamps</h3>
                <p>
                    Buy prepaid stamps for sending postcards. One stamp sends
                    one postcard.
                </p>
            </div>

            <${Button} type="button" onClick=${openBuyPacks}>
                Buy stamps
            <//>
        </section>

        ${state.buyPackModalOpen.value ? html`
            <${BuyPackModal}
                state=${state}
                onClose=${closeBuyPacks}
            />
        ` : null}
    </div>`
}
```

(Phase 7 rewrites this more comprehensively with the new single-tier
copy.)

**Step 2: Build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

Expected: zero errors in this file.

**Step 3: Commit**

```bash
cd /Users/nick/code/drerings
git add src/routes/pricing.ts
git commit -m "refactor(pricing): remove subscription tier and checkout form"
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Remove subscription references in `src/routes/home.ts` and `src/routes/account.ts`

**Files:**
- Modify: `/Users/nick/code/drerings/src/routes/home.ts`
- Modify: `/Users/nick/code/drerings/src/routes/account.ts`

**Step 1: Home route — replace `state.isPaid` with `state.isAuthed`**

In `src/routes/home.ts` around line 136:

```ts
// Before:
return !state.isPaid.value || hasInvalidText.value

// After:
return !state.isAuthed.value || hasInvalidText.value
```

Re-read the surrounding function to verify the gate's intent matches.
The semantics shift from "paid users can save" to "authed users can
save" — exactly what AC2.1 specifies.

Re-check the file for any other reads of `state.isPaid.value` and
replace each. There may also be markup branches that show a "Subscribe
to save" call-to-action — remove those, since every authed user can
now save.

**Step 2: Account route — remove subscription UI**

In `src/routes/account.ts`:

- Line 231: the cancel button `disabled` condition references
  `account?.subscription_status !== 'active'`. The Cancel
  Subscription button itself is gone (no more subscription). Delete
  the entire cancel-subscription UI block. Search the file for any
  block that mentions "Cancel subscription" or "subscription_status"
  and remove it.
- Line 297: `const status = account?.subscription_status || 'free'`
  and any UI that displays the status — delete.
- Re-read the file around any remaining `account?.` accesses to
  remove subscription-tagged copy ("You're on the paid plan", etc.).

**Step 3: Build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

Expected: zero errors.

**Step 4: Commit**

```bash
cd /Users/nick/code/drerings
git add src/routes/home.ts src/routes/account.ts
git commit -m "refactor(routes): replace isPaid gates with isAuthed; remove cancel UI"
```
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Strip subscription branches from `netlify/lib/billing.ts`

**Files:**
- Modify: `/Users/nick/code/drerings/netlify/lib/billing.ts`

**Step 1: Remove `cancelAutumnSubscription`**

Lines 225–245 of `netlify/lib/billing.ts` define
`cancelAutumnSubscription`. Delete the entire function. Also delete
any helper it calls that becomes orphaned (e.g.,
`cancelAutumnAtPeriodEnd`) — only if no other caller depends on it.
Confirm with `grep -n "cancelAutumnAtPeriodEnd" netlify/`.

**Step 2: Remove `CancelSubscriptionResult` type**

Find and delete the `CancelSubscriptionResult` type (it sits near the
top of `billing.ts`).

**Step 3: Remove subscription handling from `applyAutumnCheckout`**

Around lines 447–468:

- Delete the `getWebhookSubscriptionStatus(event)` call
- Delete the `getWebhookCustomerId(event)` call (only if no longer used
  — verify)
- Delete the `UPDATE users SET subscription_status = $1, ...` query
- Remove the `subscription_status` branch from the return value of
  `applyAutumnCheckout`

The function should keep the stamp-checkout branch (lines 441–445)
and just return `{ handled: false }` if no stamp checkout is detected.

**Step 4: Remove helper functions that become orphaned**

Search for `getWebhookSubscriptionStatus`, `getWebhookCustomerId`,
`cancelAutumnAtPeriodEnd`, and any other subscription-only helper.
Delete those whose callers all just got removed.

**Step 5: Update `AutumnWebhookResult` return type**

Find the `AutumnWebhookResult` type. Remove the `subscription_status`
variant. The remaining variants should cover stamp-purchase outcomes
only.

**Step 6: Build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

Expected: zero errors. If any caller of `applyAutumnCheckout` reads
`result.subscription_status`, fix that caller now.

**Step 7: Commit**

```bash
cd /Users/nick/code/drerings
git add netlify/lib/billing.ts
git commit -m "refactor(billing): drop subscription branches; keep stamp-pack paths"
```
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Delete `netlify/functions/billing/cancel.ts`

**Files:**
- Delete: `/Users/nick/code/drerings/netlify/functions/billing/cancel.ts`

**Step 1: Delete the file**

```bash
rm /Users/nick/code/drerings/netlify/functions/billing/cancel.ts
```

**Step 2: Check `netlify.toml` for any explicit route to `cancel`**

```bash
grep -n "cancel" /Users/nick/code/drerings/netlify.toml
```

If a redirect is configured for `/api/billing/cancel`, remove that
entry. Most Netlify configurations route by filename auto-magically;
if so, no `netlify.toml` change is needed.

**Step 3: Build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

Expected: zero errors. Any caller from inside Netlify functions has
already been removed in Task 5.

**Step 4: Commit**

```bash
cd /Users/nick/code/drerings
git add -A netlify/
git commit -m "refactor(billing): remove cancel endpoint"
```
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Strip subscription fields from `netlify/lib/account.ts`

**Files:**
- Modify: `/Users/nick/code/drerings/netlify/lib/account.ts`

**Note:** This file's full DID/handle conversion happens in Phase 4.
This task removes ONLY the subscription pieces, leaving placeholder
shapes that Phase 4 will refactor.

**Step 1: Drop subscription fields from `AccountDetails` and `UserAccountRow`**

In `netlify/lib/account.ts`:

- Line 12–15: remove `subscription_current_period_end:string|null;`
  from `AccountDetails`. The interface keeps `email` and `passkeys`
  for now (Phase 4 replaces them).
- Lines 17–22 (`UserAccountRow`): remove
  `subscription_status:SessionUser['subscription_status'];` and
  `subscription_current_period_end:string|Date|null;`.

**Step 2: Stub `getAccountDetails` (Phase 4 rewrites it for DID/handle)**

Phase 1 dropped `users.email`, so any SQL that reads `email` will
fail at runtime. The full DID/handle migration is Phase 4. For this
phase, **stub `getAccountDetails` to return `null`** with a clear
`TODO(phase-4)` marker so the build and dependent endpoints stay
loadable. The `/account` page will be non-functional between Phase 2
and Phase 4 completion — this is an accepted transient regression
(see "Known transient regressions" in Done When below).

Replace the function body with exactly this:

```ts
export async function getAccountDetails (
    userId:string
):Promise<AccountDetails|null> {
    void userId
    // TODO(phase-4): rewrite for DID-keyed users after auth revival.
    return null
}
```

Remove the import of `getDatabase` if no other function in the file
uses it after Steps 3–4. Same for `crypto`, `sendMagicLinkEmail`, and
`deleteDrawingImage` — clean up any import that becomes unused.

**Step 3: Delete email-update functions**

Lines 73–129: `requestEmailUpdate` and `confirmEmailUpdate`. Both
write to `magic_link_tokens`, which is gone. Delete both.

Also delete the `sendMagicLinkEmail` import (line 5) if no other
function in the file uses it.

**Step 4: Delete `removePasskey`**

Lines 131–143: `removePasskey` reads from `passkeys`. Delete the
function.

**Step 5: Clean `deleteAccountData`**

Lines 145–181: remove the DELETE statements that target `passkeys`
and `magic_link_tokens` (those tables don't exist). The DELETE on
`drawings`, `public_posts`, and `users` stays.

**Step 6: Build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

Expected: errors will likely surface from callers of the deleted
functions (e.g., `/api/account/email/...` endpoints). For each
caller, delete the endpoint file. The full list:

```bash
grep -rln "requestEmailUpdate\\|confirmEmailUpdate\\|removePasskey" \\
    netlify/functions/ src/
```

Delete each function file referenced (e.g.,
`netlify/functions/account/email.ts`,
`netlify/functions/account/email/callback.ts`,
`netlify/functions/account/passkeys/[passkeyId].ts`).

**Step 7: Commit**

```bash
cd /Users/nick/code/drerings
git add -A netlify/ src/
git commit -m "refactor(account): remove subscription fields and email-update flows"
```
<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: Strip subscription_status from `SessionUser`

**Files:**
- Modify: `/Users/nick/code/drerings/netlify/lib/auth-store.ts`

**Step 1: Remove the field**

Find the `SessionUser` interface. Remove `subscription_status` from
its declaration. Keep `id`, `email`, `stamps_balance`,
`autumn_customer_id`. (Phase 4 replaces this interface entirely with
DID/handle fields.)

**Step 2: Build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

Expected: errors point to anything still reading
`session.user.subscription_status`. Fix each by removing the read.

**Step 3: Update `netlify/lib/session.ts`**

The cookie payload type at the top of `session.ts` includes
`subscription_status` (per investigator). Remove it from the payload
type. The cookie format change is forward-compatible (existing cookies
just have an extra ignored field). Phase 4 invalidates all cookies
anyway when it switches to the DID payload.

**Step 4: Commit**

```bash
cd /Users/nick/code/drerings
git add netlify/lib/
git commit -m "refactor(auth-store): drop subscription_status from SessionUser"
```
<!-- END_TASK_8 -->

<!-- START_TASK_9 -->
### Task 9: Final sweep — confirm no production references remain

**Step 1: Search for any leftover subscription reference**

```bash
cd /Users/nick/code/drerings
grep -rn "subscription_status\\|isPaid\\|StartCheckout" src/ netlify/ \\
    --include="*.ts" --include="*.tsx" 2>/dev/null \\
    | grep -v ".test.ts" | grep -v "/test/"
```

Expected: zero matches. If any match appears, investigate and remove.
(Test files are addressed in Phase 8.)

**Step 2: Build clean**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
npm run lint
```

Expected: both succeed.

**Step 3: Manual smoke test (optional but recommended)**

Start the dev server. Confirm:
- `/pricing` loads without errors and shows only the stamps section
  (no subscription form).
- Sign-in still works (legacy email path; Phase 4 will replace this).
- Save/publish operations no longer present a "Subscribe to save"
  CTA.

If the dev server cannot start due to DB shape issues (e.g.,
`users.email` missing), note this — Phase 4 fixes the auth path and
the dev server should be usable after that. Until then the smoke test
may not be useful.

**Step 4: Commit**

If steps 1–2 produced no additional edits, this is a no-op commit and
should be skipped. If any cleanup was needed:

```bash
cd /Users/nick/code/drerings
git add -A
git commit -m "refactor: final subscription cleanup sweep"
```
<!-- END_TASK_9 -->

---

## Done When

- `grep -rn 'subscription_status\\|isPaid\\|StartCheckout' src/ netlify/`
  returns zero matches in non-test files.
- `npx tsc --noEmit` exits 0.
- `npm run lint` exits 0.
- `src/routes/pricing.ts` no longer renders a subscription form or
  tier card.
- `netlify/lib/paid.ts` does not exist.
- `netlify/functions/billing/cancel.ts` does not exist.

Tests are expected to fail at this point — Phase 8 cleans them up.

### Known transient regressions (until Phase 4 completes)

These routes/endpoints will return placeholder responses or fail at
runtime between Phase 2 completion and Phase 4 completion. Do NOT
deploy from a state where only Phase 2 has landed:

- **`GET /api/account`** — backed by `getAccountDetails`, which is
  stubbed to return `null` in Phase 2 Task 7. The `/account` page
  will show as "not found" or render an empty state. Phase 4 restores
  it with DID/handle fields.
- **`POST /api/account/email`** — the email update endpoint is
  deleted in Phase 2 Task 7 (the underlying `magic_link_tokens` table
  is gone). The Phase 4 auth revival removes the corresponding UI as
  well.
- **`/login`** — the legacy email/passkey form continues to render,
  but no email path works (the `magic_link_tokens` table is gone).
  Phase 4 replaces this UI with the Bluesky handle form.
- **`POST /api/postcards/send`** — still references
  `session.user.email` for Resend; the Phase 2 Task 5 edit handles
  this by synthesizing from `handle` (which doesn't exist until
  Phase 4). **This endpoint will throw at runtime** until Phase 4
  completes the SessionUser shape change.

These regressions are acceptable because the entire share-quota
branch is integrated as one shippable unit. Phases 2 through 8 should
land together; the intermediate states are dev-only.
