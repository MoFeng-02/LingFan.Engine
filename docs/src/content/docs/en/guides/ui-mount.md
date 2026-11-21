---
title: Mounting UI components
description: Overlay a persistent interface on the stage — the directory name is the UI name, the story controls visibility with mount, and the host takes the component table from the generated artifacts.
---

Some interfaces need to stay on the stage all the time rather than replacing the whole screen: a status bar, an affinity meter, a map corner badge. They follow the story, appear and hide with the plot, but never take over the whole screen — this route is paved by the `mount` command and a generated component table.

Replacing the whole screen (title page, settings page) goes down another route; see [pages and in-game interfaces](/guides/pages/).

## The directory name is the UI name

A UI is a directory under `src/ui/`; the directory name is the UI name, and the file of the same name inside it is its entry:

```text
src/
  ui/
    hub/
      hub.vue
```

Three hard rules, checked one by one at build time:

- **Only one level is accepted.** `src/ui/<name>/<name>.<ext>`, exactly two levels, no more, no less.
- **The file name equals the directory name.** `ui/hub/hub.vue` is a UI; `ui/hub/index.vue` is not.
- **`src/ui/` is outside the story source.** The story source lives in `src/Stories.src/`; UI is not inside it — it is a host asset, not a story file.

The name starts with a lowercase letter, followed by lowercase letters, digits, `_`, `-`, with a total length of 1 to 32. This name is simultaneously the `name` of `mount`, the key in the `uis` table, and the identifier of that export in the generated artifacts.

## How the story source references it

In the story source, default-import the entry file; the binding name must match the directory name (you can also switch to a named import of the registry; see [two ways to write it](#two-ways-to-write-it)):

```ts
// src/Stories.src/lib/hud.ts
import { mount } from "@lingfan-engine/editor";
import hub from "../../ui/hub/hub.vue";

export function showHud(): void {
  mount(hub, true);
}

export function hideHud(): void {
  mount(hub, false);
}
```

`../../ui/hub/hub.vue` goes up two levels from `src/Stories.src/<dir>/` to `src/`, then into `ui/`. Adjust the depth to the file's location, but the endpoint is always `ui/<name>/<name>.<ext>`.

The `hub` in `mount(hub, true)` is not a string; it is that export: it carries a type, and writing an unregistered name simply fails to compile.

To pass parameters, add a third argument:

```ts
mount(hub, true, { scene: "forest" });
```

The value must be JSON-safe (something that can go into a save). It replaces the previous `props` wholesale, not a field-by-field merge — to change one field, pass the full set.

The text-source form is shorter:

```text
scene chapter_one
  mount hub true
  say "The rain stopped."
  mount hub false
```

The fields, error codes, and all limits of `mount` are in [stage and scene · mounting UI](/reference/ops/stage/); they are not repeated here.

## Two ways to write it

There are two ways to reference a UI, with exactly the same semantics and byte-identical build output:

```ts
// Way one: default-import the UI file
import hub from "../../ui/hub/hub.vue";

// Way two: named-import the registry
import { hub } from "../../gen/ui_register.g";
```

The `gen/ui_register.g` in way two is the build-generated name-to-component table. A single specifier can supply all the handles, so the handle name must be written as a key in the registry — if it cannot be found it is a typo, and the build reports an error directly rather than silently skipping.

**When writing story source in the editor, choose way two.** The component compilers (vue-tsc, the editor's Vue / TSX language service) parse `.vue` / `.tsx` into real component types, which take priority over the `UiHandle` wildcard declared by `authoring`; so the handle in way one becomes a component type in the editor, and `mount(handle)` reports "a component cannot be assigned to a handle". Pure tsc has no component-resolution ability and cannot see this difference, so it only goes red in the editor. Way two does not go through component resolution, so both sides agree.

Four rules:

- **Only named imports are accepted.** Default imports, namespace imports, and side-effect imports all error: the registry has only named exports.
- **Local aliases are free.** `import { hub as h }` is valid; `h` is just a local spelling, and what it folds down to is still `"hub"`.
- **The extension may be omitted or kept.** `ui_register.g` and `ui_register.g.ts` refer to the same file.
- **Same-named files elsewhere are not accepted.** Only that one location under the generated-artifacts directory counts as the registry.

Short prefixes like `@/gen/ui_register.g` come from the project's own `tsconfig.json` `paths`; the engine does not invent prefixes. The relative form and the alias form are equivalent.

Apart from the registry, **other generated artifacts still cannot be imported**: `gen/fun_register.g`, `gen/state.gen`, and the like are excluded from the authoring import scope; imports in the story source must also be movable into the generated artifacts, and the generated artifacts themselves are outside the source root. The name-to-component mapping is the host side's responsibility; see the next section.

## Column-level `uis` declaration

`mount` is a runtime command; the host does not know in advance what a column will mount. So each column can statically declare the UIs it uses:

```json
{
  "id": "chapter_one",
  "kind": "game",
  "uis": ["hub"],
  "commands": [{ "op": "mount", "name": "hub", "visible": true }]
}
```

You do not hand-write this field in the story source — if `import hub from "../../ui/hub/hub.vue"` appears in that column, the build records `hub` into the column's `uis`. When the declaration is empty, the field is not written.

Both sides interlock:

- Using `mount` without declaring it in `uis` ⇒ build error. The host preloads by `uis`; a missing declaration means the interface only appears at the moment of mounting, and the player sees it flash.
- Declaring a UI in `uis` that does not exist in the source ⇒ build error. The preload comes up empty, with the same symptom as the previous item.

## Host-side wiring

The component table comes from a build-generated file; the host touches it in only one place — `src/mounts.ts`. This file does two things: re-export the generated component table, and create a `mountStore`.

```ts
// src/mounts.ts
export { uis } from "./<generated path>";
export const mountStore = createMountStore();
```

The generated path is given by the build tool; do not hand-edit it. All three forms take the table from here, so it appears only once; changing form or build tool does not require a second edit.

**The native form** hands the container and the table together to `bootHost`, and the host writes nodes into the container itself:

```ts
void bootHost({
  dom,
  manifestFile: "project.json",
  stories: STORIES,
  mountsContainer: dom.mounts,
  mountsTable: uis,
});
```

**The Vue / React form** does not give a container, only receives new values — the nodes belong to the framework's render tree, and the host writing into it again would fight:

```ts
void bootHost({
  dom,
  manifestFile: "project.json",
  stories: STORIES,
  onMounts: (raw) => mountStore.set(raw),
});
```

The view side subscribes to `mountStore` and turns names into components according to the table:

```vue
<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { selectMounts } from "@lingfan-engine/ui";
import { mountStore, uis } from "./mounts";

const raw = ref(mountStore.snapshot());
const stop = mountStore.subscribe((next) => {
  raw.value = next;
});
onUnmounted(stop);

const items = computed(() => selectMounts(raw.value, uis));
</script>

<template>
  <component
    :is="item.component"
    v-for="item in items"
    :key="item.name"
    v-bind="item.props"
  />
</template>
```

When neither the container nor the table is given, `mount` only writes state and no component appears — you can use this to get the command flow working first, then add the interface.

The position of the `#mounts` container in `index.html` matters: it is after the dialogue and toolbar, before the transition mask. So a UI can cover the dialogue layer, but cannot cover the transition or the error bar — the transition and errors are always the topmost layer.

## A status bar

`src/ui/hub/hub.vue` is a minimal usable status bar: a small read-only bar pinned to the bottom, with its own scoped styles, not depending on host CSS.

```vue
<script setup lang="ts">
withDefaults(
  defineProps<{
    label?: string;
    value?: string;
  }>(),
  { label: "Progress", value: "" },
);
</script>

<template>
  <div class="hub" role="status">
    <span class="hub__label">{{ label }}</span>
    <span v-if="value !== ''" class="hub__value">{{ value }}</span>
  </div>
</template>
```

The styles are written in a `scoped` block in the same `.vue` file; the framework gives them a local scope so they only hit this component:

```css
.hub {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border: 1px solid rgb(230 230 240 / 18%);
  border-radius: 999px;
  background: rgb(12 15 22 / 72%);
  color: #e6e6f0;
  font-size: 13px;
  /* Read-only interface: does not eat the stage's clicks */
  pointer-events: none;
}
```

Content comes in through `props`; the story side passes it like this:

```text
scene chapter_one
  mount hub true props={"value": "Chapter 1"}
  say "The rain stopped."
```

Three points worth noting:

- **Bring your own styles.** A UI component has no inheritable appearance convention in the host; it is entirely on its own. When reusing across forms, bring them all the more — do not count on some `stage.css`.
- **Set `pointer-events: none` for read-only interfaces.** Otherwise it eats the clicks of the stage underneath, and the player's clicks on the dialogue do nothing.
- **Do not judge the plot inside the component.** Visibility is decided by `mount`, content by `props`; if the component reads engine state on its own, that adds one more place that can disagree with save rollback.

## Current state and limits

- **Only show/hide, no toggle.** `visible` must be a boolean; there is no toggle form. To "toggle", record the state yourself and write `true` / `false`.
- **Hiding is not `display: none`.** When `visible: false`, the component is removed from the render tree, leaving no trace in the DOM.
- **The whole table follows saves and rollback.** Mount state is part of engine state; loading a save or rolling back restores it to how it was then.
- **No ordering control.** When multiple UIs are mounted at once, they are ordered by the code-point order of their names, not by the order of `mount`.

## Related

- [Stage and scene](/reference/ops/stage/) — the full fields, error codes, and limits of `mount`.
- [Pages and in-game interfaces](/guides/pages/) — the route that replaces the whole screen.
- [Story and narrative flow](/concepts/story/) — the difference between `type=ui` columns and `type=game` columns.
- [Project structure](/project-structure/) — the positional relationship of `src/ui/`, `src/gen/`, and the story source.
