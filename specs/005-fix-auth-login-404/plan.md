# Implementation Plan: Restore atproto Sign-In (Fix `/api/auth/login` 404)

**Branch**: `005-fix-auth-login-404` | **Date**: 2026-05-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from
`/Users/nick/code/drerings/specs/005-fix-auth-login-404/spec.md`

## Summary

`/api/auth/login` returns a "Function not found" 404 because the
underlying handler files live in nested subdirectories
(`netlify/functions/auth/login.ts`,
`netlify/functions/shares/precheck.ts`, etc.), and Netlify's
file-based function discovery only registers a function when the
file is at `netlify/functions/<name>.{ts,js}` (flat) or
`netlify/functions/<name>/<name>.{ts,js}` (folder with matching
entrypoint). Every file inside an arbitrarily nested folder is
silently undiscovered — `auth/login.ts`, `auth/callback.ts`,
`auth/logout.ts`, `billing/checkout.ts`, `billing/webhook.ts`,
`postcards/send.ts`, `shares/precheck.ts`, `shares/confirm.ts`,
`stamps/lots.ts`, `stamps/refund.ts`, `stamps/transactions.ts`,
`stamps/gifts/checkout.ts`, `stamps/gifts/refund.ts`, and
`webhooks/resend.ts` are all currently unreachable in the deployed
environment. The catch-all `/api/* → /.netlify/functions/:splat`
rewrite then proxies to a function that does not exist, producing
the 404.

The fix is structural and contained:

1. Flatten the 14 affected handler files into top-level Netlify
   Functions with dashed names that mirror their URL path segments
   (`auth/login.ts` → `auth-login.ts`, `stamps/gifts/checkout.ts`
   → `stamps-gifts-checkout.ts`, etc.). Each handler's logic is
   unchanged; only relative import depths shift by one folder.
2. Replace the broad `/api/* → /.netlify/functions/:splat`
   redirect in `netlify.toml` with explicit one-line redirects per
   endpoint so URLs remain stable and any future nested file added
   without a matching redirect fails loudly at PR review rather
   than silently 404'ing in production.
3. Update test imports that reach into
   `../netlify/functions/<subdir>/<file>.js` to the new flat
   paths.

The handler signatures (v1 `Handler` from `@netlify/functions`),
the atproto OAuth flow, rate-limit gates, session cookie contract,
postcard CAS state machine, share-event invariants, stamp accounting,
billing flow, and `oauth-client-metadata.json` cacheability are all
untouched.

## Technical Context

**Language/Version**: TypeScript 5.8 (ES2022, ESM), Node >=20.19
**Primary Dependencies**: `@netlify/functions` ^4.1.8 (v1 `Handler`
  API in current use), `@atproto/oauth-client-node` ^0.3.17,
  `@atproto/api`, `@atproto/identity`, `@netlify/database`
**Storage**: Postgres (Netlify DB) — schema unchanged by this fix
**Testing**: vitest (`npm run test:e2e`), tapout-bundled unit tests
  (`npm test`) — both already exercise the affected handlers by
  direct file import
**Target Platform**: Netlify Functions (esbuild bundler) +
  static-hosted Preact SPA; reproduces on local Netlify dev at
  `127.0.0.1:8888`
**Project Type**: Web application — Preact SPA in `src/` + Netlify
  Functions in `netlify/functions/`
**Performance Goals**: No perf change; routing remains a single
  Netlify redirect lookup per request
**Constraints**: Must not regress any other endpoint; must keep
  `/.well-known/oauth-client-metadata.json` cacheable; must not
  alter session cookie payload, HMAC signing, OAuth scopes, or
  stamp-accounting invariants
**Scale/Scope**: 14 function files moved, 1 `netlify.toml` redirect
  block rewritten, ~5 test files re-pathed

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1
design.*

The project's `.specify/memory/constitution.md` is the unfilled
template — no project-specific principles have been ratified. The
following general gates from `~/.claude/CLAUDE.md` and
`CLAUDE.md` apply and are checked:

- **No CSS changes unrelated to the task** — N/A (no CSS in scope).
- **No eslint changes** — N/A (no lint config in scope).
- **No brittle tests / no asserting raw HTML text** — Honored; new
  tests assert on Netlify routing behavior and function discovery,
  not UI text.
- **TypeScript style** (no space after `:`, 80-col, ternary
  formatting) — Honored; only relative-import lines change, in the
  existing style.
- **`@preact/signals` + `batch()`** — N/A (no client state changes).
- **Plan first, then code** — Honored by this plan.
- **No emojis** — Honored.
- **Append-only stamp ledger / postcard CAS / share invariants** —
  Untouched; only file paths change.
- **HSTS / X-Frame / CSP headers in `netlify.toml`** — Preserved
  byte-for-byte; only the `[[redirects]]` block is rewritten.
- **CORS still not configured** — Preserved.
- **`json()` defaults to `Cache-Control: private, no-store`** —
  Preserved; `oauth-client-metadata` keeps its cacheable opt-out.

**Initial Constitution Check: PASS.** No violations to justify.

**Post-Phase-1 re-check (after research.md, data-model.md,
contracts/, quickstart.md were written): PASS.** Design artifacts
introduce no new dependencies, no schema changes, no client state
changes, no CSS, no test relaxations, no `Cache-Control` weakening,
and no CORS additions. The fix remains structural (file moves +
`netlify.toml` redirect rewrite + test import-path updates) and
preserves every documented invariant in `CLAUDE.md`.

## Project Structure

### Documentation (this feature)

```text
specs/005-fix-auth-login-404/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (this command)
├── data-model.md        # Phase 1 output (routing contract, no DB)
├── quickstart.md        # Phase 1 output (reproduce + verify)
├── contracts/           # Phase 1 output (HTTP contracts)
│   └── http-endpoints.md
└── spec.md              # Feature spec (input)
```

### Source Code (repository root)

```text
netlify/
├── functions/                 # FLAT after fix; one file per endpoint
│   ├── account.ts             # (unchanged — already top-level)
│   ├── auth-callback.ts       # was auth/callback.ts
│   ├── auth-login.ts          # was auth/login.ts  (root-cause file)
│   ├── auth-logout.ts         # was auth/logout.ts
│   ├── billing-checkout.ts    # was billing/checkout.ts
│   ├── billing-webhook.ts     # was billing/webhook.ts
│   ├── drawings.ts            # (unchanged)
│   ├── oauth-client-metadata.ts  # (unchanged — cacheable)
│   ├── postcards-send.ts      # was postcards/send.ts
│   ├── posts.ts               # (unchanged)
│   ├── refund-expired-gifts.ts   # (unchanged — scheduled job)
│   ├── shares-confirm.ts      # was shares/confirm.ts
│   ├── shares-precheck.ts     # was shares/precheck.ts
│   ├── stamps-gifts-checkout.ts  # was stamps/gifts/checkout.ts
│   ├── stamps-gifts-refund.ts    # was stamps/gifts/refund.ts
│   ├── stamps-lots.ts         # was stamps/lots.ts
│   ├── stamps-refund.ts       # was stamps/refund.ts
│   ├── stamps-transactions.ts # was stamps/transactions.ts
│   ├── verify-stamp-invariants.ts  # (unchanged — scheduled job)
│   ├── webhooks-resend.ts     # was webhooks/resend.ts
│   └── whoami.ts              # (unchanged)
└── lib/                       # (UNCHANGED — domain logic stays put)
    ├── auth/atproto.ts
    ├── auth/atproto-stores.ts
    ├── auth-store.ts
    ├── billing.ts
    ├── http.ts
    ├── postcards.ts
    ├── rate-limit.ts
    ├── session.ts
    ├── shares.ts
    └── stamps.ts

netlify.toml                   # /api/* wildcard replaced with one
                               # explicit redirect per moved endpoint

src/                           # (UNCHANGED — fetch URLs already use
                               # /api/auth/login etc.)

test/
├── us039-rate-limit-login.test.ts        # import path updated
├── us039-rate-limit-endpoints.test.ts    # import path updated
├── us031-postcard-send-route.test.ts     # import path updated
├── us030-postcard-send-api.test.ts       # import path updated
├── us020-auth-callback.test.ts           # import path updated
├── us020-shares-precheck.test.ts         # import path updated
├── us020-shares-record.test.ts           # import path updated (if it
│                                         # imports the handler)
├── us016-stamp-lots-api.test.ts          # import path updated
├── us017-gift-checkout-api.test.ts       # import path updated
└── (others as discovered by import-path grep during Phase 2)
```

**Structure Decision**: Netlify Functions classic file-based
discovery requires a function file to live at
`netlify/functions/<name>.{ts,js}` (flat) or
`netlify/functions/<name>/<name>.{ts,js}` (folder + matching
entrypoint). We pick the flat option because (a) all current
handlers are single-file with no colocated helpers (those live in
`netlify/lib/`), (b) it keeps relative-import depth uniform across
all functions (`../lib/...`), and (c) it makes the redirect table
in `netlify.toml` a small, scannable list of URL → function-name
pairs, removing the silent-failure mode that hides the bug.

## Complexity Tracking

No constitution violations — section intentionally empty.
