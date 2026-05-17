# Phase 0 Research — Remove Subscription Messaging from Home Screen

The feature spec has no `[NEEDS CLARIFICATION]` markers. The only open
questions are minor implementation decisions, each resolved below.

## Decisions

### D1 — Delete the banner outright (no replacement copy)

- **Decision**: Remove the entire `${state.isPaid.value ? null : html\`<aside
  class="free-account-warning" …>…</aside>\`}` block from
  `src/routes/home.ts`. Do not substitute any stamps-oriented or "drawings
  are saved" reassurance.
- **Rationale**: The spec is explicit ("Assumptions: The intent is to remove
  the banner outright, not to replace it with alternative copy."). The
  request says "doesn't say [X]" without naming replacement text, and
  subscriptions are being eliminated as a product concept.
- **Alternatives considered**:
  - *Replace with stamps-positive copy* — rejected: out of scope per spec
    ("Out of Scope: Introducing replacement copy that promotes the
    stamps-based monetization model on the home screen").
  - *Keep the conditional, just blank the inner text* — rejected: leaves an
    empty `role="status"` live region that screen readers would still
    announce on load (FR-004 forbids this).

### D2 — Also remove the dedicated CSS rule `.free-account-warning`

- **Decision**: Remove the `& .free-account-warning { … }` block (currently
  `src/routes/home.css:13–22`) since it styles only the element being
  deleted.
- **Rationale**: The class is grep-unique to the deleted markup. Leaving
  the rule would be dead CSS. Global CLAUDE.md says "NEVER change CSS that
  is not related to the task you are working on"; this rule *is* directly
  related — it is the styling for the element under removal.
- **Alternatives considered**:
  - *Leave the CSS in place* — rejected: dead code, and a future reader
    would have to grep to discover the class is unreferenced.
  - *Delete the entire `home.css` file* — rejected: unrelated rules
    (`.composer-layout`, `.canvas-column`, form styles, etc.) are still
    in use.

### D3 — Do not touch `state.isPaid` or any paid-vs-free conditional elsewhere

- **Decision**: The `state.isPaid` signal is referenced by other features
  (paid drawing controls, account UI, etc.). Leave it and all other
  `isPaid` branches alone.
- **Rationale**: Spec assumption: "The paid-vs-free conditional logic
  remains in place for other features. Only the banner branch is removed."
- **Verification**: `grep -n "isPaid" src/routes/home.ts` after the edit
  should return zero matches in `home.ts`; matches elsewhere are expected
  and out of scope.

### D4 — No new automated tests

- **Decision**: Do not add a unit/e2e test asserting the text is absent.
- **Rationale**: User's global CLAUDE.md explicitly says "DO NOT WRITE
  BRITTLE TESTS — do not test for specific text content in HTML." The
  natural test for this removal would be exactly that brittle pattern.
  Verification is via quickstart.md (manual smoke + accessibility-tree
  check). Existing tests still need to pass (`npm test && npm run lint`)
  to confirm no collateral breakage.
- **Alternatives considered**:
  - *Add an `@testing-library/preact` render test that asserts
    `queryByText(/aren't saved/i)` returns null* — rejected per the rule
    above.
  - *Add an axe-core check* — out of scope; accessibility-tree absence is
    naturally satisfied by deleting the `role="status"` element.

### D5 — No service-worker / cache invalidation step

- **Decision**: Ship the change with the normal build. Do not bump a cache
  version or force-clear caches.
- **Rationale**: Spec edge case: "If a cached page (service worker /
  browser cache) still serves the old markup, the change applies on the
  next fresh load. No migration step is required for already-loaded
  pages."

## Open questions

None.
