# PixelRoom

A non-destructive photo editor for desktop and mobile browsers, running on WebGL2 fragment shaders. Photos stay on the device: there is no server and no upload.

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

## Controls

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Side-by-side Before / After | Click the button, or `Y` | Tap the button |
| Peek at the original | Hold the button or the photo, or hold `\` | Long-press the button or the photo |
| Reset a slider | Double-click it | Double-tap it |
| Type an exact value | Click the number | Tap the number |
| Zoom | Wheel, or double-click | Pinch, or double-tap |
| Pan when zoomed | Drag | Drag |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` | Toolbar buttons |
| Curve points | Click to add, drag to move, double-click to remove | Same, with taps |

## How it works

```
src/
  engine/
    params.ts        EditParams: the serialisable edit, plus every slider range
    curves.ts        Monotone cubic splines, baked into a 1024-entry float LUT
    shaders.ts       All GLSL, with the pipeline order documented at the top
    Renderer.ts      WebGL2 context, proxy and blur textures, drawing, tiled export
  presets/
    presets.ts       Morioh, Neutral, JSON format, validation of imported files
    presets.test.ts  Exact Morioh values, import rules, spline behaviour
  state/
    store.ts         Small external store: params, undo history, presets, UI state
    editor.ts        Connects the store to the renderer; opens and exports files
  components/        Viewer, Slider, CurveEditor, panels, ExportDialog, Icons
  sample.ts          Procedural test scene, used by "Use sample scene"
  App.tsx            Layout: side panel on desktop, bottom sheet and tabs on phones
```

**Non-destructive.** The decoded original is kept unchanged in memory. An edit is only an `EditParams` object, and each frame re-runs the shader from the original pixels.

**Fast slider drags.** Slider changes go from the store straight to the renderer without a React render, and several changes in one frame collapse into one draw. Only one shader pass runs per frame because the blurs used by Texture, Clarity, Dehaze and the Highlights/Shadows masks are built once per photo.

**Export matches the preview.** The preview renders a proxy (long edge up to 2560 px, or 1600 px on touch devices). Export renders the original in 2048 px tiles and assembles them into a canvas, so photos larger than the GPU's texture limit still work. Both use the same blur textures, and sharpening and grain scale with the photo.

**Pipeline order.** White balance, dehaze and exposure run in linear light. Then, in display space: highlights, shadows, whites, blacks, texture, clarity, sharpening, contrast, tone curve, HSL mixer, vibrance, saturation, color grading, vignette, grain.

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

Groups are `light`, `color`, `presence`, `curve`, `hsl`, `grading` and `effects`. Missing values fall back to neutral and out-of-range numbers are clamped, so partial presets are valid.

Morioh is applied automatically when a photo opens. To start photos neutral instead, set `DEFAULT_PRESET_ID` to `NEUTRAL_ID` in `src/presets/presets.ts`.

## Limits

- **Camera RAW files (CR2, NEF, ARW, DNG) cannot be opened.** Browsers do not decode them, so input is whatever the browser can decode: JPEG, PNG, WebP, AVIF, and HEIC on Safari. A RAW decoder such as a LibRaw WebAssembly build would be a separate addition.
- **Editing is 8-bit per channel,** because browsers decode images to 8 bits. Blown highlights in the file cannot be recovered.
- **Exports do not keep EXIF metadata.**
- **Very large exports can hit browser canvas limits,** which are lowest on iOS Safari. The largest size that works depends on the device.
