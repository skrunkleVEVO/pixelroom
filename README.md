# PixelRoom

A non-destructive photo editor for desktop and mobile browsers, running on WebGL2 fragment shaders, with a Library and Develop workspace in the style of pro photo editors. Photos stay on the device: there is no server and no upload.

PixelRoom is an independent project. It is not affiliated with or endorsed by Adobe.

## Run

Needs Node 18 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:5173. To try it on a phone, open the "Network" URL Vite prints while on the same Wi-Fi.

| Command | What it does |
| --- | --- |
| `npm run build` | Type-checks and builds static files into `dist/`, which any static host can serve |
| `npm run preview` | Serves the `dist/` build locally |
| `npm test` | Runs the unit tests for presets and curve math |

## Install on a phone

Open the site, then add it to your home screen. It then launches full screen and works offline.

- **iPhone or iPad:** open it in Safari, tap Share, then Add to Home Screen.
- **Android:** tap Install app on the start screen, or use the browser menu.

Phones get a simpler interface: Looks for one-tap presets with a Strength slider, Adjust for one big slider at a time, Crop, and More for every desktop panel. Export takes two taps and offers the system share sheet, which is how a photo reaches the iPhone's Photos app. Installing needs HTTPS, so it works on the hosted site, not over the local network URL.

## Hosting on GitHub Pages

Every push to `main` runs the tests, builds the app and deploys it to GitHub Pages. To turn this on once, make the repository public (a free GitHub plan requires it for Pages), then go to **Settings → Pages** and set **Source** to **GitHub Actions**. Re-run the workflow from the **Actions** tab, and the app will be live at `https://<your-username>.github.io/pixelroom/`.

The site only serves the app's code. Photos are still processed on the device and never uploaded.

## Controls

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Library / Develop | `G` / `D` | Develop only |
| Before / After | Toolbar button, or `Y` | Top bar button |
| Peek at the original | Hold the toolbar button or the photo, or hold `\` | Long-press the photo |
| Fit / 1:1 at that spot | Click the photo, or `Z` | Double-tap |
| Zoom / pan | Wheel, Navigator buttons / drag | Pinch / drag |
| Crop and straighten | `R` | Crop tab |
| White balance picker | `W`, then click something neutral | Picker button, then tap |
| Show clipping | `J` | |
| Reset a slider | Double-click it | Double-tap it |
| Type an exact value | Click the number | Tap the number |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z`, or the History panel | Top bar buttons |
| Copy / paste settings | `Ctrl+Shift+C` / `Ctrl+Shift+V` | |
| Previous / next photo | Left / right arrow | |
| Rate / flag | `0`-`5` / `P`, `X`, `U` | |
| Import / export | `Ctrl+Shift+I` / `Ctrl+Shift+E` | Top bar buttons |
| Hide panels / everything / dim | `Tab` / `Shift+Tab` / `L` | |
| Curve points | Click to add, drag to move, double-click to remove | Same, with taps |

## How it works

```
src/
  engine/
    params.ts        EditParams: the serialisable edit, plus every slider range
    curves.ts        Monotone cubic splines, baked into a 1024-entry float LUT
    geometry.ts      Crop, straighten, rotate, flip: output to source mapping
    view.ts          Zoom and pan, snapped to whole device pixels
    auto.ts          Auto Tone, Auto White Balance, the white balance picker
    metadata.ts      Reads EXIF and makes it true of the exported file
    encodeWorker.ts  MozJPEG encoding off the main thread
    shaders.ts       All GLSL, with the pipeline order documented at the top
    Renderer.ts      WebGL2 context, textures, viewport drawing, tiled export
  presets/
    presets.ts       Morioh, Neutral, JSON format, validation of imported files
    presets.test.ts  Exact Morioh values, import rules, spline behaviour
  state/
    store.ts         Small external store: catalog, params, history, presets, UI state
    editor.ts        Connects the store to the renderer; imports and exports files
  components/        Viewer, CropOverlay, Workspace, panels, Slider, CurveEditor, ExportDialog, Icons
  sample.ts          Procedural test scene, used by "Use sample scene"
  App.tsx            Layout: side panels and filmstrip on desktop, tabs on phones
```

**Non-destructive.** The decoded original is kept unchanged in memory. An edit is only an `EditParams` object, and each frame re-runs the shader from the original pixels. An unedited photo exports bit-exact as PNG.

**Sharp preview.** The canvas matches the stage in device pixels and the shader draws straight into it, so the browser never rescales the picture. While you interact, a mipmapped proxy (long edge up to 2560 px, or 1600 px on touch devices) answers instantly. When the view settles it is replaced by a texture made for that exact scale: an anti-aliased reduction when zoomed out, the original pixels at 1:1 and beyond. At 1:1 each source pixel lands on exactly one screen pixel.

**Fast slider drags.** Slider changes go from the store straight to the renderer without a React render, and several changes in one frame collapse into one draw. Only one shader pass runs per frame because the blurs used by Texture, Clarity, Dehaze and the Highlights/Shadows masks are built once per photo.

**Export quality.** Export renders the original in 2048 px tiles, so photos larger than the GPU's texture limit still work. Preview and export share the same blur textures, and sharpening works in source pixels, so judge it at 1:1. JPEGs are encoded with MozJPEG at 4:4:4, because browser canvas encoders use 4:2:0 chroma below quality 100, which smears saturated edges. Do not resize with `createImageBitmap`'s `resizeQuality`: Chrome's result aliases badly on large reductions.

**Pipeline order.** Noise reduction first. White balance, dehaze and exposure run in linear light. Then, in display space: highlights, shadows, whites, blacks, texture, clarity, sharpening, contrast, tone curve, HSL mixer, vibrance, saturation, black and white, color grading, vignette, grain.

The slider responses are PixelRoom's own approximations, so a given value will not match Lightroom's output exactly.

## Preset JSON

```json
{
  "format": "pixelroom-preset",
  "version": 1,
  "name": "My Look",
  "params": {
    "light": { "exposure": 0.2, "contrast": 25 },
    "curve": { "rgb": [[0, 8], [128, 132], [255, 255]] },
    "hsl": { "yellow": { "hue": -35, "sat": 45, "lum": 15 } }
  }
}
```

Groups are `mono`, `light`, `color`, `presence`, `curve`, `hsl`, `grading`, `detail`, `effects` and `geometry`. Missing values fall back to neutral and out-of-range numbers are clamped, so partial presets are valid. Applying a preset never changes the crop.

Photos open unedited. To open them with a look instead, set `DEFAULT_PRESET_ID` in `src/presets/presets.ts`.

## Limits

- **Camera RAW files (CR2, NEF, ARW, DNG) cannot be opened.** Browsers do not decode them, so input is whatever the browser can decode: JPEG, PNG, WebP, AVIF, and HEIC on Safari. A RAW decoder such as a LibRaw WebAssembly build would be a separate addition.
- **Editing is 8-bit sRGB,** because browsers decode images that way. Blown highlights in the file cannot be recovered, and wide-gamut photos (Display P3, Adobe RGB) are converted to sRGB on import, which clips their most saturated colors.
- **Metadata is kept only in JPEG exports from JPEG originals.** Orientation, dimensions and the embedded thumbnail are corrected. Location is removed by default.
- **The catalog lasts for the session.** Reloading the page clears imported photos and their edits. User presets are saved.
- **No masking, healing, red eye, lens corrections or perspective tools.**
- **Clarity, Texture and Shadows can halo at extreme values** around hard, high-contrast edges, because they use a plain blur rather than an edge-aware filter.
- **Very large exports can hit browser canvas limits,** which are lowest on iOS Safari. The largest size that works depends on the device.
