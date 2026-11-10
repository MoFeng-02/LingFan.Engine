---
title: Screen Adaptation
description: Author against a design baseline, let the host scale the stage into any window, keep the UI in window space, and let stretch decide how media fills its box.
---

The same project runs on phones, tablets, desktop windows and 4K displays — sizes that differ several times over — yet a story only ever has one set of coordinates. Screen adaptation is about exactly that: **write the coordinates once, and they read correctly wherever the game is shown**.

## Three coordinate systems, each with its own job

| System          | Used by                                            | Unit                               |
| --------------- | -------------------------------------------------- | ---------------------------------- |
| Design baseline | Story elements, panels, dialogue, font sizes       | Baseline pixels (default 1280×720) |
| Window          | Host UI: toolbar, notifications, preference panels | Screen logical pixels              |
| Device pixels   | Handled by the browser and OS, you never touch it  | Physical pixels                    |

Every coordinate you write for a story lives in the first system. When the window changes size, the engine computes a scale factor and an offset, then scales the whole stage (the element layer and extension overlays) as one block into the window. The host UI does not take part in that scaling; it lays itself out against the window.

## Configure the design baseline

Write it in `shell.stage` of `project.json`. Omit it and you get 1280×720 scaled to fit:

```json
{
  "shell": {
    "stage": {
      "width": 1280,
      "height": 720,
      "fit": "contain"
    }
  }
}
```

`width` / `height` are the design baseline, accepting 160–16384 (width) and 90–16384 (height). Changing the baseline changes the coordinate system for the whole game; stylesheets stay untouched — the same story written against 1920×1080 is displayed as 1920×1080.

`fit` decides how the stage is placed into the window:

| Value     | Behavior                                                     | Good for                                      |
| --------- | ------------------------------------------------------------ | --------------------------------------------- |
| `contain` | Scale to fit fully, leaving bars on the short side (default) | Wanting the full composition, tolerating bars |
| `cover`   | Scale to fill, cropping what overflows                       | Wanting immersion, tolerating cropped edges   |
| `fill`    | Stretch both axes independently, allowing distortion         | Backgrounds, solid color backdrops            |
| `none`    | No scaling, 1× as authored                                   | Pixel art, precise alignment during debugging |

`contain` and `cover` cover most cases: the first keeps the picture whole, the second keeps the bars away. Switching `fit` swaps the trade-off without touching the story.

A few more keys are available when you need finer control (all optional):

- `scaleBy`: `min` / `max` / `width` / `height` / `fill`, or a positive multiplier (0.05–64). Overrides the scaling strategy that `fit` expands into.
- `alignX` / `alignY`: `start` / `center` / `end` — which side to hug when there are bars; centered by default.
- `minScale` / `maxScale`: scaling limits, each 0.05–64. When both are declared and `minScale > maxScale`, both are ignored together.

Invalid values are ignored one by one and fall back to defaults; they never fail the whole manifest. These settings only affect presentation: they never enter engine state or saves.

## Common windows

**A portrait phone** (say 390×844). A 1280×720 stage is landscape, so `contain` leaves large bars top and bottom and shrinks the picture. Projects aimed at phones should move the baseline to a portrait preset (1080×1920 or 750×1334) and compose vertically:

```json
{ "shell": { "stage": { "width": 1080, "height": 1920, "fit": "contain" } } }
```

**A 16:9 desktop window.** Baseline and window share a ratio, so `contain` and `cover` produce the same result: no bars, no cropping.

**Ultra-wide.** `contain` leaves bars on both sides; `cover` crops top and bottom. To put the bars on one particular side (a portrait on the right, empty space on the left), set `alignX`.

**Large displays / 4K.** When the scale factor is above 1, bitmaps get magnified and may look soft. Prepare assets at a higher baseline (1920×1080 or 3840×2160), or move the baseline itself to that preset for native sharpness.

## Why the interface does not scale with the stage

The whole stage is scaled with `transform`. Pushing the toolbar and dialogue panel into that block scales them too — the window getting bigger already makes the UI bigger once, and multiplying by a scale factor makes it a second time. Text ends up absurdly large.

So the correct approach is to keep host UI in a **sibling** outside the stage and lay it out with window units:

```css
/* Stage: scaled as one block, author coordinate space */
.stage-root {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
}

/* Interface: window coordinate space, follows the window */
.shell-ui {
  position: fixed;
  inset: 0;
  padding: clamp(10px, 2.2vh, 22px) clamp(12px, 3vw, 40px);
  pointer-events: none;
}
```

Two rules of thumb:

- **Do not use `vw` / `vh` / `clamp()` inside the stage.** They resolve against the window and then get scaled with the stage — scaled twice. Use baseline pixels inside the stage.
- **The interface layer must use window units.** Its size is independent of the stage scale factor, so `clamp()` and `env(safe-area-inset-*)` are both appropriate (the latter handles notches and gesture bars).

Interface containers usually want `pointer-events: none`, with each interactive part turning `pointer-events: auto` back on — otherwise the whole panel silently swallows clicks.

## How images and video fill their box

Elements have `width` / `height`, assets have their own ratio, and `stretch` decides when the two disagree: `fill` / `contain` / `cover` / `none` / `scale-down`, defaulting to `cover`. Background elements fill the stage automatically and need no size.

See [Visual Elements · Media Fitting](/concepts/elements/).

## How a host wires this up

The engine only computes; reading the window and writing styles is the host's job. Three steps:

```ts
import { resolveStageConfig } from "@lingfan-engine/core";
import { computeStageLayout, stageTransform } from "@lingfan-engine/shell";

// 1. Resolve the config: built-in defaults × project overrides
const stage = resolveStageConfig(manifest);

// 2. Compute the layout: you measure the viewport
const layout = computeStageLayout(
  { width: viewport.clientWidth, height: viewport.clientHeight },
  stage,
);

// 3. Apply: write the size and the transform string
root.style.width = `${layout.width}px`;
root.style.height = `${layout.height}px`;
root.style.transformOrigin = "0 0"; // translate then scale, so the origin must be top-left
root.style.transform = stageTransform(layout);
```

Re-run steps 2 and 3 whenever the window size changes. Desktop and browsers listen for `resize` and `orientationchange`; mini program hosts have no `vw` / `vh`, so they read system info, compute, and hand the result to the page styles.

The computation reads no platform globals, so desktop shells, browser hosts and mini programs share one definition — moving between platforms only changes "how to measure" and "how to apply".

The host that ships with the scaffold already wires this up, so editing `project.json` is enough. A host of your own can follow the three steps above, or use the orchestration helper, which also handles "skip the write when nothing changed" and "do nothing when the size cannot be read":

```ts
import { createStageFitter, createStagePort } from "@lingfan-engine/shell";

const fitter = createStageFitter({
  port: createStagePort({
    readRoot: () => stageRoot,
    readFrame: () => ({
      width: viewport.clientWidth,
      height: viewport.clientHeight,
    }),
  }),
  config: stage,
});

fitter.refresh(); // call once after mounting
window.addEventListener("resize", () => fitter.refresh());
window.addEventListener("orientationchange", () => fitter.refresh());
```

The helper registers no listeners — subscription timing and symmetric removal differ per platform, so that stays with the host.

## Checklist

- Coordinates, font sizes and spacing in the story are all in baseline pixels, with no `vw` / `vh` mixed in.
- The `shell.stage` baseline has the same ratio as the target picture (no portrait baseline for a landscape project).
- The `fit` choice is deliberate: `contain` for full composition, `cover` for no bars.
- The interface sits outside the stage, uses window units, and interactive parts enable `pointer-events`.
- `stretch` on images and video is chosen per content, not left at the default everywhere.
- Checked once at the smallest and largest target window sizes, confirming no unexpected cropping or large bars.
