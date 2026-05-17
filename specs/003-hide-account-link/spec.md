# Feature Specification: Auth-gated Account link in header

**Feature Branch**: `003-hide-account-link`
**Created**: 2026-05-16
**Status**: Draft
**Input**: User description: "There should not be an 'account' link in the header if the user is not logged in"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Hide Account link from logged-out visitors (Priority: P1)

A visitor who is not signed in arrives at the site. The top navigation
shows only the links that make sense for an anonymous visitor (Home,
Drawings, Pricing, About, Login). The Account link is not present,
because there is no account to view.

**Why this priority**: This is the entire feature. Without it, the
navigation advertises an account-only destination to people who have
no account, which is confusing and leads to dead-end clicks.

**Independent Test**: Open the site in a fresh browser (no session
cookie / no stored credentials). Inspect the header. The Account link
must not appear. Every other header link continues to behave as it
does today.

**Acceptance Scenarios**:

1. **Given** a visitor with no active session, **When** they load any
   page that renders the site header, **Then** the header does not
   include an "Account" link.
2. **Given** a visitor with no active session, **When** they
   programmatically inspect the rendered header markup, **Then** no
   element labeled or linking to Account is present (it is omitted,
   not merely hidden via styling).

---

### User Story 2 - Show Account link to signed-in users (Priority: P1)

A signed-in user navigates the site and expects quick access to their
account from the persistent header on every page.

**Why this priority**: The Account link must remain reachable for the
users who actually have an account; otherwise the change regresses
functionality for the existing audience.

**Independent Test**: Sign in as any account. Inspect the header on
multiple pages (home, drawings, settings, etc.). The Account link
appears in the same position it does today and navigates to the
existing account destination.

**Acceptance Scenarios**:

1. **Given** a user with an active session, **When** they load any
   page that renders the site header, **Then** the "Account" link is
   visible in the header.
2. **Given** a signed-in user, **When** they click the Account link,
   **Then** they are taken to the existing account page with no
   regression in behavior.

---

### User Story 3 - Link visibility updates when auth state changes (Priority: P2)

A user signs in or signs out during a session. The header reflects
their new auth state without requiring a manual page reload.

**Why this priority**: The header already updates other auth-dependent
affordances (e.g. the Login link, the Settings link) on state change.
The Account link should behave consistently so the navigation never
lies about what the user can do right now.

**Independent Test**: Start signed out, confirm Account is hidden.
Sign in within the same tab, confirm Account appears without manual
reload. Sign out, confirm Account disappears again.

**Acceptance Scenarios**:

1. **Given** a signed-out visitor viewing the header, **When** they
   complete sign-in in the same session, **Then** the Account link
   appears without a full page reload.
2. **Given** a signed-in user viewing the header, **When** they sign
   out, **Then** the Account link is removed from the header without
   a full page reload.

---

### Edge Cases

- While auth state is still being resolved on first paint (e.g. the
  app is checking for a stored session), the header treats the user
  as signed-out for the purpose of the Account link, so the link
  never flashes for unauthenticated visitors.
- If the user's session expires while the page is open, the next
  header render after the app notices the expiration omits the
  Account link.
- Direct navigation to the Account URL by a signed-out user is out
  of scope for this feature; this feature only governs the header
  link's visibility, not route-level access control.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The site header MUST render the "Account" link only
  when the current viewer has an active authenticated session.
- **FR-002**: When no authenticated session exists, the header MUST
  omit the "Account" link from the rendered markup, rather than
  hiding it visually while leaving it in the DOM/accessibility tree.
- **FR-003**: The header MUST react to changes in authentication
  state during a session so the Account link appears on sign-in and
  disappears on sign-out without requiring a manual page reload.
- **FR-004**: While authentication state is unresolved (initial load,
  in-flight session check), the header MUST default to the
  signed-out treatment so the Account link does not flash for
  unauthenticated viewers.
- **FR-005**: No other header link's visibility, order, or labeling
  MUST change as part of this feature.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of header renders for unauthenticated viewers
  exclude the Account link, verified by an automated check that
  loads the site without a session and asserts the link's absence.
- **SC-002**: 100% of header renders for authenticated users include
  the Account link in its existing position, verified by an
  automated check that loads the site with a valid session.
- **SC-003**: After a sign-in or sign-out action within a single
  session, the header reflects the new state within one render cycle
  (no manual reload required).
- **SC-004**: Dead-end clicks on Account by signed-out visitors drop
  to zero, because the link is no longer reachable from the header
  in that state.

## Assumptions

- The application already has a reliable signal for "is the current
  viewer signed in" that other header elements (such as the Login
  link and the Settings link introduced in feature 001) consume;
  this feature reuses that signal rather than introducing a new auth
  concept.
- "Account" in the header refers to the existing user-account
  destination shown in the current header. No new account surface is
  being introduced.
- Route-level access control for the Account page itself (e.g. what
  happens if a signed-out user types the URL directly) is handled
  elsewhere and is intentionally out of scope here.
- Other header items keep their current visibility rules; this spec
  only changes the Account link.
