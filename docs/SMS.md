# SMS

We want to let the user easily send the picture in a text message.

## Web App (PWA)

The cleanest path is the **Web Share API**, which opens the native share sheet (including SMS) on mobile browsers:

```js
async function sharePhoto(blob, filename = 'photo.jpg') {
  const file = new File([blob], filename, { type: blob.type });

  // Check if files can be shared
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: 'Photo',
        text: 'Check this out',
      });
    } catch (err) {
      if (err.name !== 'AbortError') console.error(err);
    }
  } else {
    // Fallback — see below
  }
}
```

**Caveats worth knowing:**

- **iOS Safari**: supports `navigator.share` with files. Works well, opens the native share sheet including Messages.
- **Android Chrome**: full support, opens the system share sheet.
- **Desktop**: limited/no file sharing support — fall back to a download or `mailto:`/`sms:` link.
- **Must be triggered by a user gesture** (button click), and the page must be served over HTTPS.
- The image must be a `File` object — if you have a canvas or a remote URL, you need to convert it first (`canvas.toBlob()`, or `fetch().then(r => r.blob())`).

**Fallback — `sms:` URI scheme:**

This *won't* attach an image reliably (MMS attachment via URI isn't supported on iOS and is inconsistent on Android), but it can prefill text:

```js
// iOS uses & after the number, Android uses ?
window.location.href = `sms:?&body=${encodeURIComponent('Check this: ' + imageUrl)}`;
```

So for PWA, the realistic pattern is: **Web Share API where supported, otherwise share a hosted URL via `sms:` or just let them download/copy the image.** Given you're in the Cloudflare ecosystem, hosting the image on R2 with a short-lived signed URL and sharing the link is a solid fallback path.

## Expo (React Native)

Expo's `expo-sharing` is the direct analog and works great:

```js
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';

async function sharePhoto(localUri) {
  if (!(await Sharing.isAvailableAsync())) {
    alert('Sharing not available on this device');
    return;
  }

  await Sharing.shareAsync(localUri, {
    mimeType: 'image/jpeg',
    dialogTitle: 'Share photo',
    UTI: 'public.jpeg', // iOS
  });
}
```

The file must be a local file URI. If your image is remote or in memory, download/write it first with `FileSystem.downloadAsync()` or `FileSystem.writeAsStringAsync()`.

This opens the native share sheet on both iOS and Android, which includes Messages/SMS as a target. The user picks SMS from the sheet — same UX as the Web Share API.

If you specifically want to *open Messages directly* (skip the share sheet), there's `expo-sms`, but it doesn't reliably attach images — same MMS limitation as the web `sms:` scheme.

## Recommendation

Since you want the share menu specifically:

- **PWA**: `navigator.share({ files })` with a URL fallback for unsupported browsers.
- **Expo**: `expo-sharing`'s `shareAsync()`.

Both surface the OS share sheet, both let the user pick Messages, and the API shapes are similar enough that if you're sharing logic across the two (which fits your Substrate-style modular approach), you could abstract behind a single `sharePhoto(file)` interface.

One thing worth flagging: neither path *guarantees* the photo ends up as an MMS attachment — that depends on the user's carrier, OS version, and whether they're on iMessage vs SMS. The OS handles that handoff; your app just hands off the file.

Want me to sketch out the abstraction layer, or dig into the R2 + signed URL fallback approach for desktop browsers?