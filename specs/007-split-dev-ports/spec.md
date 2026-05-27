# Feature Specification: Split Dev Server Ports (App on 8888, Functions on 9999)

**Feature Branch**: `007-split-dev-ports`
**Created**: 2026-05-26
**Status**: Draft
**Input**: User description: "Need to make to oauth redirect me to the correct URL. It redirects to port 8888. I would rather use port 8888 for app, and port 9999 for functions. Please setup the dev in that way. Use `vite` command as dev server. Setup like this repo: https://github.com/mycelial-systems/template-netlify-app"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Developer completes atproto OAuth sign-in in local dev (Priority: P1)

A developer runs the project locally, clicks "Sign in", chooses a handle, and is redirected to their PDS, authorizes the app, and is sent back to the local app where they land authenticated on a real page (not a blank screen). After landing, calls to `/api/whoami` return the authenticated session.

**Why this priority**: OAuth login is the only authentication path in the app. If it does not complete in local dev, no other feature (sharing, postcards, billing, stamps) can be exercised by hand. Today the callback URL renders a blank page, which blocks every downstream dev workflow.

**Independent Test**: Start the dev environment, navigate to `/login`, enter a real Bluesky handle, complete the consent step on the PDS, and verify the browser lands on an authenticated route (not blank) and `/api/whoami` returns the user's `did`, `handle`, and `stamps_balance`.

**Acceptance Scenarios**:

1. **Given** the dev environment is running, **When** the developer initiates OAuth login with a valid handle and approves consent on their PDS, **Then** the browser is redirected back to the local app on the SPA origin and renders the post-login route with an active session cookie.
2. **Given** the OAuth client metadata document is fetched by the PDS, **When** the PDS resolves the registered redirect URI, **Then** that URI points at the SPA origin used in the browser address bar (i.e. the same scheme, host, and port the developer is viewing the app on) so the cookie set during callback is readable by the SPA on its next request.
3. **Given** OAuth callback succeeds, **When** the SPA loads, **Then** the session cookie set on the SPA origin is sent on the next `/api/whoami` request and the response is `200` with user fields populated.

---

### User Story 2 - Developer starts the whole dev stack with one command (Priority: P2)

A developer runs a single `npm start` (or equivalent documented command) and gets a SPA dev server on port 8888 and a serverless functions process on port 9999, both ready to serve requests, without having to launch two terminals manually or remember any extra flags.

**Why this priority**: The team's workflow assumes a single command brings the dev stack up. A two-terminal setup is a continuous source of "I forgot to start the other one" bugs that surface as confusing 404s. This is high value but secondary to OAuth actually working.

**Independent Test**: From a fresh checkout with dependencies installed, run the documented start command and verify (a) the app is reachable at `http://localhost:8888/`, (b) `http://localhost:9999/` (or its function path) responds, and (c) requests the SPA makes to `/api/*` succeed without manual configuration.

**Acceptance Scenarios**:

1. **Given** dependencies are installed, **When** the developer runs the documented start command, **Then** the SPA is reachable at port 8888 and the functions runtime is reachable at port 9999, both within 10 seconds of startup.
2. **Given** the dev stack is running, **When** the SPA in the browser issues a request to any `/api/*` path, **Then** the request reaches the functions process on port 9999 and returns the function's response (the SPA does not need to know about port 9999).
3. **Given** the developer edits a file under `src/`, **When** the file is saved, **Then** the SPA in the browser reflects the change without a manual reload and without restarting the functions process.

---

### User Story 3 - SPA routing and assets work as expected on the SPA port (Priority: P2)

A developer visiting an arbitrary in-app path directly (e.g. typing `http://localhost:8888/account` into the address bar or refreshing while on it) gets the SPA shell back and the client-side router handles the route — they do not get a 404, and Vite's own module URLs (e.g. `/src/index.ts` while loading the dev page) are not rewritten to `index.html`.

**Why this priority**: Without this, the dev experience for any non-root route is broken — refresh equals 404 — which makes iterating on auth-gated routes painful. It is independent of OAuth completing.

**Independent Test**: With the dev stack running, navigate to a deep route in the SPA, hit refresh, and verify the same route renders. Then view the page source / network panel and confirm Vite's HMR/module URLs are served as JS/TS, not as `index.html`.

**Acceptance Scenarios**:

1. **Given** the dev stack is running on port 8888, **When** the developer refreshes the browser on a non-root SPA route, **Then** the SPA shell loads and the client-side router renders the requested route.
2. **Given** the SPA loads in dev, **When** the browser requests source modules under the dev server's internal paths (e.g. `/src/*`, `/@vite/*`), **Then** those requests are served as the original module content and are not rewritten to `index.html`.

---

### User Story 4 - Production build and deploy are unaffected (Priority: P3)

A developer running the existing `npm run build` and deploying to Netlify gets the same artifact, the same redirect table, the same security headers, and the same OAuth client metadata in production as before this change.

**Why this priority**: The change targets local dev only. Touching production routing accidentally would be a regression with operator impact (auth breaks for real users). The work is small but worth calling out so it is explicitly verified.

**Independent Test**: Run `npm run build` and inspect the output directory; deploy to a preview environment and confirm OAuth, `/api/*` redirects, security headers, and the SPA fallback all behave as they did before this change.

**Acceptance Scenarios**:

1. **Given** the production build runs, **When** the build output is compared to the pre-change baseline, **Then** the published assets and the deployed `netlify.toml` redirect / header tables are functionally equivalent (same paths, same targets, same headers).
2. **Given** the app is deployed to a preview or production environment, **When** a user signs in via atproto OAuth, **Then** the callback URL matches the deployed origin and the session is established exactly as it does today.

---

### Edge Cases

- The developer's browser uses `127.0.0.1` while the OAuth client metadata advertises `localhost` (or vice versa). The redirect lands on a host the cookie was not set on. The spec MUST require that the dev origin advertised to the PDS and the origin the developer actually browses to are the same, by convention and by documented guidance.
- The functions process is not running but the SPA is. Any `/api/*` request from the browser MUST surface a clear, actionable error (e.g. a connection-refused style failure visible in devtools), not a silent blank page.
- A developer runs both `vite` and a separately started `netlify dev` at the same time. The documented start command MUST own the port assignments (8888, 9999) and refuse to start, or fail loudly, on port conflict — it MUST NOT silently fall back to a different port that the OAuth metadata does not know about.
- A second project on the same machine already binds 8888 or 9999. The start script SHOULD fail with a clear message; the developer SHOULD be able to override the ports via a documented mechanism without code changes.
- The OAuth `client_id` and `redirect_uris` advertised in dev must reflect the SPA's actual dev origin (port 8888 over the configured scheme). If the dev origin changes, the metadata MUST follow.
- The CSP, CORS posture, and cookie-host assumptions that the production app relies on (same-origin, `HttpOnly; Secure; SameSite=Lax`) MUST remain true under the new dev setup — the browser MUST observe the SPA and the API as same-origin during dev.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The local development environment MUST serve the SPA on port `8888`.
- **FR-002**: The local development environment MUST serve serverless functions on port `9999`.
- **FR-003**: Requests issued by the SPA in the browser to any `/api/*` path MUST resolve to the functions process on port `9999` without the SPA code having any knowledge of that port (i.e. the browser sees only the SPA origin).
- **FR-004**: The atproto OAuth client metadata served from `/.well-known/oauth-client-metadata.json` in local dev MUST advertise a `redirect_uri` whose origin matches the SPA dev origin (port `8888`), so the PDS redirects the browser back to the same origin it came from.
- **FR-005**: The OAuth callback handler MUST set the session cookie on the SPA dev origin so that the next SPA request includes it.
- **FR-006**: A single documented command MUST start both the SPA dev server and the functions process. Restarting one MUST NOT require restarting the other (file edits in `src/` MUST NOT require restarting functions, and vice versa).
- **FR-007**: SPA history routing MUST work in dev: refreshing on any client-side route returns the SPA shell, not a 404.
- **FR-008**: Internal dev-server module URLs (e.g. `/src/*`, `/@vite/*`, HMR endpoints) MUST NOT be intercepted by the SPA history-fallback rule.
- **FR-009**: The production build (`npm run build`) and the deployed runtime behavior MUST remain unchanged by this work — same artifacts, same redirect table, same headers, same OAuth metadata semantics on the production origin.
- **FR-010**: When the SPA's dev origin is not reachable, the dev start command MUST fail with a clear message (e.g. port already in use) rather than starting on a different port that breaks OAuth.
- **FR-011**: Documentation in `README.md` and `CLAUDE.md` MUST be updated so the next contributor finds the new port layout, the new start command, and the rationale (OAuth callback origin alignment) without reading the diff.
- **FR-012**: Existing security posture MUST be preserved under the new layout: the SPA and the API MUST appear to the browser as same-origin in dev, no CORS allowance is added, and cookie flags are not relaxed.

### Key Entities

- **Dev SPA Origin**: The origin the developer types into their browser — scheme + host + port `8888`. This is the value the OAuth client metadata advertises in dev, the value cookies are scoped to, and the value the PDS redirects back to.
- **Dev Functions Port**: The internal port (`9999`) on which serverless function code runs in dev. Not user-visible: the browser never addresses it directly.
- **OAuth Client Metadata Document**: The JSON document advertised at `/.well-known/oauth-client-metadata.json` whose `redirect_uris` MUST agree with the Dev SPA Origin in dev and the production origin in production.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer with a working Bluesky handle can complete atproto OAuth sign-in end-to-end in local dev in under 60 seconds from clicking "Sign in" to seeing an authenticated route — with zero blank-page outcomes across 10 consecutive attempts.
- **SC-002**: From a fresh checkout, running the documented start command brings up both the SPA and the functions process such that the SPA at port 8888 successfully proxies `/api/whoami` (returning `401` while signed-out, `200` while signed-in) within 10 seconds of the start command.
- **SC-003**: Refreshing the browser on any client-side SPA route in dev returns the SPA shell (not a 404) for 100% of the app's routes.
- **SC-004**: Hot module reload latency for an edit to a file under `src/` is under 1 second from save to visible change in the browser, with no restart of the functions process required.
- **SC-005**: The production build output and the deployed redirect/header table are byte-equivalent (or semantically equivalent — same paths, same targets, same header values) to the pre-change baseline.
- **SC-006**: Zero new CORS allowances and zero relaxations of cookie flags are introduced; the browser observes the SPA and the API as same-origin in dev across all `/api/*` calls.

## Assumptions

- The OAuth client metadata document served in dev today already varies by environment (or can be made to vary), so updating it to match the new SPA dev origin is a configuration change, not a redesign.
- "Use vite as the dev server" means the developer-facing process invoked at start-up is vite (serving the SPA), with the functions process started alongside it. The intent is to remove `netlify dev` as the front door in local dev, not to remove the Netlify Functions runtime.
- Port `8888` and port `9999` are free on contributor machines by default; if a contributor's environment binds them, an override mechanism is acceptable as long as it is documented and keeps OAuth metadata and SPA origin in sync.
- The referenced template repo (`mycelial-systems/template-netlify-app`) is the canonical layout pattern to follow, but the specification does not constrain the implementation to any specific tool, plugin, or proxy library — only the observable behavior described above.
- This change is dev-only; production routing, headers, OAuth metadata, and the existing `netlify.toml` redirect table on deployed environments remain authoritative for production behavior.
