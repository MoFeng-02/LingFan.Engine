---
title: Start Screen & Render Switching
description: Draw an ordinary screen before the game starts, then switch to the stage on "Start" — the only inputs are the column id and column type, and the engine has no notion of a "start screen".
---

Before the story begins, the player sees a title and two buttons; pressing "Start" enters the game. That screen is not a special kind of column and lives in no registry — it is an ordinary screen in the host, layered over the stage with `v-if`.

## The engine only knows two things

The engine has no "start screen" concept. It knows which column it is parked on (the column id, an empty string before it starts running) and what type that column is (`game` or `ui`). Whether to draw that screen is the host's judgement.

That judgement lives in `hostScreenOf()` in `@lingfan-engine/ui`, and it has exactly two rules:

| Situation                                    | What is drawn |
| -------------------------------------------- | ------------- |
| Column id is an empty string (not started)   | Start screen  |
| Column type is not `game` (title, settings…) | Start screen  |
| Everything else                              | Stage         |

Both rules are needed. Judging by type alone, the column id is an empty string before the engine starts and the type defaults to `game`, so the first frame is read as the stage — the picture goes black and then jumps back to the start screen.

"Entering the game" is `navigate(entry column)`. The entry column is `entry` in `project.json` and points at a `type=game` column; once you navigate there the column type becomes `game` and the judgement flips by itself.

## The stage is not unmounted

While the start screen is up, the stage **stays in the DOM** and merely steps aside: the six layers `#stage`, `#nvl`, `#dialogue`, `#choices`, `#notifications` and `#toolbar` each get `inert` and `aria-hidden="true"`, so they receive no clicks and stay out of the accessibility tree. The root is untouched — the start screen hangs under the root itself and covers the stage from above.

Why not unmount the stage and mount it back: the stage nodes are grabbed once at assembly time, so removing and re-adding them means a new set of nodes and every handle the host holds goes stale; all later dialogue and element writes would land on nothing.

So the only thing that is really mounted and unmounted is the start screen itself — `v-if` guarantees that for free. The native form has no framework to help, so it clears its container by hand.

## One implementation per form

The start screen is host code, not engine code, so each form has its own implementation and they share nothing:

| Form  | Location                  |
| ----- | ------------------------- |
| Vue   | `src/StartScreen.vue`     |
| React | `src/StartScreen.tsx`     |
| Plain | `src/host/screen/view.ts` |

It should not live in `src/ui/<name>/`: directories there are collected into the UI name table by the build, which would turn the start screen into a component that `mount` can show and a story can dismiss at will — and it has to be there at all times.

## What the screen receives

The host pushes the screen state to the view, and the view only draws. The screen state looks like this:

| Field           | Meaning                                                                  |
| --------------- | ------------------------------------------------------------------------ |
| `screen`        | `"start"` or `"game"`; the view decides whether to draw                  |
| `title`         | Display name, from `name` in `project.json`, falling back to `id`        |
| `slots`         | Save slot names, from `shell.saves.slots`                                |
| `resume.slot`   | Slot to load for "Continue"; `undefined` when no save is available       |
| `resume.reason` | One line explaining why there is nothing to continue; `""` when there is |
| `start()`       | Enter the game, jumping to the entry column                              |
| `load(slot)`    | Load the given slot                                                      |

The commands are part of the screen state too, so the view does not need to know where the entry column comes from or what the slots are called.

`resume.slot` and `resume.reason` go together: when continuing is possible `reason` is an empty string, and when it is not `slot` is `undefined`. The "Continue" button is `disabled` accordingly and puts `reason` on its `title` — greyed out, but the player knows why.

## Wiring on the host side

Vue and React forms: the composition root hands every new screen state to `screenStore`, and the view subscribes itself.

```ts
// src/main.ts
import { bootHost } from "./host";
import { screenStore } from "./screen";

void bootHost({
  dom,
  manifestFile: "project.json",
  stories: STORIES,
  onScreen: (view) => screenStore.set(view),
});
```

The native form passes nothing: without `onScreen` the host mounts its own opaque overlay under `#stage-root` and takes care of the six `inert` layers. Passing both `onScreen` and a native placement conflicts — two parties would be creating nodes.

`screenStore` lives in `src/screen.ts` and is one line:

```ts
export const screenStore = createScreenStore();
```

It only holds the screen state and notifies subscribers. It touches no DOM, and all three forms share it.

## A minimal start screen

Vue form, `src/StartScreen.vue`:

```vue
<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { screenStore } from "./screen";

const view = ref(screenStore.snapshot());
const stop = screenStore.subscribe((next) => {
  view.value = next;
});
onUnmounted(stop);

const shown = computed(() => {
  const current = view.value;
  if (current === undefined || current.screen !== "start") return null;
  const slot = current.resume.slot;
  return {
    title: current.title,
    reason: current.resume.reason,
    resumable: slot !== undefined,
    resume: () => {
      if (slot !== undefined) current.load(slot);
    },
    start: () => current.start(),
  };
});
</script>

<template>
  <!-- Keep clicks in: a click on the stage root advances the dialogue, and
       one landing here would skip a line on the way in. -->
  <div v-if="shown !== null" class="screen-start" @click.stop>
    <div class="screen-start__body">
      <h1 class="screen-start__heading">{{ shown.title }}</h1>
      <div class="screen-start__actions">
        <button
          type="button"
          :disabled="!shown.resumable"
          :title="shown.reason"
          @click="shown.resume()"
        >
          Continue
        </button>
        <button type="button" @click="shown.start()">Start</button>
      </div>
    </div>
  </div>
</template>
```

The React form has the same shape, with reads through `useSyncExternalStore(screenStore.subscribe, screenStore.snapshot, screenStore.snapshot)`: concurrent rendering needs external values read as snapshots, and your own `useState` + `useEffect` reads a stale value on the first frame.

Three things worth noting:

- **Stop propagation on clicks.** A click on the stage root advances the dialogue, and a bubbling event would skip a line.
- **Own your styles.** The engine has no idea what the start screen looks like; keep the layer below the transition overlay so transitions still cover it.
- **Do not judge state inside the screen.** Whether continuing is possible, what the title is, which column to jump to — all of it is in the screen state. Every extra check in the view is one more chance to disagree with the host.

## What goes in an interface column

On the story side it is a plain `ui` column:

```text
label title_main:
  say "Welcome to my story."
  menu "Where to next?"
    "Start the game" -> chapter_one
```

```ts
export const columnType = "ui";
```

The commands in a `ui` column are not wasted — the start screen is only drawn when it should be, and a host that does not wire this screen still runs that block as commands. Writing the smallest playable flow into the `ui` column is therefore a habit that costs nothing.

`chapter_one` is a `game` column because it declares no type: from there on every step is rewindable and saveable.

## Limitations

- **One screen at a time.** There is no page stack. To do "back from settings", keep the previous screen's column id yourself and `navigate` back to it.
- **No router library.** Screen switching is driven by column switching, not by URL. Add a router and you have to solve the two-sources-of-truth problem where the URL changed but the engine did not move.
- **No changes in the framework layer.** The engine does not know about the start screen, so switching between Vue, React or plain DOM touches only the host and leaves `packages/*` alone.

## See also

- [Story & Narrative Flow](/en/concepts/story/): what `type=ui` and `type=game` mean.
- [Mounting UI Components](/en/guides/ui-mount/): persistent interfaces layered over the stage take the other road.
- [Project Manifest](/en/reference/manifest/): rules for `entry`, `name` and `shell.saves.slots`.
- [Save System](/en/concepts/saves/): where slot names come from and what a save holds.
