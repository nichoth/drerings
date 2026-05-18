# Phase 3: Stamp Pack Rename and Reduction Implementation Plan

**Goal:** Collapse stamp pack definitions from three entries to two,
renaming the IDs so they match the Autumn dashboard's product IDs:
`10_stamps` and `25_stamps`.

**Architecture:** Single source of truth (`src/stamp-packs.ts`)
plus a few call sites (`BuyPackModal`, `billing.ts`'s
`getCheckoutProductId`, and the existing tests' fixtures). The
TypeScript compiler ensures every reader is updated when the union
type changes shape.

**Tech Stack:** TypeScript 5.8.

**Scope:** 3 of 8 phases. Depends on Phase 1 (schema), but does not
depend on Phase 2 because Phase 2 deliberately kept stamp-pack flows
intact.

**Codebase verified:** 2026-05-17

---

## Codebase Investigation Findings

- `src/stamp-packs.ts` has three pack entries: `stamps_starter`
  (10/$5), `stamps_bundle` (25/$10), `stamps_big_bundle` (60/$20).
  `StampPackProductId = keyof typeof PACK_DEFINITIONS` flows through
  every consumer.
- `src/components/buy-pack-modal.ts:41` hardcodes
  `isRecommended = productId === 'stamps_bundle'`. Update to the new
  ID.
- `netlify/lib/billing.ts:725` defines `getCheckoutProductId(productId)`
  that maps internal IDs to Autumn product IDs. With the new design,
  internal IDs equal the Autumn IDs (`10_stamps`, `25_stamps`), so
  the function effectively becomes a passthrough plus the subscription
  fallback (`getAutumnProductId()`). But Phase 2 deleted the
  subscription fallback path. Re-evaluate the function in this phase
  — it may simplify to `productId => productId` after Phase 2 lands.
- IDs in `PACK_DEFINITIONS` are also the strings written to
  `stamp_lots.source` indirectly via `creditStampLot`. Confirm in the
  investigation whether changing the IDs requires a migration of
  existing `stamp_lots` data — but recall **Phase 1 truncated all
  user-scoped tables**, so there is no legacy data to worry about.
- Tests in `test/us005-stamp-packs.test.ts`, `test/us007-buy-pack-modal.test.ts`,
  and `test/us014-billing-store.test.ts` reference the old IDs.
  Update the test fixtures (the design plan explicitly lists these
  tests as part of Phase 3).

---

## Acceptance Criteria Coverage

### share-quota.AC2: Subscription model is fully removed
- **share-quota.AC2.3 Success:** Stamp packs in `src/stamp-packs.ts`
  reduce to exactly two entries with IDs `10_stamps` (10 stamps / $5)
  and `25_stamps` (25 stamps / $10).
  *(Verified by reading `src/stamp-packs.ts` after the change and by
  the updated tests in `test/us005-stamp-packs.test.ts`.)*

---

## Tasks

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Rewrite `src/stamp-packs.ts`

**Verifies:** share-quota.AC2.3

**Files:**
- Modify: `/Users/nick/code/drerings/src/stamp-packs.ts`

**Step 1: Replace `PACK_DEFINITIONS` content**

Use Edit tool to change lines 12–43. Replace the three-entry
`PACK_DEFINITIONS` with exactly:

```ts
export const PACK_DEFINITIONS = {
    '10_stamps': {
        productId: '10_stamps',
        name: '10 stamps',
        count: 10,
        priceCents: 500,
        metadata: {
            stamp_count: '10',
            per_stamp_price_cents: '50'
        }
    },
    '25_stamps': {
        productId: '25_stamps',
        name: '25 stamps',
        count: 25,
        priceCents: 1000,
        metadata: {
            stamp_count: '25',
            per_stamp_price_cents: '40'
        }
    }
} as const satisfies Record<string, StampPackDefinition>
```

The keys `'10_stamps'` and `'25_stamps'` must be quoted because they
start with a digit — JS would otherwise treat them as numeric literals.

`StampPackProductId = keyof typeof PACK_DEFINITIONS` automatically
becomes `'10_stamps' | '25_stamps'`. No other change to the file is
needed.

**Step 2: Build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

Expected: TypeScript reports errors at every site that hardcodes
`'stamps_starter'`, `'stamps_bundle'`, or `'stamps_big_bundle'`.
Those are addressed in Tasks 2 and 3.

**Step 3: Commit**

```bash
cd /Users/nick/code/drerings
git add src/stamp-packs.ts
git commit -m "feat(stamp-packs): collapse to 10_stamps and 25_stamps"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update `BuyPackModal` and other client consumers

**Verifies:** share-quota.AC2.3 (covered by Task 1; this task keeps the
build green so Task 1's verification is meaningful).

**Files:**
- Modify: `/Users/nick/code/drerings/src/components/buy-pack-modal.ts`

**Step 1: Update the recommended-pack check**

Around line 41:

```ts
// Before:
const isRecommended = productId === 'stamps_bundle'

// After:
const isRecommended = productId === '25_stamps'
```

**Step 2: Search for any other hardcoded pack IDs**

```bash
cd /Users/nick/code/drerings
grep -rn "stamps_starter\\|stamps_bundle\\|stamps_big_bundle" \\
    src/ --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v ".test.ts"
```

For each match, update to the new ID. `stamps_big_bundle` has no
replacement — that pack is gone. Any UI tied to it should be deleted
along with the reference.

**Step 3: Build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

Expected: src/ is clean. Netlify functions still potentially have
references — addressed in Task 3.

**Step 4: Commit**

```bash
cd /Users/nick/code/drerings
git add -A src/
git commit -m "refactor(client): update pack ID references to 10_stamps/25_stamps"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update `netlify/lib/billing.ts` and remove subscription fallback

**Verifies:** share-quota.AC2.3 (joint with Task 1)

**Files:**
- Modify: `/Users/nick/code/drerings/netlify/lib/billing.ts`

**Step 1: Simplify `getCheckoutProductId`**

Lines 725–731 currently fall back to `getAutumnProductId()` (the
subscription product) when the input is not a known pack ID. After
Phase 2 the subscription product is gone, so the fallback is dead
code. Replace the function body with:

```ts
function getCheckoutProductId (
    productId:StampPackProductId
):string {
    if (!PACK_DEFINITIONS[productId]) {
        throw new Error(
            `Unknown stamp pack: ${String(productId)}`
        )
    }

    return productId
}
```

Note the parameter became required (no `?`) — every call site already
passes a value since Phase 2 removed the subscription checkout that
called without one.

**Step 2: Remove `getAutumnProductId`**

The function is now unused. Delete it.

```bash
cd /Users/nick/code/drerings
grep -n "getAutumnProductId" netlify/lib/billing.ts
```

If grep returns no matches, delete the function definition (around
line 721–723). If something still calls it, fix the caller first.

**Step 3: Search Netlify functions for old IDs**

```bash
cd /Users/nick/code/drerings
grep -rn "stamps_starter\\|stamps_bundle\\|stamps_big_bundle" \\
    netlify/ --include="*.ts" 2>/dev/null | grep -v ".test.ts"
```

For each match, update to the new ID. Some matches may be in
helper functions that decode Autumn webhook events — these need their
ID maps updated to the new pair.

**Step 4: Update `creditStampLot` `source` parameter (if affected)**

`creditStampLot` writes to `stamp_lots.source`. The `source` is one of
`'purchase'`, `'grant'`, `'gift_received'` per the type definition. It
does NOT use pack IDs — confirm with:

```bash
cd /Users/nick/code/drerings
grep -n "source.*=\\|source:" netlify/lib/stamps.ts | head -10
```

If `source` is unrelated to pack IDs (confirmed by reading), this
step is a no-op.

**Step 5: Build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

Expected: zero errors across the project.

**Step 6: Commit**

```bash
cd /Users/nick/code/drerings
git add netlify/
git commit -m "refactor(billing): simplify getCheckoutProductId for two-pack catalog"
```
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->
### Task 4: Update existing tests for new pack IDs

**Verifies:** share-quota.AC2.3 (test coverage half)

**Files:**
- Modify: `/Users/nick/code/drerings/test/us005-stamp-packs.test.ts`
- Modify: `/Users/nick/code/drerings/test/us007-buy-pack-modal.test.ts`
- Modify: `/Users/nick/code/drerings/test/us014-billing-store.test.ts`

**Step 1: Read each test and update its fixtures**

For each test file, use grep to find every reference to the old IDs
and update them to the new IDs. For tests that specifically asserted
on the third pack (`stamps_big_bundle`), delete that test case — the
third pack no longer exists.

```bash
cd /Users/nick/code/drerings
grep -n "stamps_starter\\|stamps_bundle\\|stamps_big_bundle" \\
    test/us005-stamp-packs.test.ts \\
    test/us007-buy-pack-modal.test.ts \\
    test/us014-billing-store.test.ts
```

Replacements:
- `'stamps_starter'` → `'10_stamps'`
- `'stamps_bundle'` → `'25_stamps'`
- `'stamps_big_bundle'` references → delete the surrounding test case

**Step 2: Run tests**

```bash
cd /Users/nick/code/drerings
npm test
```

The full test suite likely has many failures unrelated to packs
(subscription removal, auth changes). Focus on the three test files
listed: confirm they pass or, if they fail, that the failure is in
those three files and is caused by an issue inside them (not a
cross-cutting auth/schema problem).

If the failure is auth/schema-related (`vi.doMock('@netlify/database')`
returning the wrong shape after `users.email` is gone), leave it —
those tests are wholesale rewritten or deleted in Phase 8.

**Step 3: Lint**

```bash
cd /Users/nick/code/drerings
npm run lint
```

Expected: clean.

**Step 4: Commit**

```bash
cd /Users/nick/code/drerings
git add test/
git commit -m "test: update fixtures for new stamp pack IDs"
```
<!-- END_TASK_4 -->

---

## Done When

- `src/stamp-packs.ts` defines exactly two packs: `10_stamps` (10/$5)
  and `25_stamps` (25/$10).
- `grep -rn 'stamps_starter\\|stamps_bundle\\|stamps_big_bundle' src/ netlify/`
  returns zero matches in production code (test files updated in
  Task 4).
- `npx tsc --noEmit` exits 0.
- The three updated test files (`us005-stamp-packs`, `us007-buy-pack-modal`,
  `us014-billing-store`) compile.
- Buying either pack via the dev Autumn sandbox (manual verification
  during dev) credits the correct number of stamps. *(Deferred to
  manual verification — not part of automated tests.)*
