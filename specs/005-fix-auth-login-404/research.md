# Phase 0 Research: Restore atproto Sign-In

**Date**: 2026-05-20
**Spec**: [spec.md](./spec.md)
**Plan**: [plan.md](./plan.md)

## Root cause investigation

### Symptom

`GET /api/auth/login?handle=<handle>` returns a Netlify-served 404
("Function not found") in both local Netlify dev
(`127.0.0.1:8888`) and deployed environments. No request log
appears in the function — the request never reaches the handler.

### Routing pipeline

`netlify.toml` (pre-fix) contains:

```toml
[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200
```

So `GET /api/auth/login` rewrites to
`GET /.netlify/functions/auth/login`. Netlify then looks up a
function named `auth/login` in its function index. None exists, so
it returns the platform 404 page.

### Why no function named `auth/login` exists

Netlify Functions classic file-based discovery (which the project
uses — handlers export `Handler` from `@netlify/functions`, the v1
API) registers a function for each file under
`netlify/functions/` that matches one of:

- `netlify/functions/<name>.{ts,js,mjs,cjs}` — flat file. Function
  name = filename without extension.
- `netlify/functions/<name>/<name>.{ts,js,mjs,cjs}` — folder with
  matching entrypoint. Function name = folder name.
- `netlify/functions/<name>/index.{ts,js,mjs,cjs}` — folder with
  `index` entrypoint. Function name = folder name.

A file like `netlify/functions/auth/login.ts` matches NONE of
those. Netlify treats it as a non-entrypoint helper file (eligible
to be bundled alongside an entrypoint, but not itself a function).
No entrypoint exists in `auth/`, so the entire `auth/` folder
contributes zero functions. The same is true for `billing/`,
`postcards/`, `shares/`, `webhooks/`, `stamps/` (flat files
inside `stamps/` are discovered as `lots`, `refund`,
`transactions` — but those names then collide with their parent
URL prefix, so the wildcard rewrite still misses them. See
"Edge: top-level files inside subfolders" below).

### Edge: top-level files inside subfolders

`stamps/lots.ts`, `stamps/refund.ts`, `stamps/transactions.ts`
are arguably *discovered* by Netlify because each lives at
`netlify/functions/stamps/lots.ts` style — but Netlify's discovery
rule requires the file to either be at the root or match its
parent-folder name. None of these match `stamps`. They are
non-entrypoint files. The wildcard rewrite then tries to call
`/.netlify/functions/stamps/lots` (which doesn't exist) and 404's
identically. Confirmed by the spec's Assumptions section calling
these endpoints out as "vulnerable to the same defect."

### Verification

`netlify/functions/oauth-client-metadata.ts` and
`netlify/functions/whoami.ts` are both flat top-level files; they
register successfully and respond from their handlers in the same
environments where the nested endpoints 404. This isolates the
defect to file layout, not deployment configuration.

## Decision: flat function files + explicit redirects

**Decision**: Move each affected handler from
`netlify/functions/<area>/<endpoint>.ts` to a flat
`netlify/functions/<area>-<endpoint>.ts` (and for the one
two-deep case, `netlify/functions/stamps/gifts/<endpoint>.ts` →
`netlify/functions/stamps-gifts-<endpoint>.ts`). Each handler's
logic is unchanged — only `import` paths shift from `../../lib/`
to `../lib/`. The `netlify.toml` `/api/*` wildcard rewrite is
replaced with an explicit one-line redirect per moved endpoint,
plus the already-flat endpoints (`whoami`, `account`, `drawings`,
`posts`) get explicit redirects too so the wildcard can be
deleted entirely.

**Rationale**:

- **Smallest correctness delta.** Handlers, OAuth flow,
  rate-limit gates, session cookie format, stamp accounting, and
  postcard CAS state machine all stay byte-identical. The blast
  radius is "files move + import paths shift".
- **Fail-loud routing.** With explicit redirects, adding a new
  function file without a matching redirect makes `npm run
  start` and CI surface the 404 immediately as a missing route,
  rather than the silent discovery failure that caused this bug.
- **Compatible with v1 `Handler` API already in use.** The
  alternative — migrating to Netlify Functions v2 (which
  supports `export const config = { path: '/api/auth/login' }`
  and self-routing) — requires rewriting every handler's
  signature from
  `(event) => { statusCode, headers, body }` to
  `(req: Request, ctx: Context) => Response`. That is a
  significantly larger surface area to verify under a P0 outage.

**Alternatives considered**:

1. **Netlify Functions v2 with `config.path`.** Modern, self-
   routing, no `netlify.toml` redirects needed. Rejected because
   it requires migrating 14+ handlers' signatures, response
   helpers (`json()` returns Netlify v1 shape), and all related
   tests in one change. Worth doing as a follow-up but out of
   scope for this bugfix.

2. **Folder-per-function with matching name** (e.g.,
   `netlify/functions/auth-login/auth-login.ts`). Same discovery
   guarantee as the flat option. Rejected because none of the
   current handlers need colocated helpers (domain logic lives in
   `netlify/lib/`), so the extra folder is dead structure. Easy
   to migrate later if any function grows internal modules.

3. **Use a single dispatcher function** mapping `/api/*` to a
   router. Rejected because it inverts the platform's per-route
   bundle-splitting (each Netlify Function bundles independently),
   inflates cold-start time, and obscures per-route rate-limit /
   webhook secret handling.

4. **Add `index.ts` re-exports in each subfolder** (e.g.,
   `netlify/functions/auth/auth.ts` re-exports `login.ts`).
   Rejected: only one function can be the entrypoint per folder.
   Doesn't fix the underlying invisibility of the sibling files.

## Decision: replace wildcard redirect with explicit list

**Decision**: Delete the `/api/* → /.netlify/functions/:splat`
redirect. Replace with one explicit `[[redirects]]` block per
endpoint, mapping the public URL to the flat function name.

**Rationale**:

- The wildcard was the silent-failure surface that hid this bug.
  Removing it converts a future "missing function" into a 404 at
  the redirect layer that's visible in `netlify.toml` diff
  review, not at the function-discovery layer that requires
  inspecting build logs.
- The redirect table becomes self-documenting: the canonical list
  of public API endpoints lives in `netlify.toml`, side-by-side
  with the existing security headers.
- Each redirect is a single line. With 14 endpoints affected and
  ~5 already-flat endpoints, the table is ~20 lines — small
  enough to review at a glance.

**Alternatives considered**:

1. **Keep wildcard alongside explicit redirects.** Rejected:
   redundant, and re-introduces the silent-failure mode for any
   future nested file.

2. **Use `_redirects` file in `public/`.** Rejected:
   `netlify.toml` is already the source of truth for both
   headers and redirects in this repo; splitting them adds drift
   risk.

## Decision: keep v1 `Handler` API

**Decision**: Do not migrate to Netlify Functions v2 in this fix.

**Rationale**:

- This is a P1 outage fix. Smaller surface area = faster, safer
  to ship and to revert.
- v1 handlers and `@netlify/functions` ^4.x coexist; the project
  is not blocked from migrating later.
- v2 migration touches every handler's body, response shape, and
  the `json()` helper in `netlify/lib/http.ts`. That belongs in
  its own branch with its own test plan.

**Alternatives considered**: see "Netlify Functions v2 with
`config.path`" above.

## Decision: tests update only their import paths

**Decision**: Test files that import handler entrypoints by
relative path (`../netlify/functions/auth/login.js`, etc.) update
those imports to the new flat paths
(`../netlify/functions/auth-login.js`). No test logic changes.

**Rationale**:

- The tests assert handler behavior, not file layout. The handler
  body is unchanged.
- Brittle-test rule from `CLAUDE.md` is preserved — no new
  assertions on URL strings or HTML.

**Alternatives considered**:

1. **Move tests to mirror new layout in `test/` paths.**
   Rejected: test paths are independent of source paths; renaming
   tests adds churn without value.

2. **Add new tests asserting Netlify routing reaches each
   handler.** Recommended as a follow-up integration test (see
   quickstart.md) but the existing direct-import unit tests
   already exercise the handler logic; the missing piece is
   end-to-end coverage of the redirect → discovery pipeline,
   which is hard to assert in a unit test and is captured by
   the quickstart manual verification.

## Open questions

None. All `NEEDS CLARIFICATION` items resolved.

## References

- Netlify Functions classic file-based discovery rules
  (`netlify/functions/<name>.ts` or `<name>/<name>.ts`).
- `netlify.toml` (pre-fix) — current redirect table.
- `netlify/functions/oauth-client-metadata.ts` and
  `netlify/functions/whoami.ts` — working flat-file precedent in
  the same codebase.
- Project `CLAUDE.md` — endpoint inventory and handler contracts
  (auth, shares, postcards, billing, stamps, webhooks).
