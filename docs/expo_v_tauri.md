# Expo vs Tauri

For a **phones-first drawing-share app**, go **Expo**.

Why: you’ll ship to iOS/Android fast, get push notifications + deep linking +
camera/media permissions out of the box, and you can do **OTA updates** for
JS/asset tweaks without resubmitting to the stores. Tauri is great—especially
for desktop—but you’d be swimming upstream on mobile compared to Expo’s
tooling and docs.

# A practical starter stack (Expo)

**UI & drawing**

* **Expo + React Native** with **Expo Router** for navigation.
* **@shopify/react-native-skia** for a buttery drawing surface (brush,
  eraser, layers, export to PNG).
* **react-native-gesture-handler** for multi-touch, pinch-zoom, pan.

**Auth & backend**

* **Supabase** (email/Passkeys, Realtime, Postgres, Storage) *or* your
  existing **PartyKit** rooms if you want custom WebSocket logic.

  * If you want collaborative doodles, your Automerge background is
    perfect: store a CRDT doc per canvas; sync via PartyKit.

**Sharing**

* **Deep links** with Expo (universal links + app links) to open a
  specific drawing or "room".
* **Expo Push Notifications** so people get pinged when a friend shares
  or updates a drawing.

**Media & storage**

* Export Skia canvas → PNG/WEBP, upload to **Supabase Storage**
  (or S3/R2).
* Keep a lightweight JSON (or CRDT) record for strokes so you can
  re-render/edit without big images.

**MVP data model**

* `users(id, handle, avatar_url)`
* `drawings(id, owner_id, created_at, visibility, latest_image_url)`
* `strokes(drawing_id, seq, tool, color, width, points[])` (or a single CRDT doc)
* `shares(drawing_id, to_user_id | public_link_token)`

# Dev notes & gotchas

* **Performance**: batch strokes; don't set state on every point—buffer
  points and commit at ~60–120 Hz.
* **Image sizes**: cap canvas resolution; export with WEBP for feed
  thumbnails.
* **Offline-first**: queue strokes locally; sync on reconnect. CRDTs
  make merge painless.
* **Moderation** (App Store rule): add report/block + basic rate
  limiting for public rooms.
* **OTA limits**: Expo OTA can't change native modules; pin a runtime
  version and roll out via release channels.

# Tiny roadmap (2–3 days MVP)

1. `npx create-expo-app drawings` → add Expo Router.
2. Add Skia; implement freehand brush + undo/redo; snapshot to image.
3. Auth (Supabase) + upload snapshots to Storage.
4. Realtime: subscribe to a room; broadcast strokes
   (PartyKit or Supabase Realtime).
5. Deep link: `mydraw://d/:id` opens a drawing.
6. Push: notify when someone you follow shares or updates a drawing.
7. Ship test builds with **EAS Build**; ship tweaks with **EAS Update**.

# Example deps to install

```bash
# core
npx create-expo-app drawings
cd drawings
npx expo install expo-router react-native-gesture-handler expo-linking \
  expo-notifications
# drawing
npx expo install @shopify/react-native-skia
# backend (pick one)
npm i @supabase/supabase-js
# or PartyKit client if you roll your own WS
npm i partysocket
```

If you want, I can drop in a minimal Skia canvas screen with export +
upload, and a PartyKit room that rebroadcasts strokes so two phones can
draw together in real time.

