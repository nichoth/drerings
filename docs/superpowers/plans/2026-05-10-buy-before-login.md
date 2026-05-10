# Buy-Before-Login Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor checkout and login so that anonymous visitors can purchase a subscription (creating their account in the process), and magic-link login only works for emails that have completed a purchase.

**Architecture:** The pricing page becomes the entry point for new users — it collects an email and starts checkout without requiring a session. The `/api/billing/checkout` endpoint upserts a user row by email (so we have a stable id to hand to Autumn) and starts an Autumn checkout session. The Autumn webhook continues to update users by `autumn_customer_id`. `createMagicLinkLogin` is tightened so it only issues tokens for users who have ever paid (`subscription_status` in `active`/`canceled`/`past_due`); free-status rows (created during checkout but unpaid) cannot log in.

**Tech Stack:** TypeScript, Preact + signals (frontend), Netlify Functions (backend), `@netlify/database` (Postgres), Autumn (Stripe wrapper), Vitest.

---

## File Structure

**Backend (Netlify Functions / lib):**
- Modify `netlify/lib/auth-store.ts` — split `createMagicLinkLogin` into `findUserByEmail` lookup + token issuance; only issue tokens for users with paid history. Add `upsertCheckoutUser(email)` for the checkout flow.
- Modify `netlify/functions/auth/magic-link.ts` — call new lookup-only flow; always return generic 200 to avoid email enumeration but skip token creation/email send when no paid account exists.
- Modify `netlify/lib/billing.ts` — change `createCheckoutSession` to accept `{ id, email }` (still works for an existing `SessionUser`, but no longer requires the full `SessionUser` shape).
- Modify `netlify/functions/billing/checkout.ts` — drop the session requirement, parse `email` from the JSON body, upsert the user, then call `createCheckoutSession`.

**Frontend:**
- Modify `src/routes/pricing.ts` — remove the "Please sign in before checkout" branch; add an `email` input + form that POSTs to `/api/billing/checkout` regardless of session state. Keep the "you are signed in as X" affordance for users who already have an active session (we prefill their email in that case).
- Modify `src/routes/pricing.css` — add styles for the new email field if needed (use existing variables; do not introduce new colors).
- Modify `src/state.ts` — change `State.StartCheckout` signature to take an email argument and POST it as JSON.
- Modify `src/routes/login.ts` — add a small "New here? Subscribe to create an account." link to `/pricing` near the form. (No behavior change to the magic-link send result — server still always returns 200.)

**Tests:**
- Update `test/us013-pricing-page.test.ts` — replace the "prompts logged-out visitors to sign in" assertion with one verifying the email-entry CTA and that the Subscribe button is enabled (only disabled while submitting).
- Update `test/us014-billing-checkout-api.test.ts` — replace the 401-without-session test with a 400-without-email test; the success test now passes a body and asserts the upsert + Autumn call shape.
- Update `test/us014-checkout-ui.test.ts` — the signed-in test prefills email; add a new logged-out test that types an email and verifies the POST body.
- Update `test/us004-magic-link-api.test.ts` — assert that an unknown / free-only email yields the same generic 200 but without a `createMagicLinkLogin` call OR `sendMagicLinkEmail` call. Add a positive case for a paid user.
- Add `test/us014-checkout-store.test.ts` — covers `upsertCheckoutUser` shape (returns existing id when email exists, inserts otherwise).

---

## Task 1: Add `findPaidUserByEmail` to the auth store and reorder `createMagicLinkLogin` around it

**Files:**
- Modify: `netlify/lib/auth-store.ts`
- Test: `test/us004-auth-helpers.test.ts` (add a case)

- [ ] **Step 1: Inspect current `auth-store.ts` shape**

Read `netlify/lib/auth-store.ts` and confirm `createMagicLinkLogin` currently UPSERTs by email. Confirm `SessionUser` exposes `subscription_status`.

- [ ] **Step 2: Add a failing test for `createMagicLinkLogin` rejecting free-only users**

Append to `test/us004-auth-helpers.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

type Query = (
    sql:string,
    params:unknown[]
) => Promise<{ rows:Array<Record<string, unknown>> }>

describe('createMagicLinkLogin paid-only gating', () => {
    it('returns null when email has no paid history', async () => {
        vi.resetModules()

        const query = vi.fn<Query>(async (sql) => {
            if (sql.includes('SELECT id, subscription_status FROM users')) {
                return { rows: [{
                    id: 'user-1',
                    subscription_status: 'free'
                }] }
            }
            return { rows: [] }
        })

        vi.doMock('@netlify/database', () => ({
            getDatabase: () => ({ pool: { query } })
        }))

        const store = await import('../netlify/lib/auth-store')
        const result = await store.createMagicLinkLogin('free@example.com')

        expect(result).toBeNull()
    })

    it('issues a token when subscription is or was paid', async () => {
        vi.resetModules()

        const query = vi.fn<Query>(async (sql) => {
            if (sql.includes('SELECT id, subscription_status FROM users')) {
                return { rows: [{
                    id: 'user-1',
                    subscription_status: 'active'
                }] }
            }
            if (sql.includes('INSERT INTO magic_link_tokens')) {
                return { rows: [{ user_id: 'user-1' }] }
            }
            return { rows: [] }
        })

        vi.doMock('@netlify/database', () => ({
            getDatabase: () => ({ pool: { query } })
        }))

        const store = await import('../netlify/lib/auth-store')
        const result = await store.createMagicLinkLogin('paid@example.com')

        expect(result).not.toBeNull()
        expect(result?.userId).toBe('user-1')
    })
})
```

- [ ] **Step 3: Run the new tests, expect failures**

Run: `npx vitest run test/us004-auth-helpers.test.ts`
Expected: both new cases FAIL because the current implementation always upserts.

- [ ] **Step 4: Update `createMagicLinkLogin` signature and body**

Replace the body of `createMagicLinkLogin` in `netlify/lib/auth-store.ts`:

```ts
export async function createMagicLinkLogin (
    email:string
):Promise<MagicLinkLogin|null> {
    const db = getDatabase()
    const lookup = await db.pool.query<{
        id:string;
        subscription_status:'free'|'active'|'canceled'|'past_due';
    }>(
        'SELECT id, subscription_status FROM users WHERE email = $1',
        [email]
    )
    const user = lookup.rows[0]

    if (!user || user.subscription_status === 'free') return null

    const token = crypto.randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + (15 * 60 * 1000))
    const insert = await db.pool.query<{ user_id:string }>(`
        INSERT INTO magic_link_tokens (token, user_id, expires_at, purpose)
        VALUES ($1, $2, $3, 'login')
        RETURNING user_id
    `, [token, user.id, expiresAt])

    return {
        userId: insert.rows[0].user_id,
        token,
        expiresAt
    }
}
```

- [ ] **Step 5: Run the tests, expect pass**

Run: `npx vitest run test/us004-auth-helpers.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add netlify/lib/auth-store.ts test/us004-auth-helpers.test.ts
git commit -m "auth: only issue magic links for paid accounts"
```

---

## Task 2: Add `upsertCheckoutUser` to the auth store

**Files:**
- Modify: `netlify/lib/auth-store.ts`
- Create: `test/us014-checkout-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/us014-checkout-store.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

type Query = (
    sql:string,
    params:unknown[]
) => Promise<{ rows:Array<Record<string, unknown>> }>

describe('upsertCheckoutUser', () => {
    it('inserts a new free-status user when email is unknown', async () => {
        vi.resetModules()

        const query = vi.fn<Query>(async () => {
            return { rows: [{
                id: 'user-2',
                email: 'new@example.com',
                subscription_status: 'free',
                autumn_customer_id: null
            }] }
        })

        vi.doMock('@netlify/database', () => ({
            getDatabase: () => ({ pool: { query } })
        }))

        const store = await import('../netlify/lib/auth-store')
        const result = await store.upsertCheckoutUser('new@example.com')

        expect(result).toEqual({
            id: 'user-2',
            email: 'new@example.com',
            subscription_status: 'free',
            autumn_customer_id: null
        })
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO users'),
            ['new@example.com']
        )
    })
})
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run test/us014-checkout-store.test.ts`
Expected: FAIL - `upsertCheckoutUser is not a function`.

- [ ] **Step 3: Implement `upsertCheckoutUser`**

Append to `netlify/lib/auth-store.ts`:

```ts
export async function upsertCheckoutUser (
    email:string
):Promise<SessionUser> {
    const db = getDatabase()
    const result = await db.pool.query<SessionUser>(`
        INSERT INTO users (email)
        VALUES ($1)
        ON CONFLICT (email)
        DO UPDATE SET email = EXCLUDED.email
        RETURNING
            id,
            email,
            subscription_status,
            autumn_customer_id
    `, [email])

    return result.rows[0]
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run test/us014-checkout-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/lib/auth-store.ts test/us014-checkout-store.test.ts
git commit -m "auth: add upsertCheckoutUser for anonymous checkout"
```

---

## Task 3: Refactor `/api/billing/checkout` to accept anonymous + email body

**Files:**
- Modify: `netlify/functions/billing/checkout.ts`
- Modify: `test/us014-billing-checkout-api.test.ts`

- [ ] **Step 1: Update tests to drive new behavior**

Replace the contents of the test cases in `test/us014-billing-checkout-api.test.ts`:

- The "creates a checkout session for the current user" case stays but now sends a body. Replace it with this test that exercises both flows by sending a body and stubbing `upsertCheckoutUser`:

```ts
it('creates a checkout session for the submitted email', async () => {
    vi.resetModules()

    const upsertCheckoutUser = vi.fn(async () => ({
        id: 'user-1',
        email: 'buyer@example.com',
        subscription_status: 'free',
        autumn_customer_id: null
    }))
    const createCheckoutSession = vi.fn(async () => {
        return {
            url: 'https://checkout.stripe.com/pay/cs_test_123',
            customer_id: 'autumn-user-1'
        }
    })

    vi.doMock('../netlify/lib/auth-store', () => {
        return { upsertCheckoutUser }
    })
    vi.doMock('../netlify/lib/billing', () => {
        return { createCheckoutSession }
    })

    const { handler } = await import(
        '../netlify/functions/billing/checkout'
    )
    const response = await callHandler(handler, {
        ...baseEvent,
        body: JSON.stringify({ email: ' Buyer@Example.COM ' })
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body || '{}')).toEqual({
        url: 'https://checkout.stripe.com/pay/cs_test_123'
    })
    expect(upsertCheckoutUser).toHaveBeenCalledWith('buyer@example.com')
    expect(createCheckoutSession).toHaveBeenCalledWith(
        {
            id: 'user-1',
            email: 'buyer@example.com',
            subscription_status: 'free',
            autumn_customer_id: null
        },
        'https://drerings.app'
    )
})

it('rejects requests with no email', async () => {
    vi.resetModules()

    const upsertCheckoutUser = vi.fn()
    const createCheckoutSession = vi.fn()

    vi.doMock('../netlify/lib/auth-store', () => {
        return { upsertCheckoutUser }
    })
    vi.doMock('../netlify/lib/billing', () => {
        return { createCheckoutSession }
    })

    const { handler } = await import(
        '../netlify/functions/billing/checkout'
    )
    const response = await callHandler(handler, {
        ...baseEvent,
        body: JSON.stringify({})
    })

    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body || '{}').error).toMatch(/email/i)
    expect(upsertCheckoutUser).not.toHaveBeenCalled()
    expect(createCheckoutSession).not.toHaveBeenCalled()
})
```

Delete the existing "returns unauthorized before creating a checkout" test entirely.
Keep the existing "rejects methods other than POST" test as-is.

- [ ] **Step 2: Run, expect failures**

Run: `npx vitest run test/us014-billing-checkout-api.test.ts`
Expected: the new cases FAIL (handler still requires session).

- [ ] **Step 3: Replace the checkout handler**

Replace `netlify/functions/billing/checkout.ts` with:

```ts
import type { Handler } from '@netlify/functions'
import { getRequestOrigin, json, parseJsonBody } from '../../lib/http.js'
import { upsertCheckoutUser } from '../../lib/auth-store.js'
import { createCheckoutSession } from '../../lib/billing.js'

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'Method not allowed' })
    }

    const body = parseJsonBody(event)
    const email = normalizeEmail(body?.email)

    if (!email) {
        return json(400, { error: 'Enter a valid email address.' })
    }

    try {
        const user = await upsertCheckoutUser(email)
        const checkout = await createCheckoutSession(
            user,
            getRequestOrigin(event)
        )

        return json(200, { url: checkout.url })
    } catch (err) {
        console.error(err)

        return json(500, {
            error: 'Checkout is not configured.'
        })
    }
}

function normalizeEmail (value:unknown):string|null {
    if (typeof value !== 'string') return null

    const email = value.trim().toLowerCase()
    const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

    return isValid ? email : null
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run test/us014-billing-checkout-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/billing/checkout.ts test/us014-billing-checkout-api.test.ts
git commit -m "billing: accept anonymous checkout requests with email body"
```

---

## Task 4: Update `magic-link.ts` API to silently accept unknown / free emails

**Files:**
- Modify: `netlify/functions/auth/magic-link.ts`
- Modify: `test/us004-magic-link-api.test.ts`

- [ ] **Step 1: Update tests**

In `test/us004-magic-link-api.test.ts`:

Modify the existing "creates a one-time login token and sends the link" test so `createMagicLinkLogin` returns the existing object (still mocked the same way — no change needed beyond confirming).

Add a new test below it:

```ts
it('does not send mail when the email has no paid account', async () => {
    vi.resetModules()

    const createMagicLinkLogin = vi.fn(async () => null)
    const sendMagicLinkEmail = vi.fn(async () => {})

    vi.doMock('../netlify/lib/auth-store', () => {
        return { createMagicLinkLogin }
    })
    vi.doMock('../netlify/lib/resend', () => {
        return { sendMagicLinkEmail }
    })

    const { handler } = await import(
        '../netlify/functions/auth/magic-link'
    )
    const response = await callHandler(handler, {
        ...baseEvent,
        body: JSON.stringify({ email: 'unknown@example.com' })
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body || '{}')).toEqual({ ok: true })
    expect(createMagicLinkLogin).toHaveBeenCalledWith('unknown@example.com')
    expect(sendMagicLinkEmail).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run test/us004-magic-link-api.test.ts`
Expected: new test FAILs (current handler still calls `sendMagicLinkEmail` with the result of `createMagicLinkLogin`).

- [ ] **Step 3: Update `magic-link.ts`**

Edit `netlify/functions/auth/magic-link.ts`:

```ts
try {
    const login = await createMagicLinkLogin(email)

    if (login) {
        const loginUrl = new URL(
            '/api/auth/magic-link/callback',
            getRequestOrigin(event)
        )

        loginUrl.searchParams.set('token', login.token)

        await sendMagicLinkEmail({
            email,
            loginUrl: loginUrl.toString()
        })
    }

    return json(200, { ok: true })
} catch (err) {
    console.error(err)
    return json(500, {
        error: 'Unable to send a magic link right now.'
    })
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run test/us004-magic-link-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/auth/magic-link.ts test/us004-magic-link-api.test.ts
git commit -m "auth: silently no-op magic link for emails without a paid account"
```

---

## Task 5: Update `State.StartCheckout` to send the email body

**Files:**
- Modify: `src/state.ts`

- [ ] **Step 1: Read `State.StartCheckout` (around line 380)**

Confirm signature is `(state:AppState):Promise<void>`.

- [ ] **Step 2: Change the signature and POST body**

Edit `src/state.ts`:

```ts
State.StartCheckout = async function (
    state:AppState,
    email:string
):Promise<void> {
    state.checkoutLoading.value = true
    state.checkoutError.value = null

    try {
        const response = await fetch('/api/billing/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        })

        if (!response.ok) {
            const errorBody = await maybeJson(response)
            const message = typeof errorBody?.error === 'string' ?
                errorBody.error :
                'Unable to start checkout right now.'

            throw new Error(message)
        }

        const body = await response.json() as { url?:unknown }

        if (typeof body.url !== 'string' || body.url.trim() === '') {
            throw new Error('Unable to start checkout right now.')
        }

        location.assign(body.url)
    } catch (err) {
        const message = err instanceof Error ?
            err.message :
            'Unable to start checkout right now.'

        state.checkoutError.value = message

        throw err
    } finally {
        state.checkoutLoading.value = false
    }
}
```

- [ ] **Step 3: Commit (test changes follow in Task 6)**

```bash
git add src/state.ts
git commit -m "state: pass email body to StartCheckout"
```

---

## Task 6: Refactor `/pricing` UI — email field, no sign-in gate

**Files:**
- Modify: `src/routes/pricing.ts`
- Modify: `src/routes/pricing.css` (only if a new style is genuinely needed)
- Modify: `test/us013-pricing-page.test.ts`
- Modify: `test/us014-checkout-ui.test.ts`

- [ ] **Step 1: Update `us013-pricing-page.test.ts` for the new copy**

Replace the test "prompts logged-out visitors to sign in before checkout" with:

```ts
it('lets visitors enter email and start checkout without signing in', () => {
    const state = State()
    const Route = routeFor('/pricing', state)

    render(h(Route, { state }))

    const checkout = screen.getByRole('region', { name: 'Checkout' })

    expect(within(checkout).queryByText(/sign in before checkout/i))
        .toBeNull()

    const emailInput = within(checkout)
        .getByLabelText(/email/i) as HTMLInputElement
    const subscribe = within(checkout).getByRole('button', {
        name: 'Subscribe - $5/month'
    }) as HTMLButtonElement

    expect(emailInput.type).toBe('email')
    expect(subscribe.disabled).toBe(false)
})
```

- [ ] **Step 2: Update `us014-checkout-ui.test.ts`**

Replace the "starts checkout from the signed-in pricing CTA" test (it's now: type email, click Subscribe). Delete the `signedInState` helper (no longer needed for this test) and replace with:

```ts
it('starts checkout from the pricing CTA after email entry', async () => {
    const state = State()
    const assign = vi.fn()
    const fetcher = vi.fn(async () => {
        return new Response(JSON.stringify({
            url: 'https://checkout.stripe.com/pay/cs_test_123'
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        })
    })

    vi.stubGlobal('fetch', fetcher)
    vi.stubGlobal('location', {
        ...window.location,
        assign
    })

    const Route = routeFor('/pricing', state)

    render(h(Route, { state }))

    const emailInput = screen.getByLabelText(/email/i) as HTMLInputElement
    fireEvent.input(emailInput, {
        target: { value: 'buyer@example.com' }
    })

    await fireEvent.click(screen.getByRole('button', {
        name: 'Subscribe - $5/month'
    }))

    await waitFor(() => {
        expect(fetcher).toHaveBeenCalledWith('/api/billing/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'buyer@example.com' })
        })
        expect(assign).toHaveBeenCalledWith(
            'https://checkout.stripe.com/pay/cs_test_123'
        )
    })
})
```

For the "shows checkout errors inline" test, replace `signedInState()` with `State()` and add the email-entry steps:

```ts
const state = State()
// ...
render(h(Route, { state }))

fireEvent.input(
    screen.getByLabelText(/email/i),
    { target: { value: 'buyer@example.com' } }
)

await fireEvent.click(screen.getByRole('button', {
    name: 'Subscribe - $5/month'
}))
```

The two `account?status=` tests still use `signedInState` — keep `signedInState` defined but inline only the prefill assertions that need it. (Quickest: leave `signedInState` declared, just don't use it for the first two tests.)

- [ ] **Step 3: Run tests, expect failures**

Run: `npx vitest run test/us013-pricing-page.test.ts test/us014-checkout-ui.test.ts`
Expected: FAILs because `pricing.ts` still has the old markup.

- [ ] **Step 4: Replace the checkout section of `pricing.ts`**

Edit `src/routes/pricing.ts`. Replace the component body so that:

- It always renders an email `input` (prefilled from `currentUser.email` if signed in)
- The Subscribe button is enabled when the email field looks valid and not currently submitting
- The "Please sign in" branch is removed

```ts
import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useCallback } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { Button } from '../components/button'
import { State, type AppState } from '../state'
import './pricing.css'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const PricingRoute:FunctionComponent<{
    state:AppState;
}> = function PricingRoute ({ state }) {
    const currentUser = state.currentUser.value
    const email = useSignal<string>(currentUser?.email || '')

    const startCheckout = useCallback(async (ev:Event) => {
        ev.preventDefault()
        const trimmed = email.value.trim()
        if (!EMAIL_RE.test(trimmed)) return
        await State.StartCheckout(state, trimmed).catch(() => {})
    }, [state])

    return html`<div class="route pricing">
        <section class="pricing-intro">
            <h2>Pricing</h2>
            <p>
                Draw for free. Subscribe when you want to share them with the
                world.
            </p>
        </section>

        <section class="pricing-tiers" aria-label="Plans">
            <article class="pricing-tier">
                <h3>Free</h3>
                <p class="pricing-rate">$0/month</p>
                <ul>
                    <li>Draw in the browser.</li>
                    <li>Start over with every refresh.</li>
                    <li>No saved drawings or public posts.</li>
                </ul>
            </article>

            <article class="pricing-tier paid">
                <h3>Paid</h3>
                <p class="pricing-rate">$5/month</p>
                <ul>
                    <li>Save drawings to your account.</li>
                    <li>Reopen and edit saved drawings.</li>
                    <li>Publish drawings to stable public URLs.</li>
                </ul>
            </article>
        </section>

        <section
            class="pricing-checkout"
            aria-label="Checkout"
        >
            <form onSubmit=${startCheckout} class="pricing-checkout-form">
                <label for="checkout-email">Email</label>
                <input
                    id="checkout-email"
                    name="email"
                    type="email"
                    autocomplete="email"
                    required
                    value=${email.value}
                    onInput=${(ev:InputEvent) => {
                        const input = ev.currentTarget as HTMLInputElement
                        email.value = input.value
                    }}
                />

                <${Button}
                    type="submit"
                    isSpinning=${state.checkoutLoading}
                >
                    Subscribe - $5/month
                <//>
            </form>

            ${state.checkoutError.value ?
                html`<p role="alert" class="pricing-error">
                    ${state.checkoutError.value}
                </p>` :
                null
            }
        </section>
    </div>`
}
```

- [ ] **Step 5: Update `pricing.css` only if needed**

Run: `npx vitest run test/us013-pricing-page.test.ts test/us014-checkout-ui.test.ts`

If layout looks acceptable in tests (no DOM-shape assertions broken), skip CSS edits. Otherwise, add minimum nested rules under `.route.pricing` for the new form, using existing `_variables.css` / `_vars.css` colors only.

- [ ] **Step 6: Run all impacted tests**

Run: `npx vitest run test/us013-pricing-page.test.ts test/us014-checkout-ui.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/routes/pricing.ts src/routes/pricing.css test/us013-pricing-page.test.ts test/us014-checkout-ui.test.ts
git commit -m "pricing: collect email and checkout without sign-in"
```

---

## Task 7: Soften the home-page free-account warning copy

**Files:**
- Modify: `src/routes/home.ts`

The current copy says "Drawings aren't saved on free accounts." but with the new model there's no "free account" — it's a free *experience* in the browser, no account at all. Adjust copy and link.

- [ ] **Step 1: Edit the warning aside**

In `src/routes/home.ts`, change the aside text:

```ts
${state.isPaid.value ? null : html`
    <aside
        class="free-account-warning"
        role="status"
        aria-label="Save warning"
    >
        Drawings aren't saved without a subscription.${' '}
        <a href="/pricing">
            Subscribe to keep them and share them with the world
        </a>.
    </aside>
`}
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `npx vitest run test/us007-free-user-drawing.test.ts test/us013-pricing-page.test.ts`
Expected: PASS. If a test asserts the literal "free accounts" string, update it to match the new copy.

- [ ] **Step 3: Commit**

```bash
git add src/routes/home.ts test
git commit -m "home: reword save warning to match buy-before-login model"
```

---

## Task 8: Add a "new here?" link on `/login`

**Files:**
- Modify: `src/routes/login.ts`

- [ ] **Step 1: Add a small helper paragraph to the login form**

Edit `src/routes/login.ts`. Inside the returned JSX, before the magic-link form, add:

```ts
<p class="login-help">
    New here? <a href="/pricing">Subscribe to create an account</a>.
</p>
```

(Place it inside the top-level `<div class="route login">` after the `<h2>`. Keep the rest unchanged.)

- [ ] **Step 2: Visually verify in dev**

Run: `npm run dev` (or whatever the local dev script is — check `package.json`).

Open `http://localhost:8888/login`. Confirm the link appears and clicks through to `/pricing`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/login.ts
git commit -m "login: link to /pricing for new visitors"
```

---

## Task 9: Full regression sweep

**Files:** none

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: clean exit. Fix any reported issues.

- [ ] **Step 2: Run the full vitest suite**

Run: `npm run test:e2e`
Expected: all tests pass. Investigate any failures (likely tests asserting old copy or old API shape — update assertions to match the new model).

- [ ] **Step 3: Run the tapout suite**

Run: `npm test`
Expected: pass.

- [ ] **Step 4: Manual smoke test in the browser**

Run the dev server, then walk through:
- Anonymous visit `/pricing` → enter email → Subscribe → confirm POST to `/api/billing/checkout` (network tab) → confirm redirect (mock checkout in dev redirects to `/account?status=ok`).
- Anonymous visit `/login` → enter an email that has never paid → confirm "Check your email" message but no email actually sent (check function logs).
- Anonymous visit `/login` → enter a paid email → magic link arrives, callback succeeds.

- [ ] **Step 5: Commit any cleanup**

If any small fixups were needed during the sweep:

```bash
git add -p
git commit -m "fixup: regression cleanup for buy-before-login"
```

---

## Self-Review Notes

- **Spec coverage:** Frontend text removed (Task 6), checkout no longer requires session (Task 3), webhook still updates by `autumn_customer_id` (no change needed — already does), magic-link gated to paid users (Tasks 1 + 4), copy aligned across home/login (Tasks 7 + 8). 
- **Webhook user-creation:** intentionally not added because `upsertCheckoutUser` (Task 2) creates the row at checkout start. The webhook's existing UPDATE-by-`autumn_customer_id` will hit it.
- **Anti-enumeration:** `magic-link.ts` always returns 200 regardless of whether mail was sent (Task 4).
- **No CSS changes to unrelated areas:** Task 6 step 5 explicitly gates CSS edits.
