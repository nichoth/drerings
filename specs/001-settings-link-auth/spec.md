# Feature Specification: Auth-gated Settings link in header

**Feature Branch**: `001-settings-link-auth`
**Created**: 2026-05-15
**Status**: Draft
**Input**: User description: "Should only show the 'Settings' link in the header if the user is logged in"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Hide Settings link from logged-out visitors (Priority: P1)

A visitor who is not signed in arrives at the site. The top navigation
shows only the links that make sense for an anonymous visitor (Home,
Drawings, Pricing, Account, About, Login). The Settings link is not
present, because there is no account whose settings could be changed.

**Why this priority**: This is the entire feature. Without it, the
navigation advertises an account-only destination to people who have
no account, which is confusing and leads to dead-end clicks.

**Independent Test**: Open the site in a fresh browser (no session
cookie / no stored credentials). Inspect the header. The Settings link
must not appear. Every other header link continues to behave as it
does today.

**Acceptance Scenarios**:

1. **Given** a visitor with no active session, **When** they load any
   page that renders the site header, **Then** the header does not
   include a "Settings" link.
2. **Given** a visitor with no active session, **When** they
   programmatically inspect the rendered header markup, **Then** no
   element labeled or linking to Settings is present (it is omitted,
   not merely hidden via styling).

---

### User Story 2 - Show Settings link to signed-in users (Priority: P1)

A signed-in user navigates the site and expects quick access to their
account settings from the persistent header on every page.

**Why this priority**: The Settings link must remain reachable for the
users who actually have settings to manage; otherwise the change
regresses functionality for the paying audience.

**Independent Test**: Sign in as any account. Inspect the header on
multiple pages (home, drawings, account, etc.). The Settings link
appears in the same position it does today and navigates to the
existing settings destination.

**Acceptance Scenarios**:

1. **Given** a user with an active session, **When** they load any
   page that renders the site header, **Then** the "Settings" link is
   visible in the header.
2. **Given** a signed-in user, **When** they click the Settings link,
   **Then** they are taken to the existing settings page with no
   regression in behavior.

---

### User Story 3 - Link visibility updates when auth state changes (Priority: P2)

A user signs in or signs out during a session. The header reflects
their new auth state without requiring a manual page reload.

**Why this priority**: The header already updates other auth-dependent
affordances (e.g. the Login link) on state change. The Settings link
should behave consistently so the navigation never lies about what the
user can do right now.

**Independent Test**: Start signed out, confirm Settings is hidden.
Sign in within the same tab, confirm Settings appears without manual
reload. Sign out, confirm Settings disappears again.

**Acceptance Scenarios**:

1. **Given** a signed-out visitor viewing the header, **When** they
   complete sign-in in the same session, **Then** the Settings link
   appears without a full page reload.
2. **Given** a signed-in user viewing the header, **When** they sign
   out, **Then** the Settings link is removed from the header without
   a full page reload.

---

### Edge Cases

- While auth state is still being resolved on first paint (e.g. the
  app is checking for a stored session), the header treats the user
  as signed-out for the purpose of the Settings link, so the link
  never flashes for unauthenticated visitors.
- If the user's session expires while the page is open, the next
  header render after the app notices the expiration omits the
  Settings link.
- Direct navigation to the Settings URL by a signed-out user is out
  of scope for this feature; this feature only governs the header
  link's visibility, not route-level access control.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The site header MUST render the "Settings" link only
  when the current viewer has an active authenticated session.
- **FR-002**: When no authenticated session exists, the header MUST
  omit the "Settings" link from the rendered markup, rather than
  hiding it visually while leaving it in the DOM/accessibility tree.
- **FR-003**: The header MUST react to changes in authentication
  state during a session so the Settings link appears on sign-in and
  disappears on sign-out without requiring a manual page reload.
- **FR-004**: While authentication state is unresolved (initial load,
  in-flight session check), the header MUST default to the
  signed-out treatment so the Settings link does not flash for
  unauthenticated viewers.
- **FR-005**: No other header link's visibility, order, or labeling
  MUST change as part of this feature.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of header renders for unauthenticated viewers
  exclude the Settings link, verified by an automated check that
  loads the site without a session and asserts the link's absence.
- **SC-002**: 100% of header renders for authenticated users include
  the Settings link in its existing position, verified by an
  automated check that loads the site with a valid session.
- **SC-003**: After a sign-in or sign-out action within a single
  session, the header reflects the new state within one render cycle
  (no manual reload required).
- **SC-004**: Dead-end clicks on Settings by signed-out visitors drop
  to zero, because the link is no longer reachable from the header
  in that state.

## Assumptions

- The application already has a reliable signal for "is the current
  viewer signed in" that other header elements (such as the Login
  link) consume; this feature reuses that signal rather than
  introducing a new auth concept.
- "Settings" in the header refers to the existing user-account
  settings destination shown in the current header. No new settings
  surface is being introduced.
- Route-level access control for the Settings page itself (e.g. what
  happens if a signed-out user types the URL directly) is handled
  elsewhere and is intentionally out of scope here.
- Other auth-dependent header items (for example "Account") keep
  their current visibility rules; this spec does not change them.
