Short answer: **stay with the PWA**. For your use case — canvas drawing → share to Messages — the Web Share API does exactly what you need on both iOS and Android, and switching to Expo would be a significant rewrite for marginal benefit.

Let me lay out the reasoning, since the tradeoffs are real.

## Why PWA works here

Your core flow is: draw on canvas → export PNG → share. The web has all three:

1. **Canvas drawing** — already works, you've built it.
2. **PNG export** — `canvas.toBlob()` → `File`.
3. **Share to Messages** — `navigator.share({ files: [file] })` opens the native share sheet on iOS Safari and Android Chrome, with Messages as a target.

That's the whole pipeline. No native code needed.

The Web Share API with file support is well-supported on the mobile browsers that matter:
- iOS Safari 15+ (so iOS 15+, which is ~98%+ of active iOS devices)
- Android Chrome, Edge, Samsung Internet — all good
- The only real gap is desktop browsers, where you'd fall back to download/copy-link, but desktop users aren't trying to send SMS anyway

## Where Expo would actually win

It's worth being honest about what you'd gain by going native:

- **App Store presence** — discoverability via App Store / Play Store
- **Push notifications on iOS** — iOS has improved web push but native is still smoother
- **Better Pencil/stylus pressure** on iPad — Pointer Events in Safari do expose pressure, but native gets you closer to the metal
- **Background processing, deeper OS integration** — irrelevant for a drawing-and-share app
- **"App-like" feel** — though a well-built PWA installed to the home screen is nearly indistinguishable for this kind of app

None of these are essential for "draw a thing, send it to a friend." And the cost is real: you'd be rewriting your Preact + Netlify Functions stack into React Native, re-doing the auth flow (passkeys are *much* harder in RN — the WebAuthn ecosystem you're using on the web doesn't translate directly), and maintaining two codebases if you keep the web version.

## What I'd add to your current PWA

A few enhancements that would make it feel more native without leaving the web:

**Make it installable.** Add a proper `manifest.json` with icons, `display: "standalone"`, theme color. Once installed to the home screen on iOS, it loses the Safari chrome and feels like an app.

**Pointer Events for drawing input.** If you're not already using `pointerdown/pointermove/pointerup` with `event.pressure` and `event.pointerType`, you get pressure sensitivity for Apple Pencil and Android styluses for free. This is one of those things people assume requires native and it doesn't.

**Service worker for offline drawing.** Cache the app shell so users can draw without a connection, sync when they reconnect. Fits your existing Netlify setup.

**The share itself**, given your canvas:

```js
async function shareDrawing(canvas) {
  const blob = await new Promise(resolve =>
    canvas.toBlob(resolve, 'image/png')
  );
  const file = new File([blob], 'drering.png', { type: 'image/png' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: 'A drering for you',
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        // fall back to download
        downloadBlob(blob, 'drering.png');
      }
    }
  } else {
    downloadBlob(blob, 'drering.png');
  }
}
```

On iOS this opens the share sheet, the user taps Messages, the PNG is attached as MMS. Done.

## When I'd reconsider

If down the road you find yourself wanting any of these, then Expo starts to make sense:
- App Store distribution as a business goal
- Background sync of in-progress drawings
- Tight integration with the iOS photo library (selection UI, albums)
- Performance ceiling — if you're hitting it with very large canvases or complex brush engines

But for a drawing-and-share app where the share path is the critical interaction, the PWA route is the right call. You'd be picking up a much heavier toolchain to get a worse version of an API the web already has.

Want me to look at your current share flow if you have one, or help wire up the `navigator.share` path into your Preact app?