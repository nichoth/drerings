# Tasks: Restore atproto Sign-In (Fix `/api/auth/login` 404)

**Input**: Design documents from `/specs/005-fix-auth-login-404/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/http-endpoints.md, quickstart.md

**Tests**: No new test files. Existing tests are not modified beyond
import-path updates (per research.md "Decision: tests update only
their import paths"). No assertion changes, no skips, no relaxations.

**Organization**: This feature contains exactly one user story (US1).
All real work is grouped under it; Setup is bug reproduction and
Polish is final verification.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Maps task to the user story (US1)
- Include exact file paths in descriptions

## Path Conventions

- Netlify Function handlers: `netlify/functions/<name>.ts` (flat)
- Domain logic (unchanged): `netlify/lib/`
- Redirect table: `netlify.toml`
- Tests: `test/us*.test.ts`

---

## Phase 1: Setup (Reproduce the Bug)

**Purpose**: Confirm the 404 reproduces locally before changing
anything. Establishes the baseline against which the fix is verified.

- [ ] T001 Start the dev stack with `npm start` and confirm `vite`
      and `ntl functions:serve` come up clean (no startup errors in
      either log).
- [ ] T002 Run `curl -i 'http://127.0.0.1:8888/api/auth/login?handle=test.bsky.social'`
      and confirm `HTTP/1.1 404 Not Found` with the Netlify
      "Function not found" page (matches spec symptom).
- [ ] T003 Run `curl -i 'http://127.0.0.1:8888/api/whoami'` and
      confirm `HTTP/1.1 401` with `{"error":"Please sign in."}` —
      isolates the defect to nested files, not the dev server.
- [ ] T004 Run `curl -i 'http://127.0.0.1:8888/api/stamps/lots'` and
      confirm `HTTP/1.1 404` — sanity that at least one sibling
      nested endpoint is also broken, not just `auth/login`.

**Checkpoint**: Bug reproduced, server healthy for flat-file
endpoints, defect scoped to nested files.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: This is a structural fix with one user story; the
"foundation" is a pre-implementation inventory snapshot used by AG-D1
through AG-D4 in `data-model.md` for diff-based verification later.

**CRITICAL**: T005 and T006 capture pre-fix state; without them, the
post-fix sanity checks cannot prove a delta.

- [X] T005 Capture pre-fix function inventory:
      `find netlify/functions -type f -name '*.ts' | sort >
      /tmp/drerings-functions-pre.txt`. Confirm it contains the 14
      nested files listed in data-model.md plus the 7 unchanged
      flat/scheduled files.
- [X] T006 Capture pre-fix redirect-table state:
      `grep -nE 'from = "/(api|\.well-known)' netlify.toml >
      /tmp/drerings-redirects-pre.txt` and confirm the `/api/* →
      /.netlify/functions/:splat` wildcard is present.

**Checkpoint**: Pre-fix snapshots saved. Implementation can begin.

---

## Phase 3: User Story 1 - User can sign in with their Bluesky handle (Priority: P1) MVP

**Goal**: Every public API endpoint (especially `/api/auth/login`,
`/api/auth/callback`, `/api/auth/logout`) reaches its handler.
End-to-end sign-in succeeds without any intermediate 404.

**Independent Test**: From a fresh browser with no `drerings_auth`
cookie, sign in via the SPA using a valid Bluesky handle. Browser is
redirected to the PDS authorize URL (not a Netlify 404 page); after
authorization, the user returns to the app with a valid session and
`GET /api/whoami` returns `{ id, did, handle, stamps_balance }`. The
quickstart manual verification section is the executable form of
this test.

### Handler relocations (parallelizable file moves)

Each move is a single `git mv` against an independent file. All 14
can be done in parallel.

- [X] T007 [P] [US1] `git mv netlify/functions/auth/login.ts
      netlify/functions/auth-login.ts`
- [X] T008 [P] [US1] `git mv netlify/functions/auth/callback.ts
      netlify/functions/auth-callback.ts`
- [X] T009 [P] [US1] `git mv netlify/functions/auth/logout.ts
      netlify/functions/auth-logout.ts`
- [X] T010 [P] [US1] `git mv netlify/functions/billing/checkout.ts
      netlify/functions/billing-checkout.ts`
- [X] T011 [P] [US1] `git mv netlify/functions/billing/webhook.ts
      netlify/functions/billing-webhook.ts`
- [X] T012 [P] [US1] `git mv netlify/functions/postcards/send.ts
      netlify/functions/postcards-send.ts`
- [X] T013 [P] [US1] `git mv netlify/functions/shares/precheck.ts
      netlify/functions/shares-precheck.ts`
- [X] T014 [P] [US1] `git mv netlify/functions/shares/confirm.ts
      netlify/functions/shares-confirm.ts`
- [X] T015 [P] [US1] `git mv netlify/functions/stamps/lots.ts
      netlify/functions/stamps-lots.ts`
- [X] T016 [P] [US1] `git mv netlify/functions/stamps/refund.ts
      netlify/functions/stamps-refund.ts`
- [X] T017 [P] [US1] `git mv netlify/functions/stamps/transactions.ts
      netlify/functions/stamps-transactions.ts`
- [X] T018 [P] [US1] `git mv netlify/functions/stamps/gifts/checkout.ts
      netlify/functions/stamps-gifts-checkout.ts`
- [X] T019 [P] [US1] `git mv netlify/functions/stamps/gifts/refund.ts
      netlify/functions/stamps-gifts-refund.ts`
- [X] T020 [P] [US1] `git mv netlify/functions/webhooks/resend.ts
      netlify/functions/webhooks-resend.ts`
- [X] T021 [US1] Remove now-empty parent directories:
      `rmdir netlify/functions/auth netlify/functions/billing
      netlify/functions/postcards netlify/functions/shares
      netlify/functions/webhooks netlify/functions/stamps/gifts
      netlify/functions/stamps` (depends on T007–T020).

### Import-path fixes inside moved handlers (parallelizable)

Each moved file's relative imports must shift up one folder
(`../../lib/...` → `../lib/...`) or two folders for the
`stamps/gifts/` cases (`../../../lib/...` → `../lib/...`). Each file
is independent of the others.

- [X] T022 [P] [US1] Update relative imports in
      `netlify/functions/auth-login.ts` (`../../lib/...` →
      `../lib/...`). Verify no remaining `../../` paths inside the
      file. No logic changes.
- [X] T023 [P] [US1] Update relative imports in
      `netlify/functions/auth-callback.ts`.
- [X] T024 [P] [US1] Update relative imports in
      `netlify/functions/auth-logout.ts`.
- [X] T025 [P] [US1] Update relative imports in
      `netlify/functions/billing-checkout.ts`.
- [X] T026 [P] [US1] Update relative imports in
      `netlify/functions/billing-webhook.ts`.
- [X] T027 [P] [US1] Update relative imports in
      `netlify/functions/postcards-send.ts`.
- [X] T028 [P] [US1] Update relative imports in
      `netlify/functions/shares-precheck.ts`.
- [X] T029 [P] [US1] Update relative imports in
      `netlify/functions/shares-confirm.ts`.
- [X] T030 [P] [US1] Update relative imports in
      `netlify/functions/stamps-lots.ts`.
- [X] T031 [P] [US1] Update relative imports in
      `netlify/functions/stamps-refund.ts`.
- [X] T032 [P] [US1] Update relative imports in
      `netlify/functions/stamps-transactions.ts`.
- [X] T033 [P] [US1] Update relative imports in
      `netlify/functions/stamps-gifts-checkout.ts`
      (was `../../../lib/...` → `../lib/...`).
- [X] T034 [P] [US1] Update relative imports in
      `netlify/functions/stamps-gifts-refund.ts`
      (was `../../../lib/...` → `../lib/...`).
- [X] T035 [P] [US1] Update relative imports in
      `netlify/functions/webhooks-resend.ts`.

### Redirect-table rewrite (single file, sequential)

- [X] T036 [US1] Delete the `/api/* → /.netlify/functions/:splat`
      wildcard `[[redirects]]` block in `netlify.toml`. Preserve the
      `/.well-known/oauth-client-metadata.json` block and the
      `/* → /index.html` SPA fallback unchanged. Preserve the
      `[[headers]]` block byte-for-byte.
- [X] T037 [US1] Add explicit `[[redirects]]` blocks in
      `netlify.toml` per the contract table — one per endpoint —
      using the exact `from`/`to`/`status` shapes documented in
      `quickstart.md` step 3. The set MUST cover: `/api/auth/login`,
      `/api/auth/callback`, `/api/auth/logout`, `/api/shares/precheck`,
      `/api/shares/confirm`, `/api/postcards/send`,
      `/api/billing/checkout`, `/api/billing/webhook`,
      `/api/stamps/lots`, `/api/stamps/transactions`,
      `/api/stamps/refund/*` (splat),
      `/api/stamps/gifts/checkout`,
      `/api/stamps/gifts/refund/*` (splat),
      `/api/webhooks/resend`, `/api/whoami`, `/api/account`,
      `/api/drawings`, `/api/drawings/*` (splat), `/api/posts`,
      `/api/posts/*` (splat). Depends on T036.
- [X] T038 [US1] Confirm SPA call sites for path-parametric
      endpoints by grepping `src/state.ts` for
      `/api/stamps/refund/`, `/api/stamps/gifts/refund/`,
      `/api/drawings/`, `/api/posts/`. Make sure each splat
      redirect rule in T037 mirrors the actual call shape (the
      drawings/posts splats may be unused — if so, omit those
      splat rules and keep only the plain `/api/drawings` and
      `/api/posts` redirects). Update T037 if any splat is
      unneeded.

### Test import-path updates (parallelizable; one file each)

Each test file imports a handler by relative path. Update to the new
flat name only — no assertion or logic changes.

- [X] T039 [P] [US1] Update handler import paths in
      `test/us020-auth-callback.test.ts`
      (`../netlify/functions/auth/callback.js` →
      `../netlify/functions/auth-callback.js` and any sibling auth
      imports in the file).
- [X] T040 [P] [US1] Update handler import paths in
      `test/us018-logout.test.ts`
      (`../netlify/functions/auth/logout.js` →
      `../netlify/functions/auth-logout.js`).
- [X] T041 [P] [US1] Update handler import paths in
      `test/us039-rate-limit-login.test.ts`
      (auth/login.js → auth-login.js).
- [X] T042 [P] [US1] Update handler import paths in
      `test/us039-rate-limit-endpoints.test.ts` (covers multiple
      moved endpoints; update each).
- [X] T043 [P] [US1] Update handler import paths in
      `test/us039-postcard-cas.test.ts`
      (postcards/send.js → postcards-send.js).
- [X] T044 [P] [US1] Update handler import paths in
      `test/us030-postcard-send-api.test.ts`
      (postcards/send.js → postcards-send.js).
- [X] T045 [P] [US1] Update handler import paths in
      `test/us037-failed-send-refund-e2e.test.ts` (covers postcards
      and webhooks; update each).
- [X] T046 [P] [US1] Update handler import paths in
      `test/us033-resend-webhook-handler.test.ts`
      (webhooks/resend.js → webhooks-resend.js).
- [X] T047 [P] [US1] Update handler import paths in
      `test/us016-stamp-lots-api.test.ts`
      (stamps/lots.js → stamps-lots.js).
- [X] T048 [P] [US1] Update handler import paths in
      `test/us023-stamp-transactions-api.test.ts`
      (stamps/transactions.js → stamps-transactions.js).
- [X] T049 [P] [US1] Update handler import paths in
      `test/us017-gift-checkout-api.test.ts`
      (stamps/gifts/checkout.js → stamps-gifts-checkout.js).
- [X] T050 [US1] Final test-import sweep:
      `grep -rln "netlify/functions/\(auth\|shares\|postcards\|billing\|stamps\|webhooks\)/" test/`
      MUST return zero results. If any match remains, update it and
      re-run. Depends on T039–T049.

### Functional verification (US1 acceptance)

These run after handlers, redirects, and test imports are updated.

- [ ] T051 [US1] Restart the dev stack (`npm start`). Watch the
      `ntl functions:serve --debug` output for a "Loaded function"
      line (or equivalent) for each of the 14 newly-flat functions.
      Confirm none are silently dropped.
- [ ] T052 [US1] Re-run the reproduction:
      `curl -i 'http://127.0.0.1:8888/api/auth/login?handle=test.bsky.social'`.
      Expected `HTTP/1.1 302 Found` with `Location:` pointing at a
      PDS authorize URL. Anything other than 404 from the handler is
      acceptable (302, 400, 405, 429); a Netlify 404 page is a
      failure.
- [ ] T053 [US1] Confirm `POST /api/auth/login` returns 405 not 404:
      `curl -i -X POST 'http://127.0.0.1:8888/api/auth/login'`.
      Expected `HTTP/1.1 405` with `{"error":"method_not_allowed"}`.
- [ ] T054 [US1] Run end-to-end sign-in in a fresh browser:
      visit the SPA sign-in entry, enter a real Bluesky handle,
      authorize at the PDS, return to the app, confirm
      `GET /api/whoami` returns `{ id, did, handle, stamps_balance }`
      with a valid `drerings_auth` cookie set. Then sign out and
      confirm `/api/whoami` 401s.
- [ ] T055 [US1] Smoke the previously-broken sibling endpoints,
      signed in, to confirm CI-1 (every public URL reaches its
      handler):
      ```
      curl -i -b 'drerings_auth=<cookie>' \
        http://127.0.0.1:8888/api/stamps/lots
      curl -i -b 'drerings_auth=<cookie>' \
        http://127.0.0.1:8888/api/stamps/transactions
      ```
      Each MUST return 200 (or a handler-defined non-404 status).
- [ ] T056 [US1] Confirm `oauth-client-metadata.json` still serves
      with a cacheable response (its handler sets cacheable
      `Cache-Control`):
      `curl -i 'http://127.0.0.1:8888/.well-known/oauth-client-metadata.json'`.
      Expected 200 with no `Cache-Control: private, no-store`
      (preserves FR-006 and CI-3).

**Checkpoint**: US1 is fully implemented. `/api/auth/login` returns
302 (or other handler-defined non-404 status), end-to-end sign-in
works, all sibling endpoints respond from their handlers, and
`oauth-client-metadata.json` is still cacheable.

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Diff-based routing sanity, full test pass, lint clean.
These are the gating checks before merge.

- [X] T057 [P] AG-D1 sanity: `find netlify/functions -mindepth 2
      -type f -name '*.ts'` MUST output nothing. (No nested handler
      files remain.)
- [X] T058 [P] AG-D2 sanity: `grep -n 'from = "/api/\*"'
      netlify.toml` MUST output nothing. (No wildcard remains.)
- [X] T059 [P] AG-D3 sanity: every redirect targets an existing
      function file. Run:
      ```
      grep -oE 'to = "/.netlify/functions/[a-z0-9-]+' netlify.toml \
        | sed 's|to = "/.netlify/functions/||' \
        | sort -u \
        | while read name; do
            test -f "netlify/functions/$name.ts" || \
              echo "MISSING: netlify/functions/$name.ts"
          done
      ```
      Expected: no `MISSING:` lines.
- [X] T060 [P] AG-D4 sanity: every handler under
      `netlify/functions/` (excluding scheduled jobs
      `refund-expired-gifts.ts` and `verify-stamp-invariants.ts`)
      has a matching `[[redirects]]` block in `netlify.toml`.
      For each `ls netlify/functions/*.ts`, confirm one redirect
      `to = "/.netlify/functions/<basename>"` (or
      `<basename>/:splat` for path-parametric routes) exists.
- [X] T061 Run `npm test` from repo root. All previously-passing
      tests pass with no skips, no relaxed assertions, no new
      failures. Failure here means a handler import-path update or
      domain wiring is wrong — fix and re-run, do NOT relax a test.
- [X] T062 Run `npm run lint`. Clean. No new ESLint disables.
- [X] T063 Diff inventories against pre-fix snapshots:
      `diff /tmp/drerings-functions-pre.txt <(find
      netlify/functions -type f -name '*.ts' | sort)` should show
      the 14 nested files removed and the 14 dashed flat files
      added — no other changes (scheduled jobs and previously-flat
      files unchanged).
- [ ] T064 Run the quickstart manual verification (Section "Verify
      the fix → Manual end-to-end" in `quickstart.md`) in full,
      treating each step as a pass/fail. Report results in the PR
      description.

**Checkpoint**: All sanity checks pass, tests pass, lint clean,
manual e2e verified. Ready for PR review.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No code dependencies. Establishes baseline;
  can start immediately.
- **Phase 2 (Foundational)**: Depends on Phase 1 — needs the
  reproduction confirmed first so the pre-fix snapshots match the
  bug state.
- **Phase 3 (US1)**: Depends on Phase 2 — handler moves, import
  fixes, redirect rewrite, test import updates, and acceptance
  verification.
- **Phase 4 (Polish)**: Depends on Phase 3 — diff-based sanity,
  full test pass, lint, end-to-end manual.

### Within Phase 3 (US1)

- T007–T020 (file moves): all parallel; no dependencies on each
  other.
- T021 (rmdir): depends on T007–T020.
- T022–T035 (import-path fixes): each depends on its own move task
  (T022 depends on T007, T023 on T008, etc.); independent of other
  files in the same task class — parallel with one another.
- T036 (delete wildcard): no dependency on file moves but must
  happen before T037 to avoid duplicate redirect entries during
  edit.
- T037 (add explicit redirects): depends on T036 and on knowing the
  final flat function names (T007–T020).
- T038 (splat sanity for drawings/posts): may modify T037 output.
- T039–T049 (test import updates): each independent; parallel.
- T050 (test-import sweep): depends on T039–T049.
- T051 (restart + load log): depends on every handler move + import
  fix + redirect rewrite (T007–T037).
- T052–T056 (functional verification): depend on T051. Within this
  group, all are independent — but easiest to run sequentially in
  one session.

### User Story Dependencies

- US1 is the sole user story. There are no inter-story dependencies.

### Parallel Opportunities

- **T007–T020** (14 file moves): all parallel.
- **T022–T035** (14 import-path fixes): all parallel (after the
  matching move completes).
- **T039–T049** (11 test-import updates): all parallel.
- **T057–T060** (4 routing sanity checks): all parallel.

A reasonable batched execution is:

```
1. T001 → T004           (sequential reproduction)
2. T005, T006            (parallel snapshots)
3. T007 .. T020          (parallel: 14 file moves)
4. T021                  (rmdir empty parents)
5. T022 .. T035          (parallel: 14 import fixes)
6. T036 → T037 → T038    (sequential redirect rewrite)
7. T039 .. T049          (parallel: 11 test imports)
8. T050                  (test-import sweep)
9. T051 → T052 → T053 → T054 → T055 → T056   (sequential verify)
10. T057 .. T060         (parallel sanity)
11. T061 → T062 → T063 → T064                (sequential polish)
```

---

## Parallel Example: Handler moves + import fixes

```bash
# In one logical batch (sub-agents or single shell, your choice):
git mv netlify/functions/auth/login.ts netlify/functions/auth-login.ts
git mv netlify/functions/auth/callback.ts netlify/functions/auth-callback.ts
git mv netlify/functions/auth/logout.ts netlify/functions/auth-logout.ts
# ... (the other 11 moves) ...

# Then in parallel, update each moved file's relative imports:
#   ../../lib/...   →  ../lib/...
#   ../../../lib/.. →  ../lib/... (only stamps-gifts-* files)
```

## Parallel Example: Test import updates

```bash
# Each file is independent; safe to do in parallel.
# Update the import string inside each, no other changes:
test/us020-auth-callback.test.ts
test/us018-logout.test.ts
test/us039-rate-limit-login.test.ts
test/us039-rate-limit-endpoints.test.ts
test/us039-postcard-cas.test.ts
test/us030-postcard-send-api.test.ts
test/us037-failed-send-refund-e2e.test.ts
test/us033-resend-webhook-handler.test.ts
test/us016-stamp-lots-api.test.ts
test/us023-stamp-transactions-api.test.ts
test/us017-gift-checkout-api.test.ts
```

---

## Implementation Strategy

### MVP First (US1 = entire feature)

There is only one user story. The MVP is the full fix:

1. Phase 1: Reproduce the bug.
2. Phase 2: Snapshot pre-fix state.
3. Phase 3: All file moves, import fixes, redirect rewrite, test
   import updates, then run the functional verification curl/UI
   steps.
4. STOP and VALIDATE: sign-in works end-to-end; sibling endpoints
   reachable; `oauth-client-metadata.json` still cacheable.
5. Phase 4: Routing sanity, full tests, lint, manual e2e — gate
   for merge.

### Incremental Delivery

Not applicable in the per-story sense — this is one structural
change. However, the parallel-execution batching above gives a
clear shippable order, and each completed batch leaves the tree in
a coherent state (e.g., after T021 the move is done but redirects
not yet rewritten — `npm test` may temporarily fail until T050
completes; do not commit between T021 and T050 unless the tests
still pass).

### Single-Developer Strategy

One developer can execute the whole list in roughly:

- 15 min: Phase 1 + Phase 2 (reproduce + snapshot).
- 30 min: T007–T035 (moves + import fixes), running in one shell
  with `sed`/find-replace per file class.
- 15 min: T036–T038 (redirect rewrite + splat sanity).
- 20 min: T039–T050 (test import updates + sweep).
- 30 min: T051–T056 (functional verification, including manual
  browser sign-in).
- 20 min: Phase 4 (sanity, tests, lint, e2e write-up).

Roughly 2 hours of focused work end-to-end.

---

## Notes

- This feature has exactly one user story; the [Story] label on
  Phase 3 tasks is always [US1].
- Tests are not modified beyond import paths (per research.md). No
  test assertion changes. No skipped or relaxed tests.
- No CSS, no client state, no `_variables.css`, no migrations, no
  new dependencies.
- The `oauth-client-metadata.json` cacheable response (FR-006,
  CI-3) MUST be preserved — verify in T056.
- After this fix lands, any new endpoint added to
  `netlify/functions/` MUST also get a matching `[[redirects]]`
  block in `netlify.toml`. The wildcard is gone deliberately so the
  silent-failure mode that caused this bug cannot recur (CI-2 is
  the durable guard).
- Rollback: revert the merge commit. The change is purely
  structural; no migrations or cookie/scheme changes.
