---
title: "Column body: paint a whole screen with a component"
description: A column's body can be a component — the directory name is the body name, the story declares body, the host reads the component table from generated artifacts, and the component reads/writes engine state and submits narrative through SceneEnv.
---

There are three ways to paint a whole screen. Declarative `elements[]` places images, text, and buttons on the stage by coordinate — good for tidy layouts. `mount` overlays a persistent interface on the stage — good for status bars and badges that never take over the screen. The third way is the **column body**: hand an entire column's screen to a component — exploration rooms, inventory screens, battle panels, anything that needs local interaction and its own layout is easiest as a component.

This page covers how to write a column body, how it reads and writes the engine, how it submits narrative, and how it relates to the other two ways. For overlay layers see [Mounting UI components](/en/guides/ui-mount/); for full-screen page switching see [Pages and in-game UI](/en/guides/pages/).

## The directory name is the body name

A body is a directory under `src/scenes/`; the directory name is the body name, and the same-named file inside is its entry:

```text
src/
  scenes/
    hall/
      hall.vue
```

The rules match UI mounting: exactly one level `src/scenes/<name>/<name>.<ext>`, the file name equals the directory name, and `src/scenes/` lives outside the story source (it is a host asset, not a story file). The extension can be `.vue`, `.tsx`, or `.ts` — the native form uses a factory function returning `{ element, dispose }`, the framework form uses a component.

At build time `src/scenes/` is scanned into a component table `src/gen/scene_register.g.ts`, and a named handle is exported for each valid name. The story source references the handle, not the component itself:

```ts
// src/Stories.src/chapter/hall.ts
import { hall as hallScene } from "../../gen/scene_register.g";

export const columnKind = "scene";
export const body = hallScene;
export const bodyProps = { title: "Hall" };

export default function hall(): void {}
```

`columnKind = "scene"` declares a scene column; `body` names the body; `bodyProps` are the initial properties passed to the component and **must be JSON-safe values** (strings, numbers, booleans, plain objects and arrays — functions, `Map`, `Date` cannot enter). A scene column's commands land in `entry`; the body component decides how to paint.

## The component reads and writes the engine through SceneEnv

The component does not hold an engine instance. The host injects a `SceneEnv` as the `env` property — the only read/write surface between the component and the engine:

```vue
<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import type { SceneEnv } from "@lingfan-engine/core";

const props = defineProps<{ env: SceneEnv; title?: string }>();

// Read: read engine state live; the subscription only signals "something changed"
const revision = ref(0);
const stop = props.env.onChange(() => (revision.value += 1));
onUnmounted(stop);
const lampOn = computed(() => {
  void revision.value;
  return props.env.state.getScoped("world", "lamp") === true;
});

// Write: land a player-visible fact into engine state
function toggleLamp(): void {
  props.env.write("world", "lamp", !lampOn.value);
}
</script>
```

The read surface has `get` / `state` (read-only state), `columns()` / `currentColumn()` (columns and the current one), `historyLength()` / `historyCursor()` (history), `interpolate(source)` (interpolation), and `stage()` (viewport and layout size). The write surface has `write(systemId, key, value)` / `writeSilent(...)` (writes `game.<systemId>.<key>`; the silent variant does not broadcast changes). `onChange` only gives a "something changed" signal — read data live from `env.get`, so rollback, loading, and cross-column navigation all refresh correctly.

Stage size is injected through `env.stage()`; the component should not listen to `resize` itself. The host computes viewport and layout uniformly; the component just paints to size.

## Submit narrative with submit

Things that happen in the component and are "worth recording into the story" are submitted with `env.submit(ops)` — the same engine entry as story commands, taking effect as a batch or rejected as-is:

```ts
function greet(): void {
  props.env.submit([
    { op: "say", text: "You push the door open.", speaker: "Narrator" },
  ]);
}

function leave(): void {
  props.env.navigate("corridor");
}
```

`submit` does not create a separate checkpoint: the operations it submits enter history on the same footing as the body — they roll back together and restore together on load. Save commands like `load` are rejected as a batch (returning `false`, state unchanged); other commands pass. `call(target)` is a convenience for submitting a single `call`.

## Rollback lands on the step that entered the component

Local state inside the body component (counters, collapsed panels, temporary selections) belongs to the component and does not enter the engine. On rollback the engine retreats to **the step that entered this column**: the body switches back to the previous column's appearance, and the component's local state resets with it. In other words, the rollback granularity is the "column", not every click inside the component — to make a fact rollback-able, `write` it into engine state rather than leaving it in a component `ref`.

## Cross-platform: each host provides a name-to-component table

The body name is a stable cross-platform contract. The story only writes the name (via the handle); each host provides the "name → component" table: Web and desktop use framework components or native factories, the mini program uses its own render layer. When a name cannot be found it is fail-closed — the host reports a diagnostic carrying the name and this column paints no body, rather than silently skipping or faking an empty screen. The component table is generated at build time; rebuild after adding a body.

## Relationship to elements and mount

- **A column picks one way.** A scene column that declares `body` cannot also declare `elements[]` — declaring both is rejected at build time (fail-closed). Use `elements` for tidy layouts, `body` for self-driven interaction.
- **mount is an overlay, no conflict.** A `mount` persistent interface sits above the stage while the body sits within it; the two can coexist — the body paints the whole screen, the mount layer paints badges.
- **A flow column can carry a body too.** When a dialogue column (`flow`) declares the same body, the engine does not rewrite the body state — the screen stays put while dialogue advances.

## Notes

- `bodyProps` must be JSON-safe; functions and complex objects cannot enter state. Callbacks go through the host-injected control surface, not `bodyProps`.
- The component reads and writes through `SceneEnv`; do not hold an engine instance or listen to stage `resize` yourself.
- To make a fact rollback-able, `write` it into the engine; component-local `ref`s reset on rollback.
- Rebuild after adding or renaming a body so generated artifacts align with the story source; a missing name is fail-closed with a diagnostic.
