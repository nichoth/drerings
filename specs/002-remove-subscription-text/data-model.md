# Phase 1 Data Model — Remove Subscription Messaging from Home Screen

**Status**: Not applicable.

This feature is a pure UI deletion. It introduces no new entities, modifies
no existing entities, adds no fields, and changes no validation rules or
state transitions.

For completeness:

- **`state.isPaid` (existing `Signal<boolean>`)**: unchanged. Still derived
  from the same source and still consumed by other features (paid drawing
  controls, account page, etc.). Only one *reader* — the home-screen
  banner conditional — is being removed.
- **No persistence changes**: drawings continue to be saved via the
  existing stamps system. The banner's claim that "drawings aren't saved
  without a subscription" was already inconsistent with that reality; this
  spec just stops asserting it in the UI.

If a future spec adds stamps-oriented home-screen messaging, it will define
its own entities/state there.
