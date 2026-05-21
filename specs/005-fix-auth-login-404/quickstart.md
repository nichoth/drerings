# Quickstart: Reproduce, Fix, Verify

**Date**: 2026-05-20
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

This document is for the engineer implementing the fix, plus the
reviewer/operator verifying it. Run from the repo root unless
otherwise noted.

## Prerequisites

- Node >=20.19 (`node --version`).
- `npm install` has been run.
- Repo is on branch `005-fix-auth-login-404` (already true).
- A valid Bluesky handle for end-to-end manual verification
  (your own `*.bsky.social` works).
- The local `.env` is configured (Postgres, Resend, Autumn,
  atproto OAuth) as documented in `README.md`.

## Reproduce the bug (before any fix)

1. Start the dev stack:

    ```sh
    npm start
    ```

    This runs `npx ntl functions:serve --port=9999 --debug` and
    `vite` concurrently. The functions server listens at
    `127.0.0.1:9999`; Netlify dev (if used) listens at
    `127.0.0.1:8888`.

2. From a fresh terminal:

    ```sh
    curl -i 'http://127.0.0.1:8888/api/auth/login?handle=test.bsky.social'
    ```

    **Pre-fix expected**: `HTTP/1.1 404 Not Found` with the
    Netlify "Function not found" page in the body. Reproduces the
    spec's symptom.

3. Confirm at least one nested endpoint sibling is also
   404'ing (sanity for the structural defect, not just one file):

    ```sh
    curl -i 'http://127.0.0.1:8888/api/stamps/lots'
    ```

    **Pre-fix expected**: `HTTP/1.1 404 Not Found`.

4. Confirm a known-good flat-file endpoint responds (sanity that
   the dev server is healthy):

    ```sh
    curl -i 'http://127.0.0.1:8888/api/whoami'
    ```

    Expected: `HTTP/1.1 401` with
    `{"error":"Please sign in."}` (no cookie present). This
    confirms routing works for flat-file functions and isolates
    the defect to nested files.

## Apply the fix

The full task list is the responsibility of `/speckit.tasks` and
implementation in a follow-up PR. The shape of the change is:

1. **Move handler files** (14 of them) into flat top-level paths.
   `git mv` is recommended so blame/history follow:

    ```sh
    git mv netlify/functions/auth/login.ts \
           netlify/functions/auth-login.ts
    git mv netlify/functions/auth/callback.ts \
           netlify/functions/auth-callback.ts
    git mv netlify/functions/auth/logout.ts \
           netlify/functions/auth-logout.ts
    git mv netlify/functions/shares/precheck.ts \
           netlify/functions/shares-precheck.ts
    git mv netlify/functions/shares/confirm.ts \
           netlify/functions/shares-confirm.ts
    git mv netlify/functions/postcards/send.ts \
           netlify/functions/postcards-send.ts
    git mv netlify/functions/billing/checkout.ts \
           netlify/functions/billing-checkout.ts
    git mv netlify/functions/billing/webhook.ts \
           netlify/functions/billing-webhook.ts
    git mv netlify/functions/stamps/lots.ts \
           netlify/functions/stamps-lots.ts
    git mv netlify/functions/stamps/refund.ts \
           netlify/functions/stamps-refund.ts
    git mv netlify/functions/stamps/transactions.ts \
           netlify/functions/stamps-transactions.ts
    git mv netlify/functions/stamps/gifts/checkout.ts \
           netlify/functions/stamps-gifts-checkout.ts
    git mv netlify/functions/stamps/gifts/refund.ts \
           netlify/functions/stamps-gifts-refund.ts
    git mv netlify/functions/webhooks/resend.ts \
           netlify/functions/webhooks-resend.ts
    ```

    Then remove the now-empty parent directories (`auth/`,
    `shares/`, `postcards/`, `billing/`, `webhooks/`, plus
    `stamps/gifts/` and any other empty `stamps/` subtree —
    note `stamps/` itself may have flat files moved out
    but is not used by any remaining function).

2. **Update relative imports** in each moved file.
   `../../lib/...` becomes `../lib/...`. For
   `stamps-gifts-checkout.ts` and `stamps-gifts-refund.ts`,
   `../../../lib/...` becomes `../lib/...`.

3. **Rewrite `netlify.toml` redirect block.** Delete:

    ```toml
    [[redirects]]
      from = "/api/*"
      to = "/.netlify/functions/:splat"
      status = 200
    ```

    Insert one block per endpoint, e.g.:

    ```toml
    [[redirects]]
      from = "/api/auth/login"
      to = "/.netlify/functions/auth-login"
      status = 200

    [[redirects]]
      from = "/api/auth/callback"
      to = "/.netlify/functions/auth-callback"
      status = 200

    [[redirects]]
      from = "/api/auth/logout"
      to = "/.netlify/functions/auth-logout"
      status = 200

    [[redirects]]
      from = "/api/shares/precheck"
      to = "/.netlify/functions/shares-precheck"
      status = 200

    [[redirects]]
      from = "/api/shares/confirm"
      to = "/.netlify/functions/shares-confirm"
      status = 200

    [[redirects]]
      from = "/api/postcards/send"
      to = "/.netlify/functions/postcards-send"
      status = 200

    [[redirects]]
      from = "/api/billing/checkout"
      to = "/.netlify/functions/billing-checkout"
      status = 200

    [[redirects]]
      from = "/api/billing/webhook"
      to = "/.netlify/functions/billing-webhook"
      status = 200

    [[redirects]]
      from = "/api/stamps/lots"
      to = "/.netlify/functions/stamps-lots"
      status = 200

    [[redirects]]
      from = "/api/stamps/transactions"
      to = "/.netlify/functions/stamps-transactions"
      status = 200

    [[redirects]]
      from = "/api/stamps/refund/*"
      to = "/.netlify/functions/stamps-refund/:splat"
      status = 200

    [[redirects]]
      from = "/api/stamps/gifts/checkout"
      to = "/.netlify/functions/stamps-gifts-checkout"
      status = 200

    [[redirects]]
      from = "/api/stamps/gifts/refund/*"
      to = "/.netlify/functions/stamps-gifts-refund/:splat"
      status = 200

    [[redirects]]
      from = "/api/webhooks/resend"
      to = "/.netlify/functions/webhooks-resend"
      status = 200

    [[redirects]]
      from = "/api/whoami"
      to = "/.netlify/functions/whoami"
      status = 200

    [[redirects]]
      from = "/api/account"
      to = "/.netlify/functions/account"
      status = 200

    [[redirects]]
      from = "/api/drawings"
      to = "/.netlify/functions/drawings"
      status = 200

    [[redirects]]
      from = "/api/drawings/*"
      to = "/.netlify/functions/drawings/:splat"
      status = 200

    [[redirects]]
      from = "/api/posts"
      to = "/.netlify/functions/posts"
      status = 200

    [[redirects]]
      from = "/api/posts/*"
      to = "/.netlify/functions/posts/:splat"
      status = 200
    ```

    Preserve the existing
    `/.well-known/oauth-client-metadata.json` block and the
    `/* → /index.html` SPA fallback unchanged. Preserve the
    `[[headers]]` block byte-for-byte.

    > Confirm the exact splat parameter set for `drawings` and
    > `posts` against current SPA call sites before final
    > redirect-block authoring; both currently work under the
    > wildcard, so any path shape they relied on must be
    > replicated explicitly.

4. **Update test imports** that reach handler entrypoints by path:

    ```sh
    grep -rln "netlify/functions/auth/login\|netlify/functions/auth/callback\|netlify/functions/auth/logout\|netlify/functions/shares/\|netlify/functions/postcards/\|netlify/functions/billing/\|netlify/functions/stamps/\|netlify/functions/webhooks/" test/
    ```

    For each match, update the import string to the new flat
    name (e.g. `../netlify/functions/auth/login.js` →
    `../netlify/functions/auth-login.js`).

## Verify the fix

### Automated

```sh
npm test && npm run lint
```

`test/index.ts` bundles the tapout suite. `vitest` (`npm run
test:e2e`) covers the e2e cases.

Acceptance:

- All previously-passing tests pass. No skipped or relaxed
  assertions.
- Lint clean. No new ESLint disables.

### Manual end-to-end

1. Restart the dev stack (`npm start`) to pick up new file
   layout. Watch for "Loaded function: auth-login" (or
   equivalent) lines from `ntl functions:serve --debug`. Confirm
   every flat function in the redirect table appears in the
   load log.

2. Repeat the reproduction `curl`:

    ```sh
    curl -i 'http://127.0.0.1:8888/api/auth/login?handle=test.bsky.social'
    ```

    Expected post-fix: `HTTP/1.1 302 Found` with a `Location:`
    header pointing at the PDS authorize URL. (Or `400
    handle_required` if the handle is omitted, `429` if rate
    limited, `405` for non-GET — anything but 404.)

3. In a fresh browser (no `drerings_auth` cookie), navigate
   through the sign-in flow end-to-end:
   - Visit `/login` (or the SPA's sign-in entry point).
   - Enter your Bluesky handle.
   - Authorize at your PDS.
   - Confirm return to the app with a session.
   - Confirm `GET /api/whoami` returns `{ id, did, handle,
     stamps_balance }`.

4. Sign out and confirm `/api/auth/logout` returns 200 with the
   `drerings_auth` cookie cleared and the atproto session
   revoked (cookie value gone in DevTools; subsequent
   `/api/whoami` 401's).

5. Smoke each previously-broken sibling endpoint, signed in:

    ```sh
    curl -i -b "drerings_auth=<your cookie>" \
        http://127.0.0.1:8888/api/stamps/lots
    curl -i -b "drerings_auth=<your cookie>" \
        http://127.0.0.1:8888/api/stamps/transactions
    ```

    Expected: 200 (or 401 / handler-specific status — never
    404).

6. `POST /api/auth/login` (wrong method):

    ```sh
    curl -i -X POST 'http://127.0.0.1:8888/api/auth/login'
    ```

    Expected: 405 with `{"error":"method_not_allowed"}` — not
    404.

### Routing-table sanity checks

These derive from `data-model.md` acceptance gates AG-D1..D4.

```sh
# AG-D1: no nested function files (one level deep max,
# and existing scheduled jobs are flat).
find netlify/functions -mindepth 2 -type f -name '*.ts'
# Expected: no output.

# AG-D2: no /api/* wildcard remains.
grep -n 'from = "/api/\*"' netlify.toml
# Expected: no output.

# AG-D3: every redirect targets an existing function file.
grep -oE 'to = "/.netlify/functions/[a-z0-9-]+' netlify.toml \
    | sed 's|to = "/.netlify/functions/||' \
    | sort -u \
    | while read name; do
        test -f "netlify/functions/$name.ts" || \
            echo "MISSING: netlify/functions/$name.ts"
    done
# Expected: no MISSING lines.
```

## Rollback plan

If the fix introduces a regression on staging, revert the merge
commit. The change is purely structural (file moves +
`netlify.toml` rewrite + test import-path updates) — no
migrations, no cookie format changes, no domain logic changes.
The revert restores the pre-fix layout, which has the original
404 bug but no other side effects.

## What this fix does NOT cover

Items intentionally out of scope per the spec:

- Migrating to Netlify Functions v2 (`config.path`-based
  self-routing). Tracked as future work.
- Any change to OAuth scopes, session TTL, cookie payload, or
  handle validation.
- Any redesign of the sign-in UI.
- Adding a new automated test that exercises the
  redirect-table-to-handler routing end-to-end (the existing
  unit tests cover handler behavior; an integration test that
  drives `ntl functions:serve` is recommended as a follow-up).
