# Quickstart: Reproduce and Verify the Fix

**Date**: 2026-05-21
**Spec**: [spec.md](./spec.md)
**Plan**: [plan.md](./plan.md)

This quickstart walks through reproducing the 404 on the pre-fix
branch and verifying it stays fixed on the post-fix branch. It is
the manual companion to the automated static-analysis test, and it
also exercises the spec's acceptance scenarios end-to-end.

## Prerequisites

- Node >=20.19, npm.
- A working `.env` (or Netlify-linked env) with at least:
  `SESSION_SECRET`, `PUBLIC_URL` (defaults to
  `http://127.0.0.1:9999` if unset, but with this fix the canonical
  origin is `http://127.0.0.1:8888` — set it to that),
  `NETLIFY_DATABASE_URL` for Postgres.
- A real Bluesky handle you can sign in as.
- Browser with a fresh profile (no `drerings_auth` cookie).

## Reproduce the bug (pre-fix branch)

1. Check out a branch that contains the dual-server `start` script
   and the Vite proxy block — for example,
   `git checkout staging` (the 005 fix is on staging but the dev-
   workflow drift this 006 plan fixes is not).
2. `npm install`
3. `npm start`
4. Wait for both processes to finish their first-time output.
5. Open `http://127.0.0.1:8888/api/auth/login?handle=<your-handle>`
   in the fresh browser profile.
6. Expected (pre-fix): the page body shows the bare text
   `Function not found...`. This is the bug the spec describes.

## Apply the fix and verify (post-fix branch)

1. `git checkout 006-fix-auth-login-404`
2. `npm install`
3. `npm start` (now invokes `netlify dev`)
4. Wait for `netlify dev` to log `◈ Server now ready on
   http://localhost:8888`. The first compile may take a couple of
   seconds; subsequent requests are fast.

### Acceptance scenario 1 — first request reaches handler (FR-005)

5. As the FIRST network request after server start, open
   `http://127.0.0.1:8888/api/auth/login?handle=<your-handle>` in
   the browser.
6. Expected: HTTP 302 redirect to your PDS authorize URL (you land
   on `bsky.social` or your custom PDS). No `Function not found`
   body.

### Acceptance scenario 2 — repeat requests stay routed (FR-001)

7. Click sign-in repeatedly, or `curl -i
   "http://127.0.0.1:8888/api/auth/login?handle=<your-handle>"`
   several times in succession.
8. Expected: every response is one of 302 (success), 400
   (`handle_required` if you drop the param), 405 (if you use
   `-X POST`), or 429 (after 10 requests in a minute). Never a
   platform 404 "Function not found".

### Acceptance scenario 3 — callback completes the sign-in (FR-002)

9. Complete the PDS authorize prompt; you are redirected back to
   `http://127.0.0.1:8888/api/auth/callback?...`.
10. Expected: callback runs, you are redirected to `/` (or whatever
    the app's post-login route is), and `curl
    http://127.0.0.1:8888/api/whoami --cookie "drerings_auth=..."`
    returns your user.

### Acceptance scenario 4 — logout reaches handler (FR-003)

11. `curl -i -X POST http://127.0.0.1:8888/api/auth/logout --cookie
    "drerings_auth=..."`
12. Expected: 200 (or whatever the handler currently returns) and a
    `Set-Cookie` header that expires `drerings_auth`. Never a 404.

### Acceptance scenario 5 — client metadata still cacheable (FR-004)

13. `curl -i
    http://127.0.0.1:8888/.well-known/oauth-client-metadata.json`
14. Expected: 200 with a JSON body matching the OAuth client metadata
    document, and the `Cache-Control` header showing the cacheable
    opt-out (not `private, no-store`). The dev server preserves the
    handler's response headers, so the cacheability contract holds.

### Acceptance scenario 6 — dev-server restart, no warm-up needed (FR-008)

15. Stop `npm start` (Ctrl-C).
16. Restart with `npm start`.
17. As the FIRST request, repeat scenario 1 above.
18. Expected: same 302 response. The fix is durable across restarts.

### Acceptance scenario 7 — no regression on other endpoints (FR-007)

19. With a valid session, exercise a sampling of other endpoints:
    - `GET /api/whoami`
    - `GET /api/stamps/lots`
    - `GET /api/stamps/transactions`
    - `POST /api/shares/precheck` with a valid body
20. Expected: each reaches the handler (200, 400, 401, 404, etc per
    the handler's logic). None return the platform "Function not
    found" body.

## Automated test verification

```sh
npm test
```

Expected: all tests pass, including the new
`test/netlify-toml-routing.test.ts`. The new test would have failed
on the pre-005 branch (`auth-login.ts` did not exist), confirming
it exercises the defect class.

To prove the test is load-bearing on this fix:

```sh
# Temporarily break the redirect target
sed -i.bak 's|auth-login|auth-broken|' netlify.toml
npm test                        # expect FAILURE on the new test
mv netlify.toml.bak netlify.toml
npm test                        # expect PASS
```

## Out-of-scope deploy verification (FR-001 deployed environments)

Once merged to staging, the same scenarios 1-7 above run against
`https://staging.drerings.app` (or whatever the staging origin is)
must pass. This is the same exercise minus the local dev server,
and the redirect table is shared, so the behavior is identical.

## Rollback

If a regression appears post-merge:

1. Revert the `package.json` `scripts.start` change.
2. Revert the `vite.config.js` `server.proxy` removal.
3. The new test still passes (it doesn't depend on the dev workflow)
   so leave it in place — it catches the next routing-vs-files drift
   on the same commit it's introduced.

The fix's blast radius is small enough that a partial revert (just
the dev-workflow swap) is viable if `netlify dev` turns out to have
an unexpected incompatibility — the static-analysis test and
`netlify.toml` redirect table from 005 still produce a correct
production deploy.
