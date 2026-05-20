# Phase 6: Security headers (P1-4) Implementation Plan

**Goal:** Add a baseline of HTTP security headers — Content-Security-Policy, Strict-Transport-Security, Referrer-Policy, X-Frame-Options, X-Content-Type-Options, Permissions-Policy — to `netlify.toml`. Also flip API responses to `Cache-Control: private, no-store` (closes the smaller P2-6 finding from the audit, single-line change).

**Architecture:** Headers configured in the `[[headers]]` block in `netlify.toml` (the slot Phase 5 left empty). CSP is rolled out **report-only first** so violations surface in DevTools without breaking the app; once one staging soak shows zero violations, the enforced `Content-Security-Policy` header replaces `Content-Security-Policy-Report-Only`. The `Cache-Control` change goes into the shared `json()` helper at `netlify/lib/http.ts` and applies to every Function response.

**Tech Stack:** Netlify hosting config (`netlify.toml`), TypeScript (`netlify/lib/http.ts`).

**Scope:** Phase 6 of 7.

**Codebase verified:** 2026-05-18.
- All SPA assets are **same-origin**. Bundled by Vite into `/assets/index-*.js`, `/assets/index-*.css`, `/assets/worker-*.js` (atrament fill worker).
- The only external resource: `<iframe src="https://github.com/sponsors/nichoth/button">` in the colophon (`src/index.ts:~135` per Phase 6B investigator).
- Drawing PNGs served from same origin (`netlify/lib/drawing-images.ts` via Netlify Blobs; `<img src={post.value.image}>` reads same-origin URLs).
- atrament drawing library uses a Vite Web Worker (`?worker` import). No `eval()`, no blob-URL workers.
- No `<style>` blocks, no inline `onclick=` strings, no remote fonts (`@font-face`-free CSS; system-stack fonts).
- atproto OAuth is a server 302 redirect — browser never iframes or popups the PDS.
- `netlify/lib/http.ts:3-14` exports `json()` used by every Function. No `Cache-Control` set today.
- No tests assert presence/absence of security headers.
- Phase 5 left an empty `[[headers]]` block with just `X-Content-Type-Options = "nosniff"`. Phase 6 fills it in.

---

## Acceptance Criteria Coverage

### payment-hardening.AC17: Baseline security headers configured

- **payment-hardening.AC17.1 Success — HSTS:** `netlify.toml` emits `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.
- **payment-hardening.AC17.2 Success — X-Frame-Options:** `netlify.toml` emits `X-Frame-Options: DENY` (defense-in-depth for legacy clients alongside `frame-ancestors 'none'` in CSP).
- **payment-hardening.AC17.3 Success — X-Content-Type-Options:** `netlify.toml` emits `X-Content-Type-Options: nosniff` (already present after Phase 5; verify it stays).
- **payment-hardening.AC17.4 Success — Referrer-Policy:** `netlify.toml` emits `Referrer-Policy: strict-origin-when-cross-origin`.
- **payment-hardening.AC17.5 Success — Permissions-Policy:** `netlify.toml` emits a restrictive `Permissions-Policy` disabling unused sensors/APIs.

### payment-hardening.AC18: Content Security Policy rolled out report-only

- **payment-hardening.AC18.1 Success — report-only present:** `netlify.toml` emits `Content-Security-Policy-Report-Only` with the policy below.
- **payment-hardening.AC18.2 Defensive — same-origin assets allowed:** The CSP allows `script-src 'self'`, `style-src 'self'`, `img-src 'self' data: blob:`, `connect-src 'self'`.
- **payment-hardening.AC18.3 Defensive — GitHub Sponsors iframe allowed:** The CSP allows `frame-src https://github.com` (for the colophon sponsor button).
- **payment-hardening.AC18.4 Defensive — frame-ancestors none:** The CSP sets `frame-ancestors 'none'`.
- **payment-hardening.AC18.5 Defensive — object-src none:** The CSP sets `object-src 'none'`.
- **payment-hardening.AC18.6 Defensive — base-uri / form-action self:** The CSP sets `base-uri 'self'` and `form-action 'self'`.

### payment-hardening.AC19: API responses are not cacheable

- **payment-hardening.AC19.1 Success:** Every response produced by `netlify/lib/http.ts` `json()` includes header `Cache-Control: private, no-store`.
- **payment-hardening.AC19.2 No regression — same shape:** Existing call sites of `json()` continue to compile and return correct status/body. Tests that snapshot response shapes are unaffected.

---

## Tasks

<!-- START_TASK_1 -->
### Task 1: Add security headers + CSP (Report-Only) to `netlify.toml`

**Verifies:** payment-hardening.AC17.1, AC17.2, AC17.3, AC17.4, AC17.5, AC18.1, AC18.2, AC18.3, AC18.4, AC18.5, AC18.6 (infrastructure — operational verification)

**Files:**
- Modify: `netlify.toml` — extend the `[[headers]]` block that Phase 5 left scaffolded

**Implementation:**

Replace the Phase 5 stub:

```toml
[[headers]]
  for = "/*"
  [headers.values]
      X-Content-Type-Options = "nosniff"
```

With the full set:

```toml
# Security headers. CSP is rolled out report-only first (see Phase 6
# notes). Once staging shows zero CSP violations for one week, swap
# "Content-Security-Policy-Report-Only" to "Content-Security-Policy"
# and remove the report-only line.
[[headers]]
  for = "/*"
  [headers.values]
      Strict-Transport-Security = "max-age=63072000; includeSubDomains; preload"
      X-Content-Type-Options = "nosniff"
      X-Frame-Options = "DENY"
      Referrer-Policy = "strict-origin-when-cross-origin"
      Permissions-Policy = "accelerometer=(), ambient-light-sensor=(), autoplay=(), camera=(), compute-pressure=(), encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), hid=(), idle-detection=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), serial=(), usb=(), xr-spatial-tracking=()"
      Content-Security-Policy-Report-Only = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-src https://github.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
```

Notes on each header:

- **HSTS** `max-age=63072000` is two years; required for `preload` list submission.
- **X-Frame-Options: DENY** is defense-in-depth alongside `frame-ancestors 'none'`. Modern browsers honor `frame-ancestors`; legacy clients honor `X-Frame-Options`. Both cost nothing.
- **Permissions-Policy** uses `fullscreen=()` (fully restricted). The Phase 6B investigator found no `requestFullscreen()` calls in the drawing canvas code.
- **CSP — Report-Only first**. The directive list:
  - `default-src 'self'` — fallback for any directive not specified.
  - `script-src 'self'` — Vite produces bundled JS under same origin; no `'unsafe-inline'` needed.
  - `style-src 'self'` — no inline styles in components (verified).
  - `img-src 'self' data: blob:` — `data:` and `blob:` for atrament's canvas-derived images.
  - `connect-src 'self'` — all SPA fetch calls are same-origin.
  - `frame-src https://github.com` — for the colophon `<iframe>` to github.com/sponsors/...
  - `frame-ancestors 'none'` — nobody may iframe drerings.
  - `base-uri 'self'`, `form-action 'self'`, `object-src 'none'` — hardening baseline.

**Testing:** No automated unit test. Verification is operational.

**Verification:**

```sh
grep -n "Strict-Transport-Security\|Permissions-Policy\|Content-Security-Policy-Report-Only" netlify.toml
```
Expected: three matches.

Deploy to a deploy preview, then:

```sh
curl -sI https://<deploy-preview-url>/ | grep -i "strict-transport\|x-frame\|x-content\|referrer-policy\|permissions-policy\|content-security"
```
Expected: all six headers present.

Open the deploy preview in a browser. In DevTools → Console, look for CSP violations during normal app flow (login, draw, save, send postcard, view feed). Expected: **zero violations**. Any violation indicates a content source that wasn't in the inventory — investigate and either tighten the source's origin in the CSP, or refactor the offending code.

Open the deploy preview's colophon page and confirm the GitHub Sponsors iframe renders without a CSP frame-src violation in DevTools Network tab (verifies AC18.3).

**Commit:** `feat(netlify): add HSTS, CSP (report-only), Referrer, Permissions, X-Frame headers`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: `Cache-Control: private, no-store` on API responses

**Verifies:** payment-hardening.AC19.1, AC19.2

**Files:**
- Modify: `netlify/lib/http.ts:3-14` — extend `json()` to emit `Cache-Control`

**Implementation:**

Replace the helper:

```ts
import type { HandlerEvent, HandlerResponse } from '@netlify/functions'

export function json (
    statusCode:number,
    body:Record<string, unknown>
):HandlerResponse {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'private, no-store'
        },
        body: JSON.stringify(body)
    }
}

export function getRequestOrigin (event:HandlerEvent):string {
    if (event.rawUrl) {
        return new URL(event.rawUrl).origin
    }

    const host = event.headers.host || event.headers.Host
    const proto = event.headers['x-forwarded-proto'] || 'https'

    return `${proto}://${host}`
}

export function parseJsonBody (
    event:HandlerEvent
):Record<string, unknown>|null {
    if (!event.body) return null

    try {
        return JSON.parse(event.body) as Record<string, unknown>
    } catch {
        return null
    }
}
```

Rationale:

- `private` — only the user's browser may cache (no shared proxy caches).
- `no-store` — never persist. Combined with `private`, this is the strictest defensive setting for an authenticated API and matches what `/api/whoami` and the stamp endpoints need.

**Testing:**

If existing tests inspect the `headers` object on `json()` return values, they'll see the new `Cache-Control` key. Spot check `test/us006-session-whoami.test.ts`, `test/us020-shares-precheck.test.ts`, `test/us020-shares-record.test.ts`, `test/us023-stamp-transactions-api.test.ts` for snapshots on `headers`. If any test uses `expect(...).toEqual({...})` on the entire headers object, widen to `expect(...).toMatchObject({...})` or update the snapshot.

For a focused new test, add a single assertion in `test/us020-shares-record.test.ts` (or wherever convenient): `expect(response.headers['Cache-Control']).toBe('private, no-store')` on one shared response — this anchors the AC.

**Verification:**

```sh
npx vitest run
```
Expected: all tests pass. Any test that fails because of `Cache-Control` should have its expectation widened.

```sh
grep -rn "Cache-Control" netlify/lib/http.ts
```
Expected: one match (`'Cache-Control': 'private, no-store'`).

**Commit:** `feat(http): Cache-Control private, no-store on JSON API responses`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Full suite verification

**Verifies:** Phase 6 regression-free.

**Files:** none — verification only.

**Verification:**
```sh
npm run lint && npx vitest run
```
Expected: lint passes; all tests pass.

**Commit:** none.
<!-- END_TASK_3 -->

---

## Phase 6 Done When

- `netlify.toml` emits HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, and `Content-Security-Policy-Report-Only`.
- `netlify/lib/http.ts` `json()` emits `Cache-Control: private, no-store`.
- A deploy preview shows the headers in `curl -sI` output.
- The app works end-to-end on a deploy preview with **zero CSP violations** in DevTools.
- `npm run lint && npx vitest run` is green.

## Operator notes

- After one week of zero violations on staging in Report-Only mode, swap the header name: change `Content-Security-Policy-Report-Only =` to `Content-Security-Policy =` and remove the `-Report-Only` line. That's the "enforce" step. Commit with `feat(netlify): enforce CSP after report-only soak`.
- If a future feature needs to embed a third-party (e.g., Cloudinary images, an analytics script, a payment iframe), update the relevant CSP directive — never reach for `'unsafe-inline'` or `*` to make a warning go away.
- The `report-uri` / `report-to` infrastructure is intentionally **not** wired up here. The Report-Only soak relies on developer inspection in DevTools during staging exercise. Setting up an endpoint to collect reports is a follow-up if violation volume warrants it.
