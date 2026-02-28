# Drerings — Application Specification

**Drawings for friends.**

Drerings is a client-side web app (SPA) where users draw on an HTML
canvas and publish their drawings as posts on the Bluesky social network
(AT Protocol). A shared feed aggregates all drawings posted through the
app.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Architecture Overview](#architecture-overview)
- [Authentication](#authentication)
- [State Model](#state-model)
- [Routes](#routes)
- [Drawing Canvas](#drawing-canvas)
- [Posting](#posting)
- [Feed](#feed)
- [Like Counts](#like-counts)
- [Moderation](#moderation)
- [Serverless Functions](#serverless-functions)
- [Deployment](#deployment)
- [Environment Variables](#environment-variables)

---

## Tech Stack

| Layer         | Library / Tool                              |
|---------------|---------------------------------------------|
| UI framework  | Preact 10 + `htm/preact` (no JSX compiler)  |
| Reactivity    | `@preact/signals`                           |
| Drawing       | `@substrate-system/atrament` (canvas)       |
| Routing       | `@substrate-system/routes` + `route-event`  |
| AT Protocol   | `@atproto/api`, `@atproto/oauth-client-browser` |
| HTTP state    | `@substrate-system/state` (`RequestState`)  |
| Build         | Vite + `@preact/preset-vite`                |
| Hosting       | Netlify (static site + Functions)           |
| Language      | TypeScript (strict)                         |

---

## Architecture Overview

```
Browser
  └── Preact SPA (src/)
        ├── State (signals)        <- single global object
        ├── Router                 <- maps URL to route component
        └── Routes
              ├── HomeRoute        /
              ├── FeedRoute        /feed
              ├── LoginRoute       /login
              ├── WhoamiRoute      /whoami
              ├── ContactRoute     /contact
              └── ColophonRoute    /colophon

Netlify Functions
  ├── auth.ts          OAuth helper (client metadata, PAR, PKCE)
  └── constellation.ts Like-count aggregation for feed posts
```

There is no custom database. All user-generated content lives on
Bluesky as AT Protocol records. The app reads and writes those records
via the AT Protocol API using an OAuth session.

---

## Authentication

The app uses **Bluesky OAuth** (PKCE + PAR) via
`@atproto/oauth-client-browser`.

### Flow

1. User enters their Bluesky handle on `/login`.
2. `State.login` calls `client.signInRedirect`, which:
   - Performs OAuth server discovery.
   - Sends a Pushed Authorization Request (PAR).
   - Redirects the browser to `bsky.social/oauth/authorize`.
3. Bluesky redirects back to `/login` with `code` + `state` params.
4. `State.finishOAuth` calls `client.initCallback`, exchanges the code
   for a session, then hydrates the agent and user profile.

### Session Restore

On every page load, `State.fetchAuthStatus` calls `client.initRestore`.
If a valid session exists (stored in `localStorage` by the AT Protocol
client library), the agent is hydrated silently.

### Logout

`State.Logout` revokes the OAuth token via `client.revoke(did)` and
resets all auth-related signals to their default values.

### Local Dev Note

Bluesky requires OAuth callbacks to use `127.0.0.1`, not `localhost`.
The `LoginRoute` automatically redirects `localhost` → `127.0.0.1` on
page load.

---

## State Model

All mutable state lives in a single object returned by `State()` in
`src/state.ts`. Reactivity is handled by Preact signals.

```typescript
{
    route:             Signal<string>
    auth:              Signal<AuthStatus>
    authLoading:       Signal<boolean>
    isAuthed:          ReadonlySignal<boolean>   // computed
    agent:             Signal<Agent|null>
    profile:           Signal<UserState|null>
    postReq:           Signal<RequestFor<{ uri, cid }, Error>>
    feedReq:           Signal<RequestFor<FeedPost[], Error>>
    feedCursor:        Signal<string|null>
    feedPageIndex:     Signal<number>
    feedPageCursors:   Signal<Array<string|null>>
    feedLikeCounts:    Signal<FeedLikeCounts>   // Record<uri, count>
}
```

`RequestState` (from `@substrate-system/state`) models async operations
with `{ pending, data, error }` shape, updated via `start`, `set`, and
`error` helpers.

---

## Routes

| Path        | Component       | Auth required | Description                  |
|-------------|-----------------|---------------|------------------------------|
| `/`         | `HomeRoute`     | No (draw only; post needs auth) | Drawing canvas + post form |
| `/feed`     | `FeedRoute`     | Yes           | Paginated feed of all drerings |
| `/login`    | `LoginRoute`    | No            | Bluesky OAuth login page     |
| `/whoami`   | `WhoamiRoute`   | Yes           | Logged-in user profile       |
| `/contact`  | `ContactRoute`  | No            | Contact information          |
| `/colophon` | `ColophonRoute` | No            | About / credits              |

The router matches the current `state.route` signal and renders the
matching component. Unmatched paths render a 404 `<div>`.

Navigation `<header>` links are defined in `src/routes/index.ts`:

```typescript
export const routes = [
    { href: '/', text: 'Home' },
    { href: '/colophon', text: 'About' }
]
```

---

## Drawing Canvas

The home route renders a `<canvas id="sketchpad">` wired up to an
`Atrament` instance from `@substrate-system/atrament`.

### Initialization

```ts
atrament = new Atrament(canvas, {
    width: side,   // square: min(offsetWidth, offsetHeight)
    height: side,
    ignoreModifiers: true,
    fill               // web worker for fill tool
})
atrament.smoothing = 0.7
```

The canvas is sized to the largest square that fits in its container.

### Dirty State

Atrament emits `dirty` / `clean` events. The `isCanvasDirty` signal
tracks whether the user has drawn anything. The Post button is disabled
until the canvas is dirty.

### Brush Color Picker

The home route includes a native in-app color picker UI (no third-party
picker dependency):

- `<input type="color">` for arbitrary color selection.
- Preset swatch buttons for quick selection.
- Live updates to `atrament.color` as the selected color changes.

Default brush color is `#000000` on page load.

### Brush Size Control

The home route should include a native brush size control so users can
change stroke thickness while drawing.

#### UX

- Use a single `<input type="range">` control labeled `Brush size`.
- Show the current numeric value next to the slider.
- Keep the control in the same form area as existing brush controls.

#### Behavior

- Control value updates `atrament.weight` live on input.
- Size changes affect subsequent strokes only.
- Default brush size on page load is `4`.
- Allowed range is `1` to `40` with step `1`.
- No persistence: brush size resets to default on fresh page load.

#### State Scope

- Keep brush size state local to `HomeRoute`.
- Do not add brush size to global app state in `src/state.ts`.

#### Accessibility

- The range input must have an associated visible label.
- The current value must be visible as text, not color-only or gesture-only.

#### Acceptance Criteria

1. On first load, drawing uses weight `4`.
2. Moving the slider updates `atrament.weight` without page reload.
3. Drawing after slider change shows visibly thicker/thinner strokes.
4. Post/login/feed flows continue to behave exactly as before.
5. Reloading the page resets brush size to the default value.

### Image Export

Before posting, the canvas is exported via `canvasToSquareBlob`:

1. If the canvas is already square, call `canvas.toBlob(PNG)` directly.
2. Otherwise, paint the canvas centred on a white square canvas of side
   `max(width, height)`, then export that.

Output format: `image/png`.

---

## Posting

`State.post(state, text?, imageBlob?, altText?)` publishes a drawing
to Bluesky.

### Record Shape

```typescript
{
    text:      string,          // user text or default "New drering from @{handle}"
    createdAt: string,          // ISO 8601
    tags:      ['drering'],     // invisible tag used for feed search
    embed?: {
        $type: 'app.bsky.embed.images',
        images: [{ alt: string, image: BlobRef }]
    }
}
```

### Steps

1. Upload image bytes via `agent.uploadBlob(bytes, { encoding })`.
2. Build the post record (above).
3. Call `agent.post(record)`.
4. Store `{ uri, cid }` in `state.postReq`.

### UI State

- Post button is disabled while `postReq.pending` is `true` or the
  canvas is clean.
- On success, a success banner links to the post on `bsky.app`.
- On error, an error banner shows the message.
- After a successful post, the canvas is cleared and the form is reset.

---

## Feed

`/feed` shows all Bluesky posts tagged `#drering`, sorted by latest.

### Fetching

`State.fetchFeed` uses:

```typescript
agent.app.bsky.feed.searchPosts({
    q: '#drering',
    sort: 'latest',
    limit: 20,
    cursor?: string
})
```

### Moderation Filtering

Each post is passed through `moderatePost` (from `@atproto/api`) with
the user's moderation preferences. Posts whose `contentList.filter` is
`true` (blocked / muted authors) are excluded from the rendered list.

### Pagination

Cursor-based, two directions:

- **next**: advance `feedPageIndex`, store the cursor for the new page
  in `feedPageCursors`, fetch with `cursor`.
- **prev**: decrement `feedPageIndex`, look up the stored cursor for
  that page index, fetch with it.
- **initial load**: reset index/cursors to zero/null, fetch without a
  cursor.

Pagination state is rolled back on error.

### Feed Post Display

Each post shows:
- Author avatar + handle (links to Bluesky profile)
- Post text
- Embedded image(s), if any
- Like count (from `/api/constellation/likes`)
- Moderation controls: block author, report post

---

## Like Counts

Like counts are not available directly from the search endpoint.
They are fetched in a separate step via the Netlify function
`/api/constellation/likes`.

`State.fetchFeedLikeCounts` builds a URL with all post URIs:

```
GET /api/constellation/likes?uri=at://...&uri=at://...
```

Response shape:

```json
{ "counts": { "at://...": 3, "at://...": 7 } }
```

Counts are stored in `state.feedLikeCounts` (`Record<uri, number>`).
Non-numeric or missing values are ignored.

---

## Moderation

Users can take two moderation actions from the feed:

### Block

`State.blockProfile(state, did)` creates a
`app.bsky.graph.block` record in the logged-in user's repo.

The UI shows a confirmation modal before executing. After blocking,
the blocked user's posts will be cleared by the moderation filter on
the next feed fetch.

### Report

Posts can be reported. This opens a modal that calls the AT Protocol
report API. (Implementation detail lives in `FeedRoute`.)

---

## Serverless Functions

Deployed on Netlify under `/api/*`.

### `netlify/functions/auth.ts`

Handles Bluesky OAuth plumbing that requires a server-side component:
- Serves client metadata JSON (required by AT Protocol OAuth).
- Manages PAR (Pushed Authorization Requests).
- Provides a PKCE code exchange endpoint.

### `netlify/functions/constellation.ts`

Aggregates like counts for a list of AT URIs.

```
GET /api/constellation/likes?uri=...&uri=...
→ { counts: { [uri]: number } }
```

This is needed because the Bluesky search API does not return like
counts inline, and fetching them post-by-post from the client would be
rate-limited and slow.

---

## Deployment

Hosted on Netlify.

- Static assets: `vite build` output in `public/`.
- Additional public files (`_headers`, `robots.txt`) copied from
  `_public/` during build.
- Functions: Netlify Functions (Node 20+) in `netlify/functions/`.
- Staging build: `vite build --mode staging`

`netlify.toml` configures function directories and redirect rules.

---

## Environment Variables

| Variable                 | Required | Description                                        |
|--------------------------|----------|----------------------------------------------------|
| `VITE_ALLOW_ANON_READS`  | No       | Allow unauthenticated access to `/` and `/lookup`  |
| `BSKY_OAUTH_SCOPE`       | No       | Override OAuth scope (default: `atproto transition:generic`) |
| `BSKY_OAUTH_CLIENT_NAME` | No       | OAuth client metadata `client_name`                |
| `BSKY_OAUTH_CLIENT_ORIGIN` | No     | Override client metadata origin (for ngrok/tunnel) |
