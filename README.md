# PixelRoom

A quick, phone-first photo editor for Instagram, TikTok and stories, plus batch compression. Everything runs in the browser: photos are never uploaded.

- **Frame**: 4:5 post, 1:1, 9:16 story/TikTok, 3:4, 16:9, 1.91:1 or the original shape. *Fill* crops (drag and pinch to position); *Fit* keeps the whole photo on a blurred or coloured background with an optional border. Rotate, flip, straighten.
- **Filters**: 17 one-tap looks with a strength slider.
- **Adjust**: Auto, plus brightness, contrast, saturation, warmth, tint, highlights, shadows, vibrance, fade, sharpen, vignette and grain.
- **Text**: captions with six fonts, ten colours, plain/shadow/outline/label styles. Drag to move, pinch to resize and rotate; snaps to the centre.
- **Save**: Social (1080 px short edge: 1080×1350, 1080×1920, 1920×1080…), HD (2×) or full resolution, as JPG, PNG or WebP, at a quality or under a file size (2 MB, 1 MB, 500 KB, 200 KB). Share straight to Photos, Instagram or TikTok through the share sheet, or download.
- **Collage**: put 2–10 photos in one post. Pick from 3–6 layouts per photo count, any frame shape, spacing, rounded corners and background colour. Tap a photo to drag/pinch it inside its cell, swap it with another, replace or remove it. **Next** opens the collage in the editor for filters, text and saving.
- **Compress**: pick any number of photos, choose a max size, format and quality or target size, then save them all at once (share sheet or a .zip). A file that's already smaller than the result is kept as it is.
- Installable as an app, works offline, and on Android it shows up in the share menu so you can send photos to it from the gallery.

Saved files never contain location or camera data.

## Run

Needs Node 18 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:5173. To try it on a phone, open the "Network" URL Vite prints while on the same Wi-Fi. (Installing and the share menu need HTTPS, so they only work on the hosted site.)

| Command | What it does |
| --- | --- |
| `npm run build` | Type-checks and builds static files into `dist/` |
| `npm run preview` | Serves the `dist/` build locally |
| `npm test` | Unit tests for layout math, looks, encoding, zip |

## Install on a phone

- **iPhone or iPad:** open the site in Safari, tap Share, then Add to Home Screen.
- **Android:** tap Install app on the start screen, or use the browser menu.

## Hosting on GitHub Pages

Every push to `main` runs the tests, builds and deploys to GitHub Pages (Settings → Pages → Source: GitHub Actions). The site only serves the app's code.

## How it works

```
src/
  lib/
    adjust.ts     Adjustments, filters, how they combine, Auto
    processor.ts  WebGL colour pass (one shader) for preview and export
    layout.ts     Formats, fill/fit placement, pan clamping, output sizes
    compose.ts    Draws a frame: background, photo, vignette, grain, text
    text.ts       Text layers: fonts, styles, drawing, hit-testing
    encode.ts     JPG/PNG/WebP encoding and "fit under N KB"
    image.ts      Decoding (EXIF orientation) and high-quality resizing
    zip.ts        Minimal .zip writer for "Download all"
    save.ts       Share sheet and downloads
  lib/collage.ts  Collage layouts, spacing/corners, drawing
  collage/        Collage screen: state and undo, live preview with gestures
  editor/         State and undo, live preview with gestures, tool panels, save sheet
  screens/        Home and Compress
  shareTarget.ts  Photos shared in from Android's share menu
```

The original photo is never modified; an edit is a small object that's re-applied for every preview frame and for export. Preview and export run the same code, so text, grain and vignettes look identical at any size. Export only processes as many photo pixels as the output needs, and output is capped at 16 megapixels, which is what iOS Safari reliably allows.

**Limits:** RAW camera files can't be opened (browsers don't decode them). WebP saving isn't available on Safari, so the option is hidden there.
