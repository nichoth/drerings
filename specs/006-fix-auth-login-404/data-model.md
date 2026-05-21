# Phase 1 Data Model: atproto Sign-In 404 Recurrence

**Date**: 2026-05-21
**Spec**: [spec.md](./spec.md)
**Plan**: [plan.md](./plan.md)

This feature does not change any database schema, table, or
persisted entity. No SQL migration is needed.

The "entities" the spec identifies (`Routing configuration`,
`Session`, `atproto OAuth state`) are routing/config and existing
storage. The session cookie and OAuth state tables are out of scope;
this fix only restores reachability to the handlers that produce
them.

## Configuration entities (in scope)

### Redirect rule

The `[[redirects]]` blocks in `netlify.toml` are the routing
configuration. The shape of one block:

```toml
[[redirects]]
  from = "/api/<segments>"            # public URL pattern
  to   = "/.netlify/functions/<name>" # function-name target
  status = 200                        # rewrite (NOT a 30x redirect)
```

The 200-status entry is a rewrite — the browser sees the original
URL; only the upstream changes. This is intentional and unchanged
from 005.

Fields:

| Field    | Type   | Meaning                                          |
| -------- | ------ | ------------------------------------------------ |
| `from`   | string | URL pattern. `*` matches one or more segments.   |
| `to`     | string | Function target. `:splat` substitutes `*`.       |
| `status` | int    | Always `200` for `/api/*` (rewrite, not redirect)|

Validation rule (enforced by the new static-analysis test):

- For every entry whose `to` starts with `/.netlify/functions/`, the
  function name (the segment immediately after that prefix, before
  any `/:splat`) MUST correspond to a file `netlify/functions/
  <name>.ts` that exists on disk.
- The inverse also holds for the subset of function files that are
  request-routed (i.e. excluding scheduled jobs and webhook-only
  handlers; see [contracts/routing.md](./contracts/routing.md) for
  the exclusion list and rationale).

### Function file

A file at `netlify/functions/<name>.ts` exporting a v1 `Handler`:

```ts
import type { Handler } from '@netlify/functions'

export const handler:Handler = async function handler (event) {
    // ...
}
```

Discovery is by file name; the name (without extension) becomes the
function identifier in the Netlify Functions runtime. This was
established by the 005 fix and is preserved as-is.

### Dev-server invariant

The new contract: a single source of truth for `/api/*` routing.

Before this fix:

- `netlify.toml` redirects govern production routing.
- `vite.config.js#server.proxy` governs local dev routing.
- The two are independent files and can drift.

After this fix:

- `netlify.toml` redirects govern BOTH production and local dev.
- `netlify dev` (invoked via `npm start`) reads `netlify.toml` and
  applies the redirect table.
- `vite.config.js` has no `server.proxy` block.

No other config files participate in routing.

## Out-of-scope entities (preserved verbatim)

| Entity                       | Why mentioned | What changes |
| ---------------------------- | ------------- | ------------ |
| `drerings_auth` cookie       | spec §Entities| Nothing      |
| `atproto_sessions` table     | spec §Entities| Nothing      |
| `atproto_oauth_states` table | spec §Entities| Nothing      |
| `rate_limit_buckets` table   | FR-006        | Nothing      |
| `users` table                | login → user  | Nothing      |
| `stamp_lots` / `stamp_transactions` / `share_events` / `postcards` | regression risk per FR-007 | Nothing |

The fix is at the routing layer; every domain entity is reached by
the unchanged handler bodies via the unchanged `netlify/lib/` import
graph.

## State transitions

No state machine changes. The postcards CAS state machine
(`queued → debiting → sent | failed_refunded`) and the share-event
append-only model are untouched.

## Migration

None. No SQL migration is added; the highest migration number stays
at 0017 (`rate_limit_buckets`).
