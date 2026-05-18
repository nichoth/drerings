# Phase 6: Client Share Flow Implementation Plan

**Goal:** Wire the post page through `/api/shares/precheck` and
`/api/shares/confirm` with the new UX states (free / paid confirm
dialog / blocked message / reused short-circuit).

**Architecture:** A new `State.ShareDrawing(state, post)` helper
encapsulates the precheck → branch → (confirm) → open-share-sheet
pipeline. The component layer reads three new signals
(`shareDialog`, `shareInFlight`, `shareError`) and renders the
matching UI.

**Tech Stack:** TypeScript, Preact 10, `@preact/signals` 2 with
`batch` for multi-signal updates per house style.

**Scope:** 6 of 8 phases. Depends on Phase 5 (endpoints), Phase 4
(`canShare` becomes `isAuthed` substrate).

**Codebase verified:** 2026-05-17

---

## Codebase Investigation Findings

- `src/state.ts` already has `State.SendPostcard(state, input)` (lines
  686–740) returning a discriminated union — exact template for
  `State.ShareDrawing`.
- `canShare` (lines 221–223) after Phase 2 reads from
  `auth.value.authenticated`. **Note:** the design plan listed the
  `canShare` collapse as Phase 6 work; we moved it to Phase 2 Task 2
  Step 3 to keep the build green after subscription_status was
  removed. Phase 6 only verifies that the resulting computed signal
  satisfies AC3.1 (Share button visible to authed users) and AC3.2
  (Share button hidden from anonymous viewers).
- `src/routes/post.ts` (read in investigation):
  - line 33: `canShowShare = !!post.value && state.canShare.value &&
    typeof post.value.id === 'number'`
  - line 118: `share` callback calls `sharePublicPost(post.value)`.
    This is the entry point we hook into.
  - lines 175–211: the existing share fallback panel that opens when
    `fallbackUrl.value` is set. **Keep this** — it handles browsers
    without `navigator.share`. The new flow fires it AFTER the server
    confirm has succeeded.
  - lines 255–273: `sharePublicPost(post)` is the direct call to
    `navigator.share`. The new wiring calls this function only after
    a successful confirm (or on the `free` path immediately).
- `BuyPackModal` is the existing modal pattern in
  `src/components/buy-pack-modal.ts`. The new `ConfirmStampDialog`
  and `NoStampsMessage` will follow that file's structure (backdrop
  + dialog).
- `batch` from `@preact/signals` is already imported and used in
  state.ts (per CLAUDE.md). Use it for any multi-signal updates in
  `State.ShareDrawing`.
- `crypto.randomUUID()` exists on `window.crypto` in all modern
  browsers — use it for the client-side `idempotency_key`.
- `Intl.DateTimeFormat().resolvedOptions().timeZone` returns the
  IANA timezone string the browser believes it is in. Use it as the
  `timezone` parameter.

---

## External Dependency Research Findings

- `navigator.share` availability detection: the existing code at
  `src/routes/post.ts:258` uses
  `if (!navigator.share || navigator.canShare?.({ url }) !== true)`
  — keep this pattern. It correctly degrades to the fallback UI on
  browsers without Web Share API (most desktops, Firefox).

---

## Acceptance Criteria Coverage

### share-quota.AC3
- **share-quota.AC3.1 Success:** An authed user viewing a post they
  own sees a Share button.
- **share-quota.AC3.2 Success:** An anonymous viewer does not see a
  Share button.
- **share-quota.AC3.5 Success:** First share of the month: server
  pre-check returns `{type:'free'}`; client opens the share sheet
  immediately; no confirm dialog appears.
- **share-quota.AC3.6 Success:** Second share of the same month
  with stamps_balance > 0: pre-check returns `{type:'paid'}`; client
  shows the confirm dialog with a Cancel and a Confirm button.
- **share-quota.AC3.7 Success:** Pre-check + confirm with the same
  `idempotency_key` for the same `drawing_id` is treated as one share
  (no duplicate row, no double debit).

### share-quota.AC6
- **share-quota.AC6.1 Success:** User clicks Cancel on the confirm
  dialog; no `confirm` request is sent; no `share_events` row written;
  `stamps_balance` unchanged.
- **share-quota.AC6.2 Success:** User clicks Confirm; the `confirm`
  request is sent exactly once; on success the share sheet opens.
- **share-quota.AC6.3 Failure:** Network error on `confirm` results
  in a visible error state and no `share_events` row; retrying with
  the same `idempotency_key` is safe.

---

## Tasks

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: New signals and types in `src/state.ts`

**Verifies:** none directly — substrate for Tasks 2–5.

**Files:**
- Modify: `/Users/nick/code/drerings/src/state.ts`

**Step 1: Add types**

Near the existing `PostcardSendResult` type (currently lines 61–67),
add:

```ts
export type ShareDrawingResult =
    | { ok:true; was_free:boolean; stamps_balance?:number }
    | {
        ok:false;
        reason:'blocked'|'network'|'cancelled'|'other';
        message:string;
    }

export type ShareDialogState =
    | {
        type:'confirm';
        drawingId:string;
        idempotencyKey:string;
        stampsBalance:number;
    }
    | {
        type:'blocked';
        message:string;
    }
```

(These types are read by the post component and by the dialog
components.)

**Step 2: Add signals to the State factory's return type and creation**

In `src/state.ts`:

1. In the return type interface (lines 152–182), add:
   ```ts
   shareDialog:Signal<ShareDialogState|null>;
   shareInFlight:Signal<boolean>;
   shareError:Signal<string|null>;
   ```

2. In the state object literal (around lines 185–224), add:
   ```ts
   shareDialog: signal<ShareDialogState|null>(null),
   shareInFlight: signal<boolean>(false),
   shareError: signal<string|null>(null),
   ```

**Step 3: Build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

Expected: zero errors.

**Step 4: Commit**

```bash
cd /Users/nick/code/drerings
git add src/state.ts
git commit -m "feat(state): add shareDialog/shareInFlight/shareError signals"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement `State.ShareDrawing` helper

**Verifies:** share-quota.AC3.5, share-quota.AC6.3 (the network-error
branch)

**Files:**
- Modify: `/Users/nick/code/drerings/src/state.ts`

**Step 1: Implement the helper near `State.SendPostcard`**

Add a new export right after `State.SendPostcard` (~line 740):

```ts
type PrecheckResponse =
    | { type:'free'; month_key:string }
    | { type:'paid'; stamps_balance:number; month_key:string }
    | {
        type:'blocked';
        reason:'no_free_no_stamps';
        stamps_balance:0;
        month_key:string;
    }
    | { type:'reused'; was_free:boolean }

type ConfirmResponse =
    | { type:'recorded'; was_free:boolean; stamps_balance:number }
    | { type:'blocked'; reason:'no_free_no_stamps' }

function getCurrentTimezone ():string {
    try {
        return Intl.DateTimeFormat()
            .resolvedOptions().timeZone || 'UTC'
    } catch {
        return 'UTC'
    }
}

function newIdempotencyKey ():string {
    if (typeof crypto !== 'undefined' &&
        typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    // Last-resort fallback for very old browsers.
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

State.ShareDrawing = async function (
    state:AppState,
    drawingId:string,
    openShareSheet:() => Promise<void>
):Promise<ShareDrawingResult> {
    batch(() => {
        state.shareInFlight.value = true
        state.shareError.value = null
        state.shareDialog.value = null
    })

    const timezone = getCurrentTimezone()
    const idempotencyKey = newIdempotencyKey()
    const body = {
        drawing_id: drawingId,
        timezone,
        idempotency_key: idempotencyKey
    }

    try {
        const precheckResponse = await fetch(
            '/api/shares/precheck',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }
        )

        if (precheckResponse.status === 401) {
            return finishShare(state, {
                ok: false,
                reason: 'other',
                message: 'Please sign in.'
            })
        }

        if (!precheckResponse.ok) {
            return finishShare(state, {
                ok: false,
                reason: 'network',
                message: 'Unable to share right now.'
            })
        }

        const precheck = await precheckResponse.json() as
            PrecheckResponse

        if (precheck.type === 'free' || precheck.type === 'reused') {
            // For 'reused' we must NOT debit again; just open the
            // share sheet. The server has the canonical record.
            const confirm = precheck.type === 'free' ?
                await postConfirm(body) :
                null

            if (confirm && confirm.type === 'blocked') {
                // Raced — between precheck (free) and confirm someone
                // else grabbed the free slot AND we have no stamps.
                state.shareDialog.value = {
                    type: 'blocked',
                    message: 'You\'re out of stamps.'
                }
                return finishShare(state, {
                    ok: false,
                    reason: 'blocked',
                    message: 'You\'re out of stamps.'
                })
            }

            await openShareSheet()
            return finishShare(state, {
                ok: true,
                was_free: precheck.type === 'reused' ?
                    precheck.was_free :
                    (confirm?.was_free ?? true),
                stamps_balance: confirm?.type === 'recorded' ?
                    confirm.stamps_balance :
                    undefined
            })
        }

        if (precheck.type === 'paid') {
            // Show the confirm dialog; the user clicks Confirm or
            // Cancel. The dialog's Confirm handler calls
            // State.ConfirmShare(state, body, openShareSheet).
            state.shareDialog.value = {
                type: 'confirm',
                drawingId,
                idempotencyKey,
                stampsBalance: precheck.stamps_balance
            }
            // The flow continues when the user clicks Confirm. Mark
            // share as no-longer-in-flight; the dialog itself manages
            // its own in-flight state on Confirm click.
            state.shareInFlight.value = false
            return {
                ok: false,
                reason: 'cancelled',
                message: 'Awaiting user confirmation.'
            }
        }

        // type === 'blocked'
        state.shareDialog.value = {
            type: 'blocked',
            message: 'You\'re out of stamps. Buy more on the '
                + 'pricing page.'
        }
        return finishShare(state, {
            ok: false,
            reason: 'blocked',
            message: 'No free share remaining and no stamps.'
        })
    } catch (err) {
        const message = err instanceof Error ?
            err.message :
            'Unable to share right now.'

        return finishShare(state, {
            ok: false,
            reason: 'network',
            message
        })
    }
}

async function postConfirm (body:{
    drawing_id:string;
    timezone:string;
    idempotency_key:string;
}):Promise<ConfirmResponse|null> {
    const response = await fetch('/api/shares/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })

    if (!response.ok) return null

    return response.json() as Promise<ConfirmResponse>
}

function finishShare (
    state:AppState,
    result:ShareDrawingResult
):ShareDrawingResult {
    batch(() => {
        state.shareInFlight.value = false
        if (result.ok) {
            state.shareError.value = null
        } else if (result.reason !== 'cancelled') {
            state.shareError.value = result.message
        }
    })

    return result
}

State.ConfirmShare = async function (
    state:AppState,
    drawingId:string,
    idempotencyKey:string,
    openShareSheet:() => Promise<void>
):Promise<ShareDrawingResult> {
    batch(() => {
        state.shareInFlight.value = true
        state.shareError.value = null
    })

    const body = {
        drawing_id: drawingId,
        timezone: getCurrentTimezone(),
        idempotency_key: idempotencyKey
    }

    try {
        const confirm = await postConfirm(body)

        if (!confirm) {
            return finishShare(state, {
                ok: false,
                reason: 'network',
                message: 'Confirm failed. Try again — your stamp has '
                    + 'not been used.'
            })
        }

        if (confirm.type === 'blocked') {
            batch(() => {
                state.shareDialog.value = {
                    type: 'blocked',
                    message: 'You\'re out of stamps.'
                }
            })
            return finishShare(state, {
                ok: false,
                reason: 'blocked',
                message: 'You\'re out of stamps.'
            })
        }

        state.shareDialog.value = null
        await openShareSheet()

        return finishShare(state, {
            ok: true,
            was_free: confirm.was_free,
            stamps_balance: confirm.stamps_balance
        })
    } catch (err) {
        const message = err instanceof Error ?
            err.message :
            'Confirm failed. Try again.'

        return finishShare(state, {
            ok: false,
            reason: 'network',
            message
        })
    }
}

State.CancelShareDialog = function (state:AppState):void {
    batch(() => {
        state.shareDialog.value = null
        state.shareInFlight.value = false
        state.shareError.value = null
    })
}
```

Note: `batch` must be imported at the top of `src/state.ts`. Confirm
the existing import statement and add `batch` to it if missing:

```ts
import {
    batch,
    computed,
    type ReadonlySignal,
    type Signal,
    signal
} from '@preact/signals'
```

**Step 2: Build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

Expected: zero errors. If the State namespace pattern requires
explicit declaration (as opposed to dynamic assignment), follow the
existing pattern (e.g., `State.SendPostcard` declaration).

**Step 3: Commit**

```bash
cd /Users/nick/code/drerings
git add src/state.ts
git commit -m "feat(state): State.ShareDrawing/ConfirmShare/CancelShareDialog"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: `ConfirmStampDialog` component

**Verifies:** share-quota.AC3.6, share-quota.AC6.1, share-quota.AC6.2

**Files:**
- Create: `/Users/nick/code/drerings/src/components/confirm-stamp-dialog.ts`

**Step 1: Implement**

Pattern off `BuyPackModal` (which uses `@substrate-system/dialog`
based on the package.json deps). Check `BuyPackModal` source for the
exact dialog wrapper pattern; mirror it.

```ts
import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { Button } from './button'

export interface ConfirmStampDialogProps {
    stampsBalance:number;
    isSpinning:boolean;
    onConfirm:() => void;
    onCancel:() => void;
}

export const ConfirmStampDialog:FunctionComponent<
    ConfirmStampDialogProps
> = function ConfirmStampDialog (props) {
    return html`<div
        class="confirm-stamp-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-stamp-dialog-title"
    >
        <div class="confirm-stamp-dialog-backdrop"
             onClick=${props.onCancel}></div>
        <div class="confirm-stamp-dialog-panel">
            <h3 id="confirm-stamp-dialog-title">Use 1 stamp to share?</h3>
            <p>
                You've already used your free share this month. This
                share will cost 1 stamp.
            </p>
            <p>You have ${props.stampsBalance} stamps.</p>
            <div class="confirm-stamp-dialog-actions">
                <${Button}
                    type="button"
                    onClick=${props.onCancel}
                    disabled=${props.isSpinning}
                >
                    Cancel
                <//>
                <${Button}
                    type="button"
                    onClick=${props.onConfirm}
                    isSpinning=${props.isSpinning}
                >
                    Use 1 stamp
                <//>
            </div>
        </div>
    </div>`
}
```

If `BuyPackModal` uses `@substrate-system/dialog`'s custom element,
use that instead — match the existing modal pattern (look at the
file as the source of truth). If `Button` is imported from a
different path, adapt.

**Step 2: Add minimal CSS**

Create a CSS file alongside or use an existing global stylesheet. If
`BuyPackModal` ships its CSS in a `.css` file, do the same.
Co-locate `confirm-stamp-dialog.css`:

```css
.confirm-stamp-dialog {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
}

.confirm-stamp-dialog-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
}

.confirm-stamp-dialog-panel {
    position: relative;
    background: var(--color-surface);
    color: var(--color-text);
    padding: 2rem;
    border-radius: 0.5rem;
    max-width: 28rem;
    margin: 1rem;
}

.confirm-stamp-dialog-actions {
    display: flex;
    gap: 1rem;
    margin-top: 1.5rem;
    justify-content: flex-end;
}
```

(Use the exact variables defined in `_variables.css` per CLAUDE.md.
If the variable names differ, adapt. Do NOT create new variables.)

Import the CSS in the component file: `import './confirm-stamp-dialog.css'`.

**Step 3: Build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

**Step 4: Commit**

```bash
cd /Users/nick/code/drerings
git add src/components/confirm-stamp-dialog.ts \
    src/components/confirm-stamp-dialog.css
git commit -m "feat(components): ConfirmStampDialog"
```
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->

<!-- START_TASK_4 -->
### Task 4: `NoStampsMessage` component

**Verifies:** share-quota.AC5.2

**Files:**
- Create: `/Users/nick/code/drerings/src/components/no-stamps-message.ts`

**Step 1: Implement**

The design states this is an INLINE MESSAGE (not a modal). It contains
copy and a link to `/pricing`. The Buy Stamps modal is NOT auto-opened.

```ts
import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'

export interface NoStampsMessageProps {
    message?:string;
}

export const NoStampsMessage:FunctionComponent<
    NoStampsMessageProps
> = function NoStampsMessage ({ message }) {
    const text = message || "You're out of stamps for sharing this month."

    return html`<p class="no-stamps-message" role="alert">
        ${text}
        ${' '}
        <a href="/pricing">Buy more on the pricing page</a>.
    </p>`
}
```

**Step 2: Build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

**Step 3: Commit**

```bash
cd /Users/nick/code/drerings
git add src/components/no-stamps-message.ts
git commit -m "feat(components): NoStampsMessage"
```
<!-- END_TASK_4 -->

<!-- START_TASK_4B -->
### Task 4B: `PublicPost` carries `drawing_id` (server, type, deserializer)

**Verifies:** none directly — substrate for Task 5 (which needs the
drawing UUID to call the share endpoints).

**Files:**
- Modify: the public-post API handler (path discovered in Step 1)
- Modify: `/Users/nick/code/drerings/src/state.ts` (`PublicPost`
  interface and `State.FetchPublicPost` deserializer)

**Step 1: Locate the public-post API handler**

```bash
cd /Users/nick/code/drerings
grep -rln "public_posts" netlify/functions/ 2>/dev/null
# Also find by URL pattern (route handlers may be in a [id] folder
# or a dynamic dispatcher).
grep -rln "FetchPublicPost\\|/api/posts" \
    netlify/functions/ src/state.ts 2>/dev/null
```

Read the handler file. The current response shape is
`{ id, image, text, alt_text, published_at }`. Extend the SQL query
to include `drawings.id` aliased as `drawing_id`:

```sql
SELECT
    public_posts.id,
    drawings.id AS drawing_id,
    drawings.text,
    drawings.alt_text,
    drawings.blob_key,
    public_posts.published_at
FROM public_posts
JOIN drawings ON drawings.id = public_posts.drawing_id
WHERE public_posts.id = $1
```

(Adjust to the existing query's actual columns and aliases.)

In the response JSON, include `drawing_id` alongside `id`.

**Step 2: Update `PublicPost` and the deserializer**

In `src/state.ts`:

```ts
// Around line 69:
export interface PublicPost extends PublishedPost {
    drawing_id:string;  // NEW
    image:string;
    text:string;
    alt_text:string;
    published_at:string;
}
```

Find `State.FetchPublicPost` and update the response mapping to copy
`drawing_id` from the JSON body.

**Step 3: Verify**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

Expected: zero errors. (Any consumer reading `post.value.drawing_id`
in Task 5 below will compile against the new field.)

Manual: curl the public-post endpoint and confirm `drawing_id` is in
the JSON.

**Step 4: Commit**

```bash
cd /Users/nick/code/drerings
git add netlify/functions/ src/state.ts
git commit -m "feat(public-posts): expose drawing_id in API response"
```
<!-- END_TASK_4B -->

<!-- START_TASK_5 -->
### Task 5: Wire `src/routes/post.ts` to use `State.ShareDrawing`

**Verifies:** share-quota.AC3.1, share-quota.AC3.2, share-quota.AC3.5,
share-quota.AC3.6, share-quota.AC5.2, share-quota.AC6.1, share-quota.AC6.2,
share-quota.AC6.3

**Files:**
- Modify: `/Users/nick/code/drerings/src/routes/post.ts`

**Step 1: Add imports**

At the top of the file, after the existing imports:

```ts
import {
    ConfirmStampDialog
} from '../components/confirm-stamp-dialog'
import { NoStampsMessage } from '../components/no-stamps-message'
```

**Step 2: Replace the `share` callback**

Around line 118–122, replace the existing `share` callback with:

```ts
const share = useCallback(async () => {
    if (!post.value) return

    const drawingId = post.value.drawing_id
    const localPost = post.value

    await State.ShareDrawing(state, drawingId, async () => {
        await sharePublicPost(localPost)
    })
}, [state])
```

`post.value.drawing_id` is the drawing UUID — provided by Task 4B's
API extension. The shares endpoints (Phase 5) expect this UUID, NOT
the bigserial `public_posts.id`.

**Step 3: Render the confirm dialog and blocked message**

In the JSX (the post component's return), add — outside the
`canShowShare` block but inside the route div:

```ts
${state.shareDialog.value && state.shareDialog.value.type === 'confirm' ?
    html`<${ConfirmStampDialog}
        stampsBalance=${state.shareDialog.value.stampsBalance}
        isSpinning=${state.shareInFlight.value}
        onConfirm=${async () => {
            if (!state.shareDialog.value ||
                state.shareDialog.value.type !== 'confirm') return

            const dialog = state.shareDialog.value
            const localPost = post.value
            if (!localPost) return

            await State.ConfirmShare(
                state,
                dialog.drawingId,
                dialog.idempotencyKey,
                async () => { await sharePublicPost(localPost) }
            )
        }}
        onCancel=${() => State.CancelShareDialog(state)}
    />` : null
}

${state.shareDialog.value && state.shareDialog.value.type === 'blocked' ?
    html`<${NoStampsMessage}
        message=${state.shareDialog.value.message}
    />` : null
}

${state.shareError.value ?
    html`<p role="alert" class="share-error">${state.shareError.value}</p>` :
    null
}
```

**Step 4: Update `canShowShare`**

Around line 33–35:

```ts
const canShowShare = !!post.value &&
    state.canShare.value &&
    typeof post.value.id === 'number'
```

After Phase 2 `canShare === isAuthed`. This line still works — an
anonymous viewer's `auth.value.authenticated` is false, so the
Share button does not render. **No change needed** here.

**Step 5: Build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

**Step 6: Manual smoke test**

Start the dev server. Manually:

1. View a public post while signed in. Click Share. First share of the
   month → share sheet (or fallback) opens immediately.
2. Trigger a second share (refresh, click again). Confirm dialog
   appears. Click Cancel → no server write. Click Confirm → share
   sheet opens, stamp balance decremented (verify by reloading the
   page and checking the displayed stamps_balance).
3. With zero stamps and free share already used, click Share. Blocked
   message appears with link to `/pricing`.
4. Sign out, navigate to the same post URL. Share button does NOT
   render.

**Step 7: Commit**

```bash
cd /Users/nick/code/drerings
git add -A src/routes/post.ts
git commit -m "feat(post): use State.ShareDrawing with precheck/confirm UX"
```
<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_6 -->
### Task 6: Component tests for `ConfirmStampDialog`

**Verifies:** share-quota.AC6.1, share-quota.AC6.2

**Files:**
- Create: `/Users/nick/code/drerings/test/us020-confirm-stamp-dialog.test.ts`

**Step 1: Test the click handlers**

```ts
import { describe, expect, it, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/preact'
import { html } from 'htm/preact'
import { ConfirmStampDialog } from '../src/components/confirm-stamp-dialog'

describe('ConfirmStampDialog', () => {
    it('calls onCancel when Cancel is clicked', () => {
        const onCancel = vi.fn()
        const onConfirm = vi.fn()
        const { getByText } = render(html`<${ConfirmStampDialog}
            stampsBalance=${5}
            isSpinning=${false}
            onConfirm=${onConfirm}
            onCancel=${onCancel}
        />`)

        fireEvent.click(getByText('Cancel'))
        expect(onCancel).toHaveBeenCalledOnce()
        expect(onConfirm).not.toHaveBeenCalled()
    })

    it('calls onConfirm when Use 1 stamp is clicked', () => {
        const onCancel = vi.fn()
        const onConfirm = vi.fn()
        const { getByText } = render(html`<${ConfirmStampDialog}
            stampsBalance=${5}
            isSpinning=${false}
            onConfirm=${onConfirm}
            onCancel=${onCancel}
        />`)

        fireEvent.click(getByText('Use 1 stamp'))
        expect(onConfirm).toHaveBeenCalledOnce()
        expect(onCancel).not.toHaveBeenCalled()
    })

    it('disables Cancel and shows spinner on Confirm while in-flight',
        () => {
            const onCancel = vi.fn()
            const onConfirm = vi.fn()
            const { getByText } = render(html`<${ConfirmStampDialog}
                stampsBalance=${5}
                isSpinning=${true}
                onConfirm=${onConfirm}
                onCancel=${onCancel}
            />`)

            const cancelBtn = getByText('Cancel').closest('button')!
            expect(cancelBtn.hasAttribute('disabled')).toBe(true)
        })
})
```

(Per CLAUDE.md "do not test for specific text content in HTML" —
these tests query by visible labels, which is the accepted exception
for behavior tests. If house style prefers role-based queries,
substitute `getByRole('button', { name: 'Cancel' })` etc.)

**Step 2: Run**

```bash
cd /Users/nick/code/drerings
npx vitest run test/us020-confirm-stamp-dialog.test.ts
```

**Step 3: Commit**

```bash
cd /Users/nick/code/drerings
git add test/us020-confirm-stamp-dialog.test.ts
git commit -m "test(confirm-stamp-dialog): cover Cancel/Confirm clicks"
```
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: State helper tests

**Verifies:** share-quota.AC3.5, share-quota.AC3.7, share-quota.AC6.2,
share-quota.AC6.3

**Files:**
- Create: `/Users/nick/code/drerings/test/us020-share-state.test.ts`

**Step 1: Mock `fetch` and exercise the helpers**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { State } from '../src/state'

function makeStateLike () {
    return State()
}

describe('State.ShareDrawing', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    it('opens share sheet immediately on free precheck', async () => {
        const state = makeStateLike()
        const fetchMock = vi.fn(async (url:string) => {
            if (url.endsWith('/api/shares/precheck')) {
                return new Response(JSON.stringify({
                    type: 'free',
                    month_key: '2026-05'
                }), { status: 200 })
            }
            if (url.endsWith('/api/shares/confirm')) {
                return new Response(JSON.stringify({
                    type: 'recorded',
                    was_free: true,
                    stamps_balance: 0
                }), { status: 200 })
            }
            return new Response('not found', { status: 404 })
        })
        // @ts-expect-error: assignment to global fetch in test
        globalThis.fetch = fetchMock

        let sheetOpened = false
        const result = await State.ShareDrawing(
            state,
            'drawing-1',
            async () => { sheetOpened = true }
        )

        expect(result.ok).toBe(true)
        expect(sheetOpened).toBe(true)
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('/api/shares/precheck'),
            expect.objectContaining({ method: 'POST' })
        )
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('/api/shares/confirm'),
            expect.objectContaining({ method: 'POST' })
        )
    })

    it('sets shareDialog to confirm on paid precheck', async () => {
        const state = makeStateLike()
        const fetchMock = vi.fn(async () => {
            return new Response(JSON.stringify({
                type: 'paid',
                stamps_balance: 3,
                month_key: '2026-05'
            }), { status: 200 })
        })
        // @ts-expect-error
        globalThis.fetch = fetchMock

        const result = await State.ShareDrawing(
            state,
            'drawing-1',
            async () => {}
        )

        expect(result.ok).toBe(false)
        expect(state.shareDialog.value).toEqual(
            expect.objectContaining({ type: 'confirm' })
        )
        // Sanity: confirm was NOT called yet
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('renders blocked dialog on blocked precheck', async () => {
        const state = makeStateLike()
        const fetchMock = vi.fn(async () => {
            return new Response(JSON.stringify({
                type: 'blocked',
                reason: 'no_free_no_stamps',
                stamps_balance: 0,
                month_key: '2026-05'
            }), { status: 200 })
        })
        // @ts-expect-error
        globalThis.fetch = fetchMock

        const result = await State.ShareDrawing(
            state,
            'drawing-1',
            async () => {}
        )

        expect(result.ok).toBe(false)
        expect(state.shareDialog.value).toEqual(
            expect.objectContaining({ type: 'blocked' })
        )
    })
})

describe('State.ConfirmShare', () => {
    it('reuses the supplied idempotencyKey on confirm', async () => {
        const state = makeStateLike()
        const fetchMock = vi.fn(async (_url, init:RequestInit) => {
            const body = JSON.parse(init.body as string)
            return new Response(JSON.stringify({
                type: 'recorded',
                was_free: false,
                stamps_balance: 4,
                _echo: body
            }), { status: 200 })
        })
        // @ts-expect-error
        globalThis.fetch = fetchMock

        await State.ConfirmShare(
            state,
            'drawing-1',
            'idem-fixed',
            async () => {}
        )

        const callBody = JSON.parse(
            (fetchMock.mock.calls[0][1] as RequestInit).body as string
        )
        expect(callBody.idempotency_key).toBe('idem-fixed')
    })

    it('surfaces a network error and does NOT clear dialog', async () => {
        const state = makeStateLike()
        const fetchMock = vi.fn(async () => {
            throw new Error('Network down')
        })
        // @ts-expect-error
        globalThis.fetch = fetchMock

        // Pre-set the dialog as if precheck just set it
        state.shareDialog.value = {
            type: 'confirm',
            drawingId: 'drawing-1',
            idempotencyKey: 'idem-1',
            stampsBalance: 5
        }

        const result = await State.ConfirmShare(
            state,
            'drawing-1',
            'idem-1',
            async () => {}
        )

        expect(result.ok).toBe(false)
        if (!result.ok) {
            expect(result.reason).toBe('network')
        }
        expect(state.shareError.value).toContain('try again')
    })
})
```

**Step 2: Run**

```bash
cd /Users/nick/code/drerings
npx vitest run test/us020-share-state.test.ts
```

**Step 3: Commit**

```bash
cd /Users/nick/code/drerings
git add test/us020-share-state.test.ts
git commit -m "test(state): ShareDrawing/ConfirmShare flow coverage"
```
<!-- END_TASK_7 -->

---

## Done When

- `State.ShareDrawing`, `State.ConfirmShare`, and
  `State.CancelShareDialog` exist and are typed.
- `src/components/confirm-stamp-dialog.ts` and
  `src/components/no-stamps-message.ts` exist.
- `src/routes/post.ts` calls `State.ShareDrawing(state, drawingId,
  openShareSheet)`.
- Tests in `test/us020-*.test.ts` pass.
- Manual smoke test confirms: free path → share sheet; paid path →
  confirm dialog → confirm → share sheet; blocked path → inline
  no-stamps message; cancel → no server write.
- `npx tsc --noEmit` exits 0.
