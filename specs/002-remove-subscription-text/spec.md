# Feature Specification: Remove Subscription Messaging from Home Screen

**Feature Branch**: `002-remove-subscription-text`
**Created**: 2026-05-15
**Status**: Draft
**Input**: User description: "We are getting rid of the idea of subscriptions. Need to change the home screen so that it doesn't say \"Drawings aren't saved without a subscription. Subscribe to keep them and share them with the world.\""

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Free user sees a home screen without subscription messaging (Priority: P1)

A visitor who has not paid arrives at the home screen and is presented with the drawing experience without being told that their drawings will not be saved or that they need to subscribe. They can begin drawing immediately without being nudged toward a subscription that no longer exists as a product concept.

**Why this priority**: The current banner makes a false promise to free users — it tells them their work will not be saved and pushes them toward "subscribing." Subscriptions are being phased out, so the message is both misleading and inconsistent with the product direction. Removing it is the single behavioral change the request asks for.

**Independent Test**: Load the home screen as a signed-out or non-paid user and confirm the page no longer contains the warning banner or the subscribe call-to-action. Drawing flow remains usable. No other home screen content shifts in a way that surprises the user.

**Acceptance Scenarios**:

1. **Given** a signed-out visitor opens the home screen, **When** the page finishes rendering, **Then** the text "Drawings aren't saved without a subscription" does not appear anywhere on the page and no "Subscribe to keep them and share them with the world" link is shown.
2. **Given** a signed-in user without an active paid status opens the home screen, **When** the page finishes rendering, **Then** the subscription warning banner is absent and the rest of the home screen (intro copy, canvas, controls, form) renders as before.
3. **Given** a signed-in paid user opens the home screen, **When** the page finishes rendering, **Then** their experience is unchanged from the prior behavior (they did not see the banner before and still do not see it now).

---

### Edge Cases

- A user whose paid status flips between renders should not briefly see the banner. Removing the banner unconditionally avoids this race.
- Screen reader users currently encounter the banner as a status region labeled "Save warning." Once removed, no equivalent live region should be left behind announcing nothing.
- If a cached page (service worker / browser cache) still serves the old markup, the change applies on the next fresh load. No migration step is required for already-loaded pages.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The home screen MUST NOT render the text "Drawings aren't saved without a subscription" for any user, regardless of authentication or paid status.
- **FR-002**: The home screen MUST NOT render the link text "Subscribe to keep them and share them with the world" or any link from the home screen targeting the subscription / pricing flow as part of this banner.
- **FR-003**: The home screen MUST continue to present the existing drawing experience (intro copy, canvas, drawing controls, post form) unchanged for both paid and non-paid users after the banner is removed.
- **FR-004**: The accessibility tree of the home screen MUST NOT expose a "Save warning" status region after this change.

### Out of Scope

- Removing or restructuring the pricing route, the account-page subscription controls, or backend subscription state. The request is scoped to the home screen banner only; broader subscription cleanup is a separate concern.
- Introducing replacement copy that promotes the stamps-based monetization model on the home screen. If a stamps-oriented message is desired in the future, it will be specced separately.
- Changes to how drawings are persisted. Drawings are already saved via the stamps system; this spec does not alter that.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of home-screen page loads — across signed-out, signed-in non-paid, and signed-in paid users — render without the subscription warning text or call-to-action.
- **SC-002**: Zero references to the phrases "Drawings aren't saved without a subscription" or "Subscribe to keep them and share them with the world" remain in the home screen view after the change.
- **SC-003**: Time-to-first-meaningful-interaction on the home screen for non-paid users (time from load to ability to draw) is unchanged or shorter, since one rendered element is removed.
- **SC-004**: No new accessibility violations are introduced on the home screen, and the previously-announced "Save warning" status region is no longer present in the accessibility tree.

## Assumptions

- The intent is to remove the banner outright, not to replace it with alternative copy. The request says "doesn't say [X]" without specifying replacement text, and the broader framing is that subscriptions are being eliminated as a concept. A future spec can add stamps-oriented messaging if desired.
- Paid users currently see no banner; that behavior is preserved.
- The paid-vs-free conditional logic remains in place for other features (e.g., paid drawing controls). Only the banner branch is removed.
- The pricing page and other subscription-related surfaces remain reachable for now and are out of scope; their treatment will be decided in a follow-up.
