# Phase 5: CORS lockdown (P1-3) Implementation Plan

**Goal:** Eliminate the invalid `Access-Control-Allow-Origin: *` + `Access-Control-Allow-Credentials: true` combination in `netlify.toml`. The SPA makes only same-origin requests (verified), so the cleanest fix is to **remove the CORS headers entirely** — no need for an exact-origin allowlist or an Edge Function.

**Architecture:** Drop the `[[headers]]` block currently scoped to `for = "/*"` that emits CORS values. Replace with security-only headers (Phase 6 expands these further). Same-origin browser requests don't trigger CORS preflight; cross-origin third-party callers were never an intended audience.

**Deviation from audit:** The security audit recommended an exact-origin allowlist (e.g., `PUBLIC_URL` in production). This phase goes stricter by removing CORS entirely. Justification: the SPA makes only same-origin requests (verified by Phase 5B investigator), so no `Allow-Origin` header is required. If a future product requirement adds cross-origin clients, the recommended approach is an Edge Function that echoes back allowlisted origins (never return `*` with credentials).

**Tech Stack:** Netlify hosting config (`netlify.toml`).

**Scope:** Phase 5 of 7.

**Codebase verified:** 2026-05-18.
- `netlify.toml` lines 1-8 have the offending block.
- SPA makes zero cross-origin `fetch()` calls (`src/state.ts` and routes all use relative `/api/*` paths). Confirmed by Phase 5B investigator.
- atproto OAuth is a server-side 302 redirect to the PDS — the browser does **not** make a cross-origin XHR.
- `PUBLIC_URL` env var is server-only (read in `netlify/lib/auth/atproto.ts:7`). No client exposure.
- No tests assert CORS headers (`grep "Access-Control" test/` returns zero matches).
- Only one `[context.*]` block exists today: `[context.staging]` (line 38-39). No per-context header blocks.
- Phase 6 will add CSP / HSTS / Referrer-Policy / etc. headers in the same `[[headers]]` slot Phase 5 is clearing. Phase 5 leaves a stubbed-out block ready for Phase 6.

---

## Acceptance Criteria Coverage

### payment-hardening.AC16: CORS wildcard removed

- **payment-hardening.AC16.1 Success — no wildcard:** After Phase 5, `netlify.toml` does NOT contain `Access-Control-Allow-Origin = "*"`.
- **payment-hardening.AC16.2 Success — no credentials with wildcard:** After Phase 5, `netlify.toml` does NOT contain `Access-Control-Allow-Credentials = "true"` (we don't need it; the SPA is same-origin).
- **payment-hardening.AC16.3 Success — same-origin still works:** A `POST /api/postcards/send` from the same-origin SPA still succeeds. (No CORS preflight is triggered for same-origin requests.)
- **payment-hardening.AC16.4 Success — cross-origin denied by default:** A browser-side `fetch('https://drerings.app/api/whoami', {credentials:'include'})` from a third-party origin is blocked by the browser's same-origin policy (no `Access-Control-Allow-Origin` header in the response).

---

## Tasks

<!-- START_TASK_1 -->
### Task 1: Remove the wildcard CORS block from `netlify.toml`

**Verifies:** payment-hardening.AC16.1, AC16.2 (infrastructure — operational verification)

**Files:**
- Modify: `netlify.toml:1-8` — delete the CORS values; leave the `[[headers]]` block as a stub for Phase 6 to populate

**Implementation:**

Replace lines 1-10 of `netlify.toml` with:

```toml
# Security headers. Phase 6 adds CSP, HSTS, Referrer-Policy, etc.
# CORS is intentionally not configured — the SPA is same-origin
# and the API does not need cross-origin browser access. If a future
# product requirement adds cross-origin clients, add an Edge Function
# that echoes back exact origins from an allowlist (do not return `*`
# with credentials).
[[headers]]
  for = "/*"
  [headers.values]
      X-Content-Type-Options = "nosniff"

```

Leave the rest of the file unchanged (the `[[redirects]]`, `[functions]`, `[build]`, `[context.staging]` blocks).

The `X-Content-Type-Options = "nosniff"` is the only header carried over from prior bookkeeping (it's harmless and was implicitly missing). Phase 6 will add the rest.

**Testing:**

No automated test asserts header presence; tests under `test/` mock `fetch` and don't reach Netlify's edge. Verification is operational.

**Verification:**

```sh
grep -n "Access-Control-Allow-Origin\|Access-Control-Allow-Credentials" netlify.toml
```
Expected: no matches.

After deploy to a Netlify deploy-preview:

```sh
curl -i https://<deploy-preview-url>/api/whoami -H "Origin: https://evil.example.com"
```
Expected response headers contain **no** `Access-Control-Allow-Origin` line and **no** `Access-Control-Allow-Credentials` line.

```sh
curl -i -X OPTIONS https://<deploy-preview-url>/api/postcards/send \
     -H "Origin: https://evil.example.com" \
     -H "Access-Control-Request-Method: POST"
```
Expected: 404 or 405 from Netlify (no CORS headers; the OPTIONS preflight from a cross-origin browser caller would fail at the browser before reaching our function).

Same-origin smoke (open the deploy preview in a browser, log in, send a postcard) — must still work.

**Commit:** `chore(netlify): remove wildcard CORS — SPA is same-origin`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Full suite verification

**Verifies:** Phase 5 regression-free.

**Files:** none — verification only.

**Verification:**
```sh
npm run lint && npx vitest run
```
Expected: lint passes; all tests pass. (No test should depend on the removed CORS headers; if any does, that's a sign the test was over-specified — fix at this point.)

**Commit:** none.
<!-- END_TASK_2 -->

---

## Phase 5 Done When

- `netlify.toml` has no `Access-Control-Allow-Origin` or `Access-Control-Allow-Credentials` directives.
- Same-origin SPA traffic continues to work.
- Cross-origin `fetch` from a third-party origin to `/api/*` is blocked by the browser's same-origin policy by default.
- Lint + tests are green.

## Operator notes

- If a future feature exposes the API to third-party clients (e.g., a public read-only API), add an Edge Function at `netlify/edge-functions/cors-headers.ts` that echoes back the request `Origin` only when it matches an allowlist. Do **not** restore the wildcard.
- The `[[headers]]` block is intentionally kept (just emptied of CORS) so Phase 6 has a clear home for its header set.
