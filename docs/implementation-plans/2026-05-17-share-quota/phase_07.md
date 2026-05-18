# Phase 7: Pricing Page Rewrite Implementation Plan

**Goal:** Replace the two-tier subscription pricing page with a
single info card ("Sign in (free)") plus a stamp packs section that
lists `10_stamps` and `25_stamps`, each with a Buy button that opens
the existing `BuyPackModal`.

**Architecture:** Pure UI change to `src/routes/pricing.ts` and
`src/routes/pricing.css`. Reuses `BuyPackModal` and the existing
`State.OpenBuyPackModal` / `State.StartStampCheckout` flow unchanged.

**Tech Stack:** TypeScript, Preact 10, htm tagged templates.

**Scope:** 7 of 8 phases. Depends on Phase 2 (subscription form
already gone) and Phase 3 (new pack IDs in PACK_DEFINITIONS).

**Codebase verified:** 2026-05-17

---

## Codebase Investigation Findings

- After Phase 2, `src/routes/pricing.ts` is a minimal stub with just
  the stamp-pack CTA and no subscription form. This phase rewrites it
  to the final design.
- `src/routes/pricing.css` (read in investigation, 97 lines) has CSS
  for `.pricing-tiers` (multi-column grid) and `.pricing-checkout`
  (form) — neither is used anymore. This phase trims those rules
  and adds rules for the new single info card + per-pack rows.
- All existing CSS variables (per CLAUDE.md house style) must be
  reused: `--main-text`, `--input-border`, `--danger`, etc. Do NOT
  introduce new variables.
- `BuyPackModal` opens via `State.OpenBuyPackModal(state)` which sets
  `state.buyPackModalOpen.value = true`. The modal renders inside
  the user's chosen pack via `state.stampCheckoutProductId`. The
  user clicks one of the listed packs inside the modal and
  `State.StartStampCheckout(state, productId)` is dispatched.
- Design says each pack row on the pricing page has its own Buy
  button that opens `BuyPackModal` "for the matching pack." This
  means: the button calls something like
  `State.OpenBuyPackModal(state, productId)` to pre-select the pack.
  **Investigation:** verify if `State.OpenBuyPackModal` accepts a
  product ID. If not, extend it.

---

## Acceptance Criteria Coverage

### share-quota.AC7: Pricing page reflects the new model
- **share-quota.AC7.1 Success:** `/pricing` shows one info card
  ("Sign in (free)") summarizing the included features and the
  1-free-share-per-month rule.
- **share-quota.AC7.2 Success:** `/pricing` shows two stamp pack
  rows (`10_stamps` / $5, `25_stamps` / $10), each with a Buy button
  that opens `BuyPackModal` for the matching pack.

---

## Tasks

<!-- START_TASK_1 -->
### Task 1: Extend `State.OpenBuyPackModal` to accept a pack ID

**Verifies:** none directly (substrate for Task 2).

**Files:**
- Modify: `/Users/nick/code/drerings/src/state.ts`

**Step 1: Inspect the current signature**

```bash
cd /Users/nick/code/drerings
grep -n "OpenBuyPackModal\\|CloseBuyPackModal\\|stampCheckoutProductId" \\
    src/state.ts
```

Locate `State.OpenBuyPackModal` (currently around line 785) and the
`stampCheckoutProductId` signal.

**Step 2: Update the signature**

```ts
State.OpenBuyPackModal = function (
    state:AppState,
    productId?:StampPackProductId
):void {
    batch(() => {
        state.checkoutError.value = null
        if (productId) {
            state.stampCheckoutProductId.value = productId
        }
        state.buyPackModalOpen.value = true
    })
}
```

The existing call sites that pass no productId continue to work. New
call sites can pre-select a pack.

**Step 3: Build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

**Step 4: Commit**

```bash
cd /Users/nick/code/drerings
git add src/state.ts
git commit -m "feat(state): OpenBuyPackModal accepts optional productId"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Rewrite `src/routes/pricing.ts` to the final structure

**Verifies:** share-quota.AC7.1, share-quota.AC7.2

**Files:**
- Modify: `/Users/nick/code/drerings/src/routes/pricing.ts`

**Step 1: Replace the file content**

```ts
import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useCallback } from 'preact/hooks'
import { Button } from '../components/button'
import { State, type AppState } from '../state'
import { BuyPackModal } from '../components/buy-pack-modal'
import {
    STAMP_PACKS,
    formatPackPrice
} from '../stamp-packs'
import './pricing.css'

export const PricingRoute:FunctionComponent<{
    state:AppState;
}> = function PricingRoute ({ state }) {
    const openBuyPacks = useCallback((productId?:string) => {
        State.OpenBuyPackModal(state, productId as never)
    }, [state])

    const closeBuyPacks = useCallback(() => {
        State.CloseBuyPackModal(state)
    }, [state])

    return html`<div class="route pricing">
        <section class="pricing-intro">
            <h2>Pricing</h2>
        </section>

        <section class="pricing-tier-card" aria-label="Free tier">
            <h3>Sign in (free)</h3>
            <ul>
                <li>Draw in your browser.</li>
                <li>Save drawings to your account.</li>
                <li>Reopen and edit saved drawings.</li>
                <li>Publish drawings to stable public URLs.</li>
                <li>
                    One free share per calendar month.
                    Additional shares use 1 stamp each.
                </li>
            </ul>
        </section>

        <section class="pricing-stamp-packs" aria-label="Stamp packs">
            <h3>Stamps</h3>
            <p>
                Buy prepaid stamps to send postcards and to make
                additional shares after your monthly free share.
            </p>

            <ul class="pack-list">
                ${STAMP_PACKS.map(pack => html`<li
                    class="pack-row"
                    key=${pack.productId}
                >
                    <div class="pack-info">
                        <span class="pack-name">${pack.name}</span>
                        <span class="pack-count">
                            ${pack.count} stamps
                        </span>
                        <span class="pack-price">
                            ${formatPackPrice(pack.priceCents)}
                        </span>
                    </div>
                    <${Button}
                        type="button"
                        onClick=${() => openBuyPacks(pack.productId)}
                    >
                        Buy
                    <//>
                </li>`)}
            </ul>
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

**Step 2: Build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

Expected: zero errors. If the `productId as never` cast feels wrong,
type it properly using `StampPackProductId | undefined`.

**Step 3: Commit**

```bash
cd /Users/nick/code/drerings
git add src/routes/pricing.ts
git commit -m "feat(pricing): single-tier + stamp-packs page"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update `src/routes/pricing.css` for the new layout

**Verifies:** share-quota.AC7.1, share-quota.AC7.2 (rendering half)

**Files:**
- Modify: `/Users/nick/code/drerings/src/routes/pricing.css`

**Step 1: Replace the file content**

```css
.route.pricing {
    --pricing-max-width: 58rem;

    width: min(100%, var(--pricing-max-width));
    margin-inline: auto;

    & .pricing-intro {
        margin-bottom: 2rem;
    }

    & .pricing-tier-card {
        border-top: 2px solid var(--main-text);
        padding-block: 1rem;
        margin-bottom: 2rem;

        & h3 {
            margin: 0 0 0.5rem;
        }

        & ul {
            padding-left: 1.2rem;
            margin: 0;
        }

        & li {
            margin-bottom: 0.5rem;
            line-height: 1.5;
        }
    }

    & .pricing-stamp-packs {
        border-top: 1px solid var(--input-border);
        padding-top: 1rem;

        & h3 {
            margin: 0 0 0.5rem;
        }

        & p {
            margin: 0 0 1rem;
            max-width: 36rem;
        }
    }

    & .pack-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    & .pack-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding-block: 0.5rem;
    }

    & .pack-info {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    & .pack-name {
        font-weight: 600;
    }

    & .pack-count,
    & .pack-price {
        color: var(--main-text);
    }
}

@media (max-width: 42rem) {
    .route.pricing {
        & .pack-row {
            flex-direction: column;
            align-items: flex-start;
        }
    }
}
```

The variables used (`--main-text`, `--input-border`,
`--pricing-max-width`) are all already defined or local. No new
variables introduced — per CLAUDE.md house style.

(Confirm `--main-text` and `--input-border` exist by:
`grep -n "main-text\\|input-border" /Users/nick/code/drerings/src/_variables.css`.
If they're defined elsewhere, follow that file's name. If the file
doesn't exist by that exact path, `grep -rln ":root" src/` to find
where variables live. Per CLAUDE.md they're under a name like
`_variables.css` or `_vars.css`.)

**Step 2: Visual smoke test**

Start the dev server. Navigate to `/pricing`. Confirm:

- One card at the top: "Sign in (free)" with the bullets list.
- A "Stamps" section below with two pack rows. Each row shows pack
  name, count, price, and a Buy button.
- Clicking either Buy button opens the `BuyPackModal`. (The modal's
  own content reflects all packs; the pre-selected pack from
  `State.OpenBuyPackModal` is the matching one.)

**Step 3: Commit**

```bash
cd /Users/nick/code/drerings
git add src/routes/pricing.css
git commit -m "style(pricing): layout for single tier + pack list"
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Component test for pricing route

**Verifies:** share-quota.AC7.1, share-quota.AC7.2

**Files:**
- Create: `/Users/nick/code/drerings/test/us020-pricing-page.test.ts`

**Step 1: Test that pack buttons trigger the modal**

```ts
import { describe, expect, it, vi } from 'vitest'
import { html } from 'htm/preact'
import { render, fireEvent } from '@testing-library/preact'
import { PricingRoute } from '../src/routes/pricing'
import { State } from '../src/state'

describe('PricingRoute', () => {
    it('shows two pack rows', () => {
        const state = State()
        const { container } = render(
            html`<${PricingRoute} state=${state} />`
        )

        const packRows = container.querySelectorAll('.pack-row')
        expect(packRows.length).toBe(2)
    })

    it('opens BuyPackModal with productId when Buy is clicked', () => {
        const state = State()
        const spy = vi.spyOn(State, 'OpenBuyPackModal')
        const { getAllByText } = render(
            html`<${PricingRoute} state=${state} />`
        )

        const buyButtons = getAllByText('Buy')
        fireEvent.click(buyButtons[0])

        expect(spy).toHaveBeenCalledWith(
            state,
            expect.stringMatching(/^(10|25)_stamps$/)
        )
    })

    it('does NOT include a subscription email form', () => {
        const state = State()
        const { container } = render(
            html`<${PricingRoute} state=${state} />`
        )

        expect(
            container.querySelector('form.pricing-checkout-form')
        ).toBeNull()
    })
})
```

(Per CLAUDE.md: "do not test for specific text content in HTML."
The two assertions on `.pack-row` count and absence of
`form.pricing-checkout-form` test structure, which is the accepted
pattern. The `Buy` query is necessary to test interaction, but
queries by visible button label rather than asserting on copy.)

**Step 2: Run**

```bash
cd /Users/nick/code/drerings
npx vitest run test/us020-pricing-page.test.ts
```

**Step 3: Commit**

```bash
cd /Users/nick/code/drerings
git add test/us020-pricing-page.test.ts
git commit -m "test(pricing): two pack rows, Buy opens modal, no sub form"
```
<!-- END_TASK_4 -->

---

## Done When

- `/pricing` renders one info card titled "Sign in (free)" with the
  feature bullets and the "1 free share per month" rule.
- `/pricing` renders exactly two stamp pack rows (`10_stamps`,
  `25_stamps`), each with a Buy button.
- Clicking a Buy button opens `BuyPackModal` with the matching pack
  pre-selected.
- The page does not include a subscription email form or tier card.
- `npx tsc --noEmit` exits 0.
- `npm run lint` exits 0.
- The component test in `test/us020-pricing-page.test.ts` passes.
