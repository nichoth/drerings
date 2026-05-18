# Phase 4: atproto OAuth Revival Implementation Plan

**Goal:** Replace the email/passkey/magic-link auth stack with Bluesky
OAuth (atproto) login. Users are keyed by DID. The post-login session
is a signed HttpOnly cookie; the atproto session details (access JWT,
refresh JWT, DPoP keypair) live in a new `atproto_sessions` table
keyed by DID.

**Architecture:** Use **`@atproto/oauth-client-node` v0.3.17** rather
than hand-rolling DPoP/PAR/PKCE. Research surfaced significant
hand-rolling gotchas (DPoP nonce rotation, query-stripping in `htu`,
concurrent refresh serialization) that the library handles
transparently. The design plan explicitly permits this escape hatch
("If implementation hits non-trivial spec drift versus the current
atproto OAuth profile, fall back to `@atproto/oauth-client-node`").

The library needs a `sessionStore` and `stateStore`. We back both with
Postgres tables (created by a new migration 0013). The signed
`drerings_auth` HttpOnly cookie carries only `{ id, did, handle,
issued_at }` — the library handles token refresh server-side via its
own store on every request.

**Tech Stack:** TypeScript 5.8 (ES2022, ESM), `@atproto/oauth-client-node`
0.3.17, `@atproto/api` 0.19.x, `@atproto/identity` 0.4.x, Postgres.

**Scope:** 4 of 8 phases. Depends on Phase 1 (schema reset) and Phase 2
(subscription removal).

**Codebase verified:** 2026-05-17

---

## Codebase Investigation Findings

- **No atproto packages currently installed.** `package.json`
  dependencies include `@simplewebauthn/*` (passkey) and a Resend SDK
  for magic-link email. After this phase: add `@atproto/api`,
  `@atproto/identity`, and `@atproto/oauth-client-node`. Optionally
  remove `@simplewebauthn/*` since passkey login is gone.
- **`netlify/lib/session.ts`** uses HMAC-signed base64url payload
  cookies. Cookie name: `drerings_session`. Reuses the same pattern;
  rename to `drerings_auth` per design and change the payload to
  `{ id, did, handle, issued_at }`.
- **`netlify/lib/auth-store.ts`** has `SessionUser` with email and
  `subscription_status`. Both fields must go; replace with `did`,
  `handle`. Keep `id`, `stamps_balance`, `autumn_customer_id`.
- **`src/routes/login.ts`** is currently an email magic-link + passkey
  form. Rewrite to a single Bluesky handle entry field.
- **`test/us001-no-atproto.test.ts`** asserts NO atproto packages
  exist. **Invert** the assertion (atproto becomes a required
  dependency).
- **Prior commits `34edfab` and `eab1f3c`** added a hand-rolled
  atproto auth path in `netlify/functions/auth.ts` (915 lines). We
  use this only as a reference for the cookie schema and UI flow,
  not as the source of OAuth wiring.
- The Resend dep is still used for postcards (see CLAUDE.md), so
  do not remove it.

---

## External Dependency Research Findings

- **`@atproto/oauth-client-node` 0.3.17**: `NodeOAuthClient` class.
  Constructor takes `clientMetadata`, `sessionStore`, `stateStore`,
  `requestLock`, and `keyset` (a `JoseKey`/`JwtKey` array used for
  client-attestation JWTs in the confidential-client path).
  - `client.authorize(handle, opts)`: returns redirect URL for PAR.
  - `client.callback(searchParams)`: completes the flow; returns
    `{ session, state }` where `session` is an `OAuthSession` that
    can be used to construct an `Agent`.
  - `client.restore(did)`: hydrates an `OAuthSession` from the store.
  - `client.revoke(did)`: revokes and clears the session.
- **`@atproto/identity` 0.4.x**: `IdResolver`,
  `IdResolver.handle.resolve(handle)`, `IdResolver.did.resolve(did)`
  for DID/handle resolution. We only need this if we want to validate
  the handle separately from the OAuth flow — the library does the
  DID resolution internally.
- **Client metadata document**: served at `/.well-known/oauth-client-metadata.json`.
  `client_id` is the URL of the metadata document itself. For
  `localhost`/`127.0.0.1` dev, use the embedded client-id loophole:
  `client_id = http://localhost?redirect_uri=…&scope=…`. The library
  handles this via its `clientMetadata` parameter.
- **DPoP signing key**: ES256 only. Library generates and persists
  per-session keys via the session store.
- **Session store contract**: implement `get(sub)`, `set(sub, session)`,
  `delete(sub)`. The `sub` is the user's DID. Stored value is an
  opaque JSON blob the library hands us.
- **State store contract**: implement `get(state)`, `set(state, data)`,
  `delete(state)`. The `state` is a short random string; the data is
  PKCE + DPoP key + originating handle.
- Spec note: the spec is still in "developer preview"; using the
  official library means breaking changes ship in coordinated patch
  releases.

---

## Acceptance Criteria Coverage

### share-quota.AC1: Bluesky OAuth login works
- **share-quota.AC1.1 Success:** User submits a valid Bluesky handle
  on `/login`; after redirect they return authed with a `users` row
  keyed by their DID.
- **share-quota.AC1.2 Success:** Returning user with an existing
  `users.did` row logs in again; their `handle` and `handle_updated_at`
  columns are refreshed (no duplicate row).
- **share-quota.AC1.3 Success:** Logout clears the `drerings_auth`
  cookie and `whoami` returns 401.
- **share-quota.AC1.4 Failure:** Callback called with a missing or
  mismatched `state` parameter returns 400 and writes no `users` row.

---

## Tasks

<!-- START_TASK_1 -->
### Task 1: Migration 0013 — atproto session and state stores

**Files:**
- Create: `/Users/nick/code/drerings/netlify/database/migrations/0013_atproto_session_state/migration.sql`
- Create: `/Users/nick/code/drerings/netlify/database/migrations/0013_atproto_session_state/down.sql`

**Step 1: Create the directory**

```bash
mkdir -p /Users/nick/code/drerings/netlify/database/migrations/0013_atproto_session_state
```

**Step 2: Write `migration.sql`**

```sql
-- 0013_atproto_session_state
-- Backing storage for @atproto/oauth-client-node's SessionStore and
-- StateStore. SessionStore is keyed by the user's DID (the OAuth
-- 'sub'). StateStore is keyed by the random state value generated at
-- the start of each OAuth flow. Both store opaque JSON blobs the
-- library writes; we do not interpret the contents.

BEGIN;

CREATE TABLE atproto_sessions (
    sub TEXT PRIMARY KEY,
    session_data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE atproto_oauth_states (
    state TEXT PRIMARY KEY,
    state_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- State entries live only for the duration of the OAuth dance (PAR
-- → user authenticates → callback). 15-minute TTL is sufficient. The
-- callback explicitly deletes them; this index supports a future
-- janitor job.
CREATE INDEX atproto_oauth_states_created_at_idx
    ON atproto_oauth_states (created_at);

COMMIT;
```

**Step 3: Write `down.sql`**

```sql
BEGIN;
DROP TABLE IF EXISTS atproto_oauth_states;
DROP TABLE IF EXISTS atproto_sessions;
COMMIT;
```

**Step 4: Apply migration**

Apply the migration with the project's standard migration command
(same as Phase 1).

**Step 5: Verify schema**

```sql
\d atproto_sessions
-- Expected columns: sub (PK), session_data (jsonb), updated_at
\d atproto_oauth_states
-- Expected columns: state (PK), state_data (jsonb), created_at

-- Confirm primary keys
SELECT conname
FROM pg_constraint
WHERE conrelid IN ('atproto_sessions'::regclass,
                   'atproto_oauth_states'::regclass)
  AND contype = 'p';
-- Expected: two rows, one PK per table

\di atproto_oauth_states_created_at_idx
-- Expected: btree index on created_at
```

**Step 6: Commit**

```bash
cd /Users/nick/code/drerings
git add netlify/database/migrations/0013_atproto_session_state/
git commit -m "feat(db): migration 0013 - atproto session and state stores"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add atproto dependencies and remove obsolete auth deps

**Files:**
- Modify: `/Users/nick/code/drerings/package.json`

**Step 1: Add atproto deps**

```bash
cd /Users/nick/code/drerings
npm install @atproto/api@^0.19.0 @atproto/identity@^0.4.0 @atproto/oauth-client-node@^0.3.17
```

**Step 2: Optionally remove passkey deps**

Since passkey login is gone:

```bash
npm uninstall @simplewebauthn/browser @simplewebauthn/server
```

(Confirm via `grep -rn "@simplewebauthn" src/ netlify/` that no
production code still imports them. Tests reference passkey helpers,
but those tests are deleted in Phase 8.)

**Step 3: Confirm install is clean**

```bash
npm install
npx tsc --noEmit
```

Expected: types resolve; existing build still works.

**Step 4: Commit**

```bash
cd /Users/nick/code/drerings
git add package.json package-lock.json
git commit -m "deps: add @atproto/api, @atproto/identity, @atproto/oauth-client-node"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Build the SessionStore and StateStore backed by Postgres

**Files:**
- Create: `/Users/nick/code/drerings/netlify/lib/auth/atproto-stores.ts`

**Step 1: Implement both stores**

```ts
import { getDatabase } from '@netlify/database'
import type {
    NodeSavedSession,
    NodeSavedState,
    NodeSavedSessionStore,
    NodeSavedStateStore
} from '@atproto/oauth-client-node'

export const sessionStore:NodeSavedSessionStore = {
    async get (sub:string):Promise<NodeSavedSession|undefined> {
        const db = getDatabase()
        const result = await db.pool.query<{
            session_data:NodeSavedSession;
        }>(
            'SELECT session_data FROM atproto_sessions WHERE sub = $1',
            [sub]
        )

        return result.rows[0]?.session_data
    },

    async set (sub:string, session:NodeSavedSession):Promise<void> {
        const db = getDatabase()
        await db.pool.query(`
            INSERT INTO atproto_sessions (sub, session_data, updated_at)
            VALUES ($1, $2, now())
            ON CONFLICT (sub) DO UPDATE
                SET session_data = EXCLUDED.session_data,
                    updated_at = EXCLUDED.updated_at
        `, [sub, JSON.stringify(session)])
    },

    async del (sub:string):Promise<void> {
        const db = getDatabase()
        await db.pool.query(
            'DELETE FROM atproto_sessions WHERE sub = $1',
            [sub]
        )
    }
}

export const stateStore:NodeSavedStateStore = {
    async get (key:string):Promise<NodeSavedState|undefined> {
        const db = getDatabase()
        const result = await db.pool.query<{
            state_data:NodeSavedState;
        }>(
            'SELECT state_data FROM atproto_oauth_states '
            + 'WHERE state = $1',
            [key]
        )

        return result.rows[0]?.state_data
    },

    async set (key:string, state:NodeSavedState):Promise<void> {
        const db = getDatabase()
        await db.pool.query(`
            INSERT INTO atproto_oauth_states (state, state_data)
            VALUES ($1, $2)
            ON CONFLICT (state) DO UPDATE
                SET state_data = EXCLUDED.state_data
        `, [key, JSON.stringify(state)])
    },

    async del (key:string):Promise<void> {
        const db = getDatabase()
        await db.pool.query(
            'DELETE FROM atproto_oauth_states WHERE state = $1',
            [key]
        )
    }
}
```

**Step 2: Build check**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

If the library's exported type names differ from `NodeSavedSession`,
`NodeSavedState`, etc., consult `node_modules/@atproto/oauth-client-node`
for the actual exports and adjust. The shape (`get`, `set`, `del`) is
the contract.

**Step 3: Commit**

```bash
cd /Users/nick/code/drerings
git add netlify/lib/auth/atproto-stores.ts
git commit -m "feat(auth): postgres-backed SessionStore/StateStore"
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Build the OAuth client wrapper

**Files:**
- Create: `/Users/nick/code/drerings/netlify/lib/auth/atproto.ts`

**Step 1: Implement the client factory**

```ts
import { NodeOAuthClient } from '@atproto/oauth-client-node'
import { sessionStore, stateStore } from './atproto-stores.js'

const DEFAULT_LOCAL_ORIGIN = 'http://127.0.0.1:9999'

function getOrigin ():string {
    const env = process.env.PUBLIC_URL
    if (env) return env.replace(/\/$/, '')

    return DEFAULT_LOCAL_ORIGIN
}

function getClientId (origin:string):string {
    const isLocal = origin.startsWith('http://127.0.0.1') ||
        origin.startsWith('http://localhost')

    if (isLocal) {
        const redirect = encodeURIComponent(
            `${origin}/api/auth/callback`
        )
        const scope = encodeURIComponent('atproto transition:generic')

        return `http://localhost?redirect_uri=${redirect}`
            + `&scope=${scope}`
    }

    return `${origin}/.well-known/oauth-client-metadata.json`
}

export function getClientMetadata ():object {
    const origin = getOrigin()
    const clientId = getClientId(origin)

    return {
        client_id: clientId,
        client_name: 'drerings',
        client_uri: origin,
        redirect_uris: [`${origin}/api/auth/callback`],
        scope: 'atproto transition:generic',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        application_type: 'web',
        dpop_bound_access_tokens: true,
        token_endpoint_auth_method: 'none'
    }
}

let cached:NodeOAuthClient|null = null

export function getOAuthClient ():NodeOAuthClient {
    if (cached) return cached

    cached = new NodeOAuthClient({
        clientMetadata: getClientMetadata() as never,
        sessionStore,
        stateStore
    })

    return cached
}
```

**Step 2: Build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

Expected: zero errors. If the `clientMetadata` parameter wants a more
specific type than `object`, swap the cast for the library's
imported type.

**Step 3: Commit**

```bash
cd /Users/nick/code/drerings
git add netlify/lib/auth/atproto.ts
git commit -m "feat(auth): NodeOAuthClient factory with cached singleton"
```
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Replace `SessionUser` and `session.ts`

**Files:**
- Modify: `/Users/nick/code/drerings/netlify/lib/auth-store.ts`
- Modify: `/Users/nick/code/drerings/netlify/lib/session.ts`

**Step 1: Rewrite `auth-store.ts`'s `SessionUser`**

Delete the email/passkey/magic-link helpers (`createMagicLinkLogin`,
`consumeMagicLinkToken`, anything that reads `magic_link_tokens` or
`passkeys`). Add a new helper for the OAuth-callback flow.

The file should keep `creditStampLot` integration (for signup
grants) and add an `upsertOAuthUser` function:

```ts
import { getDatabase } from '@netlify/database'
import { creditStampLot } from './stamps.js'

export interface SessionUser {
    id:string;
    did:string;
    handle:string;
    stamps_balance?:number;
    autumn_customer_id?:string|null;
}

const SIGNUP_GRANT_STAMPS = 5

export async function upsertOAuthUser (
    did:string,
    handle:string
):Promise<{ user:SessionUser; wasInserted:boolean }> {
    const db = getDatabase()
    const result = await db.pool.query<{
        id:string;
        did:string;
        handle:string;
        stamps_balance:number;
        autumn_customer_id:string|null;
        was_inserted:boolean;
    }>(`
        INSERT INTO users (did, handle, handle_updated_at,
                           stamps_balance)
        VALUES ($1, $2, now(), 0)
        ON CONFLICT (did) DO UPDATE
            SET handle = EXCLUDED.handle,
                handle_updated_at = now()
        RETURNING id, did, handle, stamps_balance,
                  autumn_customer_id,
                  (xmax = 0) AS was_inserted
    `, [did, handle])

    const row = result.rows[0]
    const wasInserted = row.was_inserted

    if (wasInserted) {
        // Signup grant
        await creditStampLot({
            userId: row.id,
            source: 'grant',
            count: SIGNUP_GRANT_STAMPS,
            priceCents: 0
        })

        // Refresh balance after the grant
        const after = await db.pool.query<{ stamps_balance:number }>(
            'SELECT stamps_balance FROM users WHERE id = $1',
            [row.id]
        )

        return {
            user: {
                id: row.id,
                did: row.did,
                handle: row.handle,
                stamps_balance: after.rows[0].stamps_balance,
                autumn_customer_id: row.autumn_customer_id
            },
            wasInserted: true
        }
    }

    return {
        user: {
            id: row.id,
            did: row.did,
            handle: row.handle,
            stamps_balance: row.stamps_balance,
            autumn_customer_id: row.autumn_customer_id
        },
        wasInserted: false
    }
}
```

Verify the `creditStampLot` signature matches by reading
`netlify/lib/stamps.ts`. Adjust the call site if needed.

**Step 2: Rewrite `session.ts`'s cookie payload**

In `netlify/lib/session.ts`:

- Rename `COOKIE_NAME` from `'drerings_session'` to `'drerings_auth'`
  (matches the design's name).
- Change the cookie payload to `{ id, did, handle, issued_at }`.
- Change the `getSession` SQL to `SELECT id, did, handle,
  stamps_balance, autumn_customer_id FROM users WHERE id = $1`.
- Change `isSessionUser` to validate `id`, `did`, `handle` (drop the
  email/subscription_status checks).

Increase `Max-Age` to 14 days per design (`60 * 60 * 24 * 14`).

**Step 3: Build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

Expected: errors point to call sites still reading `user.email` or
`user.subscription_status`. Fix each:
- `netlify/functions/postcards/send.ts` — uses `session.user.email`
  for the postcard "from" address. **Design call:** the postcard
  sender is now identified by `handle` instead. Replace `email` with
  a constructed value like `${handle}@bsky.social` or use the
  configured `RESEND_FROM_EMAIL` and put the handle in the display
  name. Whichever the design intends — confirm with a search through
  the codebase / README for "from email" handling and pick the option
  that does not break the existing Resend flow. If unsure, use the
  static `RESEND_FROM_EMAIL` env var and put `handle` in the email's
  "from name" field.
- `netlify/lib/billing.ts` — `customer_data.email` for Autumn. Same
  call: synthesize from handle or use a placeholder. Autumn does not
  enforce that the email be deliverable.
- `netlify/lib/account.ts` — `email: user.email` in
  `AccountDetails`. Replace with `did` and `handle` fields.

**Step 4: Commit**

```bash
cd /Users/nick/code/drerings
git add netlify/lib/auth-store.ts netlify/lib/session.ts \
    netlify/lib/account.ts netlify/lib/billing.ts \
    netlify/functions/postcards/send.ts
git commit -m "feat(auth): SessionUser carries did/handle, drerings_auth cookie"
```
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: OAuth metadata endpoint

**Files:**
- Create: `/Users/nick/code/drerings/netlify/functions/oauth-client-metadata.ts`

**Step 1: Implement**

```ts
import { json } from '../lib/http.js'
import { getClientMetadata } from '../lib/auth/atproto.js'

export const handler = async () => {
    return json(200, getClientMetadata())
}
```

(Confirm `json` helper signature in `netlify/lib/http.js`. If a
different helper is used, adapt.)

**Step 2: Configure routing**

The endpoint must be served at `/.well-known/oauth-client-metadata.json`.
Add a redirect in `netlify.toml`:

```toml
[[redirects]]
  from = "/.well-known/oauth-client-metadata.json"
  to = "/.netlify/functions/oauth-client-metadata"
  status = 200
```

(If `netlify.toml` already has a similar redirect for well-known
paths, integrate cleanly.)

**Step 3: Verify**

Start dev server, curl the endpoint. Expected: JSON with `client_id`,
`redirect_uris`, `scope: "atproto transition:generic"`, etc.

**Step 4: Commit**

```bash
cd /Users/nick/code/drerings
git add netlify/functions/oauth-client-metadata.ts netlify.toml
git commit -m "feat(auth): oauth-client-metadata endpoint"
```
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Login endpoint

**Files:**
- Create: `/Users/nick/code/drerings/netlify/functions/auth/login.ts`

**Step 1: Implement**

```ts
import type { HandlerEvent } from '@netlify/functions'
import { getOAuthClient } from '../../lib/auth/atproto.js'
import { json } from '../../lib/http.js'

export const handler = async (event:HandlerEvent) => {
    if (event.httpMethod !== 'GET') {
        return json(405, { error: 'method_not_allowed' })
    }

    const handle = event.queryStringParameters?.handle?.trim()

    if (!handle) {
        return json(400, { error: 'handle_required' })
    }

    const client = getOAuthClient()
    const authorizeUrl = await client.authorize(handle, {
        scope: 'atproto transition:generic'
    })

    return {
        statusCode: 302,
        headers: { Location: authorizeUrl.toString() },
        body: ''
    }
}
```

`client.authorize` writes a state row via the StateStore. The browser
follows the 302 to the user's PDS authorization server.

**Step 2: Verify dev locally**

Start dev server, navigate browser to
`http://127.0.0.1:9999/api/auth/login?handle=YOURHANDLE.bsky.social`.
Expected: 302 redirect to the Bluesky authorization page. Approve
there; you should land on `/api/auth/callback?...` (which doesn't
work yet — that's Task 8).

**Step 3: Commit**

```bash
cd /Users/nick/code/drerings
git add netlify/functions/auth/login.ts
git commit -m "feat(auth): /api/auth/login redirects to PDS authorize"
```
<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: Callback endpoint

**Verifies:** share-quota.AC1.1, share-quota.AC1.2, share-quota.AC1.4

**Files:**
- Create: `/Users/nick/code/drerings/netlify/functions/auth/callback.ts`

**Step 1: Implement**

```ts
import type { HandlerEvent } from '@netlify/functions'
import { getOAuthClient } from '../../lib/auth/atproto.js'
import { upsertOAuthUser } from '../../lib/auth-store.js'
import { createSessionCookie } from '../../lib/session.js'
import { json } from '../../lib/http.js'

export const handler = async (event:HandlerEvent) => {
    if (event.httpMethod !== 'GET') {
        return json(405, { error: 'method_not_allowed' })
    }

    const queryString = new URLSearchParams(
        event.queryStringParameters as Record<string, string>
    )

    if (!queryString.get('state') || !queryString.get('code')) {
        return json(400, { error: 'invalid_callback' })
    }

    const client = getOAuthClient()

    let oauthSession
    try {
        const result = await client.callback(queryString)
        oauthSession = result.session
    } catch (err) {
        return json(400, {
            error: 'oauth_callback_failed',
            message: err instanceof Error ? err.message : 'unknown'
        })
    }

    // sub is the user's DID (permanent identifier).
    const did = oauthSession.sub

    // Read the current handle from the authed agent. The library
    // attaches a DPoP-bound Agent to the OAuthSession; the
    // com.atproto.server.getSession call returns the handle the
    // PDS currently associates with the DID.
    let handle = did
    try {
        const accountInfo = await oauthSession.agent
            .com.atproto.server.getSession()
        handle = accountInfo.data.handle ?? did
    } catch {
        // Handle the rare case where the agent call fails after a
        // successful token exchange. Fall back to DID-as-handle;
        // upsertOAuthUser still upserts by DID, and the next
        // login refreshes handle_updated_at.
    }

    // upsertOAuthUser performs INSERT ... ON CONFLICT (did) DO
    // UPDATE SET handle = EXCLUDED.handle, handle_updated_at = now()
    // — so a returning user with a renamed handle gets the new
    // value here. This is the path AC1.2 exercises.
    const { user } = await upsertOAuthUser(did, handle)

    return {
        statusCode: 302,
        headers: {
            Location: '/',
            'Set-Cookie': createSessionCookie(user)
        },
        body: ''
    }
}
```

The exact agent API path (`com.atproto.server.getSession` vs other)
should be verified against `@atproto/api` v0.19.x. If the path is
different in the installed version, adapt — the goal is `(did, handle)`
to feed `upsertOAuthUser`.

**Step 2: Lint and build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
npm run lint
```

**Step 3: End-to-end test (manual)**

1. Start dev server.
2. Navigate to `/api/auth/login?handle=YOURHANDLE.bsky.social`.
3. Approve at Bluesky.
4. Confirm: redirect to `/` with `drerings_auth` cookie set.
5. Curl `/api/whoami` (built in Task 11): expect 200 with
   `{ id, did, handle, stamps_balance }`.
6. Confirm `users` row: `psql … -c "SELECT id, did, handle FROM users
   WHERE did = '<your-did>'"` returns one row.

**Step 4: Commit**

```bash
cd /Users/nick/code/drerings
git add netlify/functions/auth/callback.ts
git commit -m "feat(auth): /api/auth/callback completes OAuth and sets cookie"
```
<!-- END_TASK_8 -->

<!-- START_TASK_9 -->
### Task 9: Logout endpoint

**Verifies:** share-quota.AC1.3

**Files:**
- Modify: `/Users/nick/code/drerings/netlify/functions/auth/logout.ts`
  (it exists; rewrite it)

**Step 1: Implement**

```ts
import type { HandlerEvent } from '@netlify/functions'
import {
    clearSessionCookie,
    readSessionUserFromCookie
} from '../../lib/session.js'
import { getOAuthClient } from '../../lib/auth/atproto.js'
import { json } from '../../lib/http.js'

export const handler = async (event:HandlerEvent) => {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'method_not_allowed' })
    }

    const user = readSessionUserFromCookie(event)

    if (user) {
        // Best-effort revoke at the PDS; do not fail the local logout
        // if this fails.
        try {
            await getOAuthClient().revoke(user.did)
        } catch {
            // ignore
        }
    }

    return {
        statusCode: 200,
        headers: { 'Set-Cookie': clearSessionCookie() },
        body: JSON.stringify({ ok: true })
    }
}
```

**Step 2: Verify**

Authed user calls `POST /api/auth/logout`. Cookie cleared. Subsequent
`/api/whoami` returns 401.

**Step 3: Commit**

```bash
cd /Users/nick/code/drerings
git add netlify/functions/auth/logout.ts
git commit -m "feat(auth): logout clears cookie and revokes at PDS"
```
<!-- END_TASK_9 -->

<!-- START_TASK_10 -->
### Task 10: Login UI

**Files:**
- Modify: `/Users/nick/code/drerings/src/routes/login.ts`

**Step 1: Replace email/passkey form with Bluesky handle form**

The new UI is a single text input for the handle and a "Sign in with
Bluesky" submit button. On submit, navigate to
`/api/auth/login?handle=…`.

```ts
import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useCallback } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { Button } from '../components/button'
import { Input } from '../components/input'
import { type AppState } from '../state'
import './login.css'

export const LoginRoute:FunctionComponent<{
    state:AppState;
}> = function LoginRoute ({ state: _state }) {
    const handle = useSignal<string>('')

    const onSubmit = useCallback((ev:Event) => {
        ev.preventDefault()
        const value = handle.value.trim().replace(/^@/, '')
        if (!value) return
        const url = `/api/auth/login?handle=${encodeURIComponent(value)}`
        location.assign(url)
    }, [])

    return html`<div class="route login">
        <section>
            <h2>Sign in</h2>
            <p>Sign in with your Bluesky account.</p>
            <form onSubmit=${onSubmit}>
                <${Input}
                    label="Bluesky handle"
                    name="handle"
                    required=${true}
                    value=${handle.value}
                    placeholder="alice.bsky.social"
                    onInput=${(ev:InputEvent) => {
                        const input = ev.currentTarget as HTMLInputElement
                        handle.value = input.value
                    }}
                />
                <${Button} type="submit">
                    Sign in with Bluesky
                <//>
            </form>
        </section>
    </div>`
}
```

Remove the magic-link/passkey UI entirely. Tests that exercise them
will fail — Phase 8 deletes them.

**Step 2: Build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

**Step 3: Commit**

```bash
cd /Users/nick/code/drerings
git add src/routes/login.ts
git commit -m "feat(login): single Bluesky handle entry form"
```
<!-- END_TASK_10 -->

<!-- START_TASK_11 -->
### Task 11: `whoami` endpoint reads new SessionUser shape

**Files:**
- Modify (or create if absent): `/Users/nick/code/drerings/netlify/functions/whoami.ts`

**Step 1: Find current whoami**

```bash
cd /Users/nick/code/drerings
grep -rln "whoami" netlify/functions/ 2>/dev/null
```

The function likely exists already. Read it and update the response
shape to return `{ id, did, handle, stamps_balance }` instead of
`{ id, email, subscription_status, stamps_balance }`.

**Step 2: Update response**

```ts
import type { HandlerEvent } from '@netlify/functions'
import { getSession } from '../lib/session.js'
import { json } from '../lib/http.js'

export const handler = async (event:HandlerEvent) => {
    const session = await getSession(event)
    if (!session) return json(401, { error: 'Please sign in.' })
    return json(200, {
        id: session.user.id,
        did: session.user.did,
        handle: session.user.handle,
        stamps_balance: session.user.stamps_balance ?? 0
    })
}
```

**Step 3: Verify**

After Task 8's manual login, curl
`/api/whoami` with the `drerings_auth` cookie. Expect 200 with the
DID-keyed payload.

**Step 4: Commit**

```bash
cd /Users/nick/code/drerings
git add netlify/functions/whoami.ts
git commit -m "feat(whoami): return did/handle/stamps_balance"
```
<!-- END_TASK_11 -->

<!-- START_TASK_12 -->
### Task 12: Update client-side State to consume the new shape

**Files:**
- Modify: `/Users/nick/code/drerings/src/state.ts`

**Step 1: Update `UserState`/`CurrentUser` interfaces**

In `src/state.ts`:

- `UserState` interface (line 21): change `email:string` → `did:string;
  handle:string`.
- Any place in `State.LoadCurrentUser` that reads `whoami` should
  destructure `id`, `did`, `handle`, `stamps_balance`.

**Step 2: Build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

Expected: many TypeScript errors as references to `currentUser.email`
surface. Fix each:
- In UI components, replace `email` with `handle` (the display
  identifier).
- Anywhere the email was used as a database key, that semantics is
  gone (DID is the key).

**Step 3: Commit**

```bash
cd /Users/nick/code/drerings
git add -A src/
git commit -m "refactor(state): UserState carries did and handle"
```
<!-- END_TASK_12 -->

<!-- START_TASK_12B -->
### Task 12B: Automated tests for `/api/auth/callback` failure paths

**Verifies:** share-quota.AC1.4 (callback called with missing or
mismatched `state` returns 400 and writes no `users` row)

**Files:**
- Create: `/Users/nick/code/drerings/test/us020-auth-callback.test.ts`

**Step 1: Mock the OAuth client and the user upsert**

The callback handler imports `getOAuthClient` from `../../lib/auth/atproto.js`
and `upsertOAuthUser` from `../../lib/auth-store.js`. Mock both with
`vi.doMock`. The mocked client's `callback` method either resolves
with a fake `OAuthSession` (success path) or rejects with an error
(failure path). The mocked `upsertOAuthUser` is a spy that we assert
on.

```ts
import { describe, expect, it, vi } from 'vitest'

describe('GET /api/auth/callback', () => {
    it('returns 400 when state is missing from query', async () => {
        vi.resetModules()

        const upsertSpy = vi.fn()
        const callbackSpy = vi.fn()

        vi.doMock('../netlify/lib/auth-store.js', () => ({
            upsertOAuthUser: upsertSpy
        }))
        vi.doMock('../netlify/lib/auth/atproto.js', () => ({
            getOAuthClient: () => ({
                callback: callbackSpy
            })
        }))

        const { handler } = await import(
            '../netlify/functions/auth/callback'
        )
        const response = await handler({
            httpMethod: 'GET',
            queryStringParameters: { code: 'authcode-1' }, // no state
            headers: {}
        } as never, {} as never)

        expect(response.statusCode).toBe(400)
        expect(upsertSpy).not.toHaveBeenCalled()
        expect(callbackSpy).not.toHaveBeenCalled()
    })

    it('returns 400 when code is missing from query', async () => {
        vi.resetModules()

        const upsertSpy = vi.fn()
        const callbackSpy = vi.fn()

        vi.doMock('../netlify/lib/auth-store.js', () => ({
            upsertOAuthUser: upsertSpy
        }))
        vi.doMock('../netlify/lib/auth/atproto.js', () => ({
            getOAuthClient: () => ({
                callback: callbackSpy
            })
        }))

        const { handler } = await import(
            '../netlify/functions/auth/callback'
        )
        const response = await handler({
            httpMethod: 'GET',
            queryStringParameters: { state: 'state-1' }, // no code
            headers: {}
        } as never, {} as never)

        expect(response.statusCode).toBe(400)
        expect(upsertSpy).not.toHaveBeenCalled()
    })

    it('returns 400 when client.callback rejects (mismatched state)',
        async () => {
            vi.resetModules()

            const upsertSpy = vi.fn()
            const callbackSpy = vi.fn(async () => {
                throw new Error('invalid_state')
            })

            vi.doMock('../netlify/lib/auth-store.js', () => ({
                upsertOAuthUser: upsertSpy
            }))
            vi.doMock('../netlify/lib/auth/atproto.js', () => ({
                getOAuthClient: () => ({
                    callback: callbackSpy
                })
            }))

            const { handler } = await import(
                '../netlify/functions/auth/callback'
            )
            const response = await handler({
                httpMethod: 'GET',
                queryStringParameters: {
                    state: 'wrong-state',
                    code: 'authcode-1'
                },
                headers: {}
            } as never, {} as never)

            expect(response.statusCode).toBe(400)
            expect(upsertSpy).not.toHaveBeenCalled()
        })

    it('refreshes handle on re-login for existing DID (AC1.2)',
        async () => {
            // AC1.2: a returning user with an existing users.did row
            // logs in again; their handle and handle_updated_at are
            // refreshed (no duplicate row).
            vi.resetModules()

            const upsertSpy = vi.fn(async (
                did:string,
                handle:string
            ) => ({
                user: { id: 'user-1', did, handle, stamps_balance: 0 },
                wasInserted: false  // <-- existing user, not inserted
            }))

            const callbackSpy = vi.fn(async () => ({
                session: {
                    sub: 'did:plc:alice',
                    agent: {
                        com: { atproto: { server: {
                            getSession: async () => ({
                                data: { handle: 'alice-new.bsky.social' }
                            })
                        } } }
                    }
                }
            }))

            vi.doMock('../netlify/lib/auth-store.js', () => ({
                upsertOAuthUser: upsertSpy
            }))
            vi.doMock('../netlify/lib/auth/atproto.js', () => ({
                getOAuthClient: () => ({ callback: callbackSpy })
            }))

            const { handler } = await import(
                '../netlify/functions/auth/callback'
            )
            const response = await handler({
                httpMethod: 'GET',
                queryStringParameters: {
                    state: 'state-1',
                    code: 'authcode-1'
                },
                headers: {}
            } as never, {} as never)

            expect(response.statusCode).toBe(302)
            // The handler calls upsert with the freshly-fetched handle
            expect(upsertSpy).toHaveBeenCalledWith(
                'did:plc:alice',
                'alice-new.bsky.social'
            )
            // upsertOAuthUser performs the SQL upsert that does
            // ON CONFLICT (did) DO UPDATE — see netlify/lib/auth-store.ts.
            // The mock returns wasInserted=false, confirming the
            // returning-user path is exercised.
        })

    it('upserts the user with did/handle on success', async () => {
        vi.resetModules()

        const upsertSpy = vi.fn(async () => ({
            user: {
                id: 'user-1',
                did: 'did:plc:test',
                handle: 'alice.bsky.social',
                stamps_balance: 5
            },
            wasInserted: true
        }))

        const callbackSpy = vi.fn(async () => ({
            session: {
                sub: 'did:plc:test',
                agent: {
                    com: {
                        atproto: {
                            server: {
                                getSession: async () => ({
                                    data: { handle: 'alice.bsky.social' }
                                })
                            }
                        }
                    }
                }
            }
        }))

        vi.doMock('../netlify/lib/auth-store.js', () => ({
            upsertOAuthUser: upsertSpy
        }))
        vi.doMock('../netlify/lib/auth/atproto.js', () => ({
            getOAuthClient: () => ({ callback: callbackSpy })
        }))

        const { handler } = await import(
            '../netlify/functions/auth/callback'
        )
        const response = await handler({
            httpMethod: 'GET',
            queryStringParameters: {
                state: 'state-1',
                code: 'authcode-1'
            },
            headers: {}
        } as never, {} as never)

        expect(response.statusCode).toBe(302)
        expect(upsertSpy).toHaveBeenCalledWith(
            'did:plc:test',
            'alice.bsky.social'
        )
    })
})
```

(Adapt the mock paths to the project's actual module specifiers
— `vi.doMock` is path-sensitive. Check how `test/us003-debit-stamp.test.ts`
mocks `@netlify/database`; mirror its style.)

**Step 2: Run**

```bash
cd /Users/nick/code/drerings
npx vitest run test/us020-auth-callback.test.ts
```

Expected: all four tests pass.

**Step 3: Commit**

```bash
cd /Users/nick/code/drerings
git add test/us020-auth-callback.test.ts
git commit -m "test(auth-callback): cover AC1.4 failure paths"
```
<!-- END_TASK_12B -->

<!-- START_TASK_13 -->
### Task 13: Invert `test/us001-no-atproto.test.ts`

**Files:**
- Modify: `/Users/nick/code/drerings/test/us001-no-atproto.test.ts`

**Step 1: Read the current assertion**

The test currently asserts that NO atproto packages are present.
Invert: assert that `@atproto/api`, `@atproto/identity`, and
`@atproto/oauth-client-node` ARE in `package.json` dependencies.

Replace the file's body with the inversion:

```ts
import { test } from '@substrate-system/tapzero'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('atproto dependencies are present in package.json', async t => {
    const pkgRaw = readFileSync(
        join(process.cwd(), 'package.json'),
        'utf8'
    )
    const pkg = JSON.parse(pkgRaw) as {
        dependencies?:Record<string, string>;
    }

    const deps = pkg.dependencies ?? {}

    t.ok(deps['@atproto/api'], '@atproto/api is a dependency')
    t.ok(deps['@atproto/identity'], '@atproto/identity is a dependency')
    t.ok(
        deps['@atproto/oauth-client-node'],
        '@atproto/oauth-client-node is a dependency'
    )
})
```

(Confirm the test imports follow the file's existing pattern — look
at the original assertion style and match.)

Rename the file to reflect the new assertion direction:

```bash
git mv test/us001-no-atproto.test.ts test/us001-atproto-deps.test.ts
```

Update `test/index.ts` if it imports the file by name.

**Step 2: Run the test**

```bash
cd /Users/nick/code/drerings
npm test
```

Expected: the inverted test passes. Many other tests still fail
(addressed in Phase 8).

**Step 3: Commit**

```bash
cd /Users/nick/code/drerings
git add test/
git commit -m "test: invert us001 to assert atproto deps present"
```
<!-- END_TASK_13 -->

---

## Done When

- `@atproto/api`, `@atproto/identity`, and `@atproto/oauth-client-node`
  are in `package.json`.
- `/api/auth/login?handle=…` redirects to the user's PDS authorize
  page (manual test).
- `/api/auth/callback?...` upserts a `users` row by DID and sets the
  `drerings_auth` cookie (manual test).
- `/api/whoami` returns `{ id, did, handle, stamps_balance }` after
  login (manual test).
- `/api/auth/logout` clears the cookie (manual test).
- Migration 0013 applies cleanly; `atproto_sessions` and
  `atproto_oauth_states` tables exist.
- `npx tsc --noEmit` exits 0.
- The inverted `us001-atproto-deps.test.ts` test passes.

(The full test suite is expected to have failures from passkey /
magic-link / email-shape tests; Phase 8 cleans those.)
