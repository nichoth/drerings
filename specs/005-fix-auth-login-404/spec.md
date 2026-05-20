# Feature Specification: Restore atproto Sign-In (Fix `/api/auth/login` 404)

**Feature Branch**: `005-fix-auth-login-404`
**Created**: 2026-05-20
**Status**: Draft
**Input**: User description: "Getting 404 on `/api/auth/login`"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - User can sign in with their Bluesky handle (Priority: P1)

A returning or new user lands on the app and chooses to sign in. They
enter their Bluesky handle (for example `jarving.bsky.social`) and are
redirected to their PDS to authorize the app. After authorizing, they
return to drerings signed in and can use authenticated features
(viewing their account, sending postcards, sharing drawings, buying
stamps, gifting stamps).

**Why this priority**: Sign-in is the gateway to every authenticated
feature in the product. While the login endpoint returns 404, the
product is effectively unusable for any user who is not already
signed in with a valid session cookie. Every other feature — sending
postcards, sharing drawings, viewing the account page, purchasing or
gifting stamps — is blocked behind this single broken endpoint. This
is a P0-grade outage in user value; it is listed as P1 because it is
the only user story in scope.

**Independent Test**: Open the app in a fresh browser (no
`drerings_auth` cookie). Click "Sign in" (or visit
`/api/auth/login?handle=<a valid Bluesky handle>` directly). The
browser must be redirected to the user's PDS authorize URL — not
shown a "Function not found" page or any other 404. After completing
PDS authorization, the user must be returned to the app signed in,
with a valid session cookie set, and able to load `/api/whoami`
returning their account.

**Acceptance Scenarios**:

1. **Given** a signed-out user with a valid Bluesky handle,
   **When** they initiate sign-in via the app's login flow,
   **Then** they are redirected to their PDS authorize URL (HTTP
   redirect, not a 404 page).
2. **Given** a signed-out user who has just authorized at their PDS,
   **When** the PDS redirects them back to the app's callback,
   **Then** a session is established and subsequent calls to
   `/api/whoami` return their account (id, did, handle,
   stamps_balance).
3. **Given** a request to the login endpoint with no `handle` query
   parameter, **When** the request is made, **Then** the user
   receives a clear "handle is required" error response (not a 404
   "Function not found" page).
4. **Given** a request to the login endpoint from a client that has
   already exceeded the per-IP rate limit, **When** the request is
   made, **Then** the user receives a rate-limit response with the
   appropriate retry headers (not a 404).
5. **Given** a signed-in user, **When** they sign out and then sign
   in again, **Then** the full round-trip succeeds without
   encountering any 404 on the auth endpoints (login, callback, or
   logout).

---

### Edge Cases

- A request to `/api/auth/login` with a handle that the user's PDS
  rejects (typo, suspended account) must surface a sensible error to
  the user rather than a 404 — the routing must reach the handler
  before any PDS interaction can fail or succeed.
- A request to `/api/auth/login` with an HTTP method other than `GET`
  must reach the handler and receive a 405 Method Not Allowed, not a
  404.
- A request to the PDS-required client metadata document at
  `/.well-known/oauth-client-metadata.json` must continue to be
  served correctly, with its cacheable response, because the user's
  PDS fetches it during the authorize flow.
- Auth-adjacent endpoints in the same family (`/api/auth/callback`,
  `/api/auth/logout`) must also be reachable; if a routing change
  fixes login, it must not silently leave callback or logout broken.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `/api/auth/login` endpoint MUST respond from the
  application's login handler (not return a generic "function not
  found" 404), so that the atproto OAuth authorize flow can begin.
- **FR-002**: The `/api/auth/callback` endpoint MUST be reachable so
  that the PDS can complete the authorization redirect back to the
  app and establish a session.
- **FR-003**: The `/api/auth/logout` endpoint MUST be reachable so
  that signed-in users can end their session and revoke the
  underlying atproto session.
- **FR-004**: The fix MUST work in the local development environment
  used to reproduce this bug (Netlify dev at `127.0.0.1:8888`) AND
  in the deployed staging and production environments.
- **FR-005**: Existing auth-endpoint behaviors MUST be preserved
  unchanged: per-IP rate limiting on login, handle validation,
  redirect to the PDS authorize URL with the configured scopes,
  session cookie issuance on callback, and atproto session
  revocation on logout.
- **FR-006**: The `/.well-known/oauth-client-metadata.json` document
  MUST continue to be served with its current cacheable response so
  the user's PDS can fetch it during the authorize flow.
- **FR-007**: The fix MUST NOT regress any other API endpoint that
  is currently reachable; in particular, endpoints already working
  before this change must remain working after it.
- **FR-008**: Once fixed, an end-to-end sign-in flow (login →
  authorize at PDS → callback → `/api/whoami` returning the user)
  MUST complete without any intermediate 404 response.

### Key Entities

- **Session**: The signed cookie (`drerings_auth`) that identifies a
  signed-in user. Issued by the callback endpoint after a successful
  PDS authorization. Carries `id`, `did`, `handle`, and an issue
  timestamp. Not produced at all while the login endpoint is
  unreachable, because the flow never reaches the callback.
- **atproto OAuth state**: The transient state stored during the
  authorize round-trip so the callback can verify it returned from
  the same login attempt. Never created while login is unreachable.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A signed-out user attempting to sign in with a valid
  Bluesky handle is redirected to their PDS authorize URL in 100%
  of requests; the "Function not found" 404 is observed 0% of the
  time.
- **SC-002**: A signed-out user can complete the full end-to-end
  sign-in flow (handle entry → PDS authorize → return to app →
  authenticated request succeeds) in a single sitting, with no
  intermediate error pages.
- **SC-003**: All three auth endpoints (login, callback, logout)
  return their handler-defined responses (200, 302, 400, 401, 405,
  or 429 as appropriate) and never the generic "function not found"
  404 in any tested scenario.
- **SC-004**: Existing automated tests covering authentication and
  routing pass without modification or with only additive changes
  that codify the fix (no test relaxation needed to ship).
- **SC-005**: Existing automated tests for unrelated API endpoints
  (postcards, shares, billing, stamps, account, drawings, whoami)
  continue to pass, confirming no routing regression elsewhere.

## Assumptions

- The deployed atproto OAuth client metadata, `SESSION_SECRET`, and
  PDS configuration are correct and unchanged by this fix; the bug
  is in request routing or function discovery, not in OAuth client
  configuration.
- The reproduction at `127.0.0.1:8888` is faithful: the same routing
  defect affecting local Netlify dev is the same defect affecting
  the deployed environments. If the deployed environment turns out
  to behave differently, the fix must still guarantee the local
  reproduction is resolved so the contributor workflow is unblocked.
- Other API endpoints that share the same nesting depth as
  `/api/auth/login` (notably `/api/billing/checkout`,
  `/api/postcards/send`, `/api/shares/confirm`,
  `/api/shares/precheck`, `/api/stamps/gifts/checkout`,
  `/api/stamps/gifts/refund`, `/api/stamps/refund`,
  `/api/stamps/transactions`, `/api/stamps/lots`,
  `/api/webhooks/resend`) may be vulnerable to the same defect. The
  fix MUST resolve the reported login 404 and SHOULD apply the same
  routing approach uniformly to prevent the bug from re-surfacing on
  any other nested endpoint.
- "Reachable" means the route reaches the application's handler.
  The handler may then choose to return any status code (302, 400,
  401, 405, 429, etc.) per its existing behavior. This spec does
  not require any specific handler behavior change — only that
  routing reach the handler.

## Out of Scope

- Any change to the atproto OAuth flow itself (scopes, PDS
  selection, session cookie payload, HMAC signing, session TTL).
- Any change to handle validation logic, rate-limit thresholds, or
  session-store schema.
- Any UI/UX redesign of the sign-in flow. The bug is a 404 on a
  working flow; the fix restores the flow as designed.
- Any change to other product features (postcards, shares,
  stamps, gifts, billing) beyond ensuring their endpoints remain
  reachable.
