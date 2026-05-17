# Implementation Plan: Remove Subscription Messaging from Home Screen

**Branch**: `002-remove-subscription-text` | **Date**: 2026-05-16 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-remove-subscription-text/spec.md`

## Summary

Remove the conditional "free account" warning banner from the home route. The
banner currently tells non-paid users that drawings are not saved and links to
`/pricing`. Subscriptions are being phased out as a product concept, so the
message is misleading and must go. Technical approach: delete the
`${state.isPaid.value ? null : html\`<aside …>…</aside>\`}` block in
`src/routes/home.ts` and the now-unused `.free-account-warning` rule in
`src/routes/home.css`. No data, API, or auth changes; no replacement copy.

## Technical Context

**Language/Version**: TypeScript 5.8 (ES2022, ESM), Node >=20.19
**Primary Dependencies**: Preact 10, `@preact/signals` 2, `htm` (tagged-template
JSX), `@substrate-system/state` for app state
**Storage**: N/A for this change (drawings persistence and stamps state are
untouched)
**Testing**: tapout + tapzero for unit/integration (`npm test`), vitest for e2e
(`npm run test:e2e`), `@testing-library/preact` available; lint via
`eslint` (`npm run lint`)
**Target Platform**: Web (browser SPA built with Vite, deployed via Netlify)
**Project Type**: Single-project frontend SPA with Netlify Functions backend
**Performance Goals**: No regression in time-to-first-meaningful-interaction on
`/` (one DOM node removed, expected neutral-to-positive)
**Constraints**: Must not break paid-user rendering; must not leave a stray
"Save warning" status region in the accessibility tree; must not touch
unrelated CSS (per project CLAUDE.md)
**Scale/Scope**: One route file edit (`src/routes/home.ts`), one CSS rule
removal (`src/routes/home.css`). Zero new files, zero schema changes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution at `.specify/memory/constitution.md` is the unedited
template with placeholder principles (`[PRINCIPLE_1_NAME]`, etc.) and no
ratified rules. There are therefore no constitutional gates to evaluate for
this feature. Project-level guidance from `CLAUDE.md` and the user's global
`CLAUDE.md` is treated as the operative style/quality bar:

- No CSS changes unrelated to the task (the `.free-account-warning` rule is
  directly related — it styles the element being removed). PASS.
- No ESLint settings changes. PASS.
- No brittle tests checking specific HTML text content for docs/marketing
  copy. PASS (no new tests; verification uses accessibility-tree absence and
  manual smoke).
- TypeScript line length ≤ 80 cols, no emojis. PASS (deletion only).

**Result**: No violations. No entries needed in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/002-remove-subscription-text/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (N/A — no entities)
├── quickstart.md        # Phase 1 output (verification steps)
├── contracts/           # Phase 1 output
│   └── home-route-ui.md # UI contract (what the home route MUST/MUST NOT render)
└── tasks.md             # Phase 2 output (/speckit.tasks — not created here)
```

### Source Code (repository root)

```text
src/
├── routes/
│   ├── home.ts          # EDIT: remove subscription warning aside
│   ├── home.css         # EDIT: remove .free-account-warning rule
│   └── …                # other routes unchanged
├── state.ts             # untouched (isPaid signal stays; used elsewhere)
└── …

test/
└── (no new tests — accessibility-tree assertion is covered by manual
   verification per CLAUDE.md "do not test for specific text content in HTML")

netlify/                 # untouched
```

**Structure Decision**: Existing single-project SPA layout. The change is
local to two files under `src/routes/`. No new modules, no new tests, no
backend touch.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None. The change is a pure deletion of dead/misleading UI plus its dedicated
CSS rule.
