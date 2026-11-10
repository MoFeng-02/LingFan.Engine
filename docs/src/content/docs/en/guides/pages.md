---
title: Pages and In-Game UI
description: Login, lobby and save selection belong to the host, not the engine. Entering the game means the host switches its interface and the engine runs from a column.
---

A player opens the game and first sees a title with "Start" and "Continue" buttons. That screen has nothing to do with the engine: it is an ordinary page in the host application, a peer of the engine core. Only after "Start" is there a game — the host switches to the game interface and the engine begins running from the entry column.

This page covers two things: how ordinary pages coexist with the engine, and who owns the in-game interface (the `ui` columns on the stage and the mounted components).

## The engine only exists inside a game

The engine's public surface has no notion of "pages" or "screens". It answers one question: **which column is it on**.

```ts
import { createStateReader } from "@lingfan-engine/core";

const reader = createStateReader(engine);
reader.currentColumnId(); // empty string = not in any column yet
```

An empty string has exactly one meaning: the engine has not entered any column yet, so it is not running. That is the whole criterion for "show an ordinary page now" — no extra flag, and no further check wrapped around it by the host.

`currentColumnType()` answers a different question: whether this column is `game` or `ui`. It decides whether the column **enters history and saves**, not which screen to draw. Do not mix the two.

## Ordinary pages are host code

Login, lobby, save selection, settings — these pages display without the engine existing, and without the engine knowing they exist. So they live in the host's own directory, wherever you like: `src/pages/`, `src/views/`, either is fine. `packages/ui` provides no wrapper for them.

```vue
<script setup lang="ts">
import { onUnmounted, ref } from "vue";
import { createStateReader } from "@lingfan-engine/core";

const reader = createStateReader(engine);
const started = ref(reader.currentColumnId() !== "");
const stop = engine.onStateChanged(() => {
  started.value = reader.currentColumnId() !== "";
});
onUnmounted(stop);

function enterGame(): void {
  engine.start();
}
</script>

<template>
  <LoginPage v-if="!started" @done="enterGame" />
  <GameRoot v-else />
</template>
```

Three things to note:

- **An ordinary page needs no room made for it.** The engine has not started, so nothing on the stage is interactive, and no `inert` or `aria-hidden` is needed — the ordinary page is simply the top layer.
- **Decide when the stage mounts before assembly.** Assembly captures node handles once and for all (`#stage`, `#dialogue`, `#choices` and every other id must exist). Either keep it mounted and let the ordinary page cover it, or settle whether to render it from interface state before assembly — do not unmount and remount at runtime, since that is a fresh set of nodes, every handle the host holds goes stale, and all subsequent dialogue and element writes land on nothing.
- **Entering the game is the host's action.** The engine does not switch screens; the host switches its own interface state, then lets the engine start running.

## Entering the game

"Start" translates, on the host side, into two steps: let the engine run from the entry column, then jump to the first playable column if needed.

```ts
import { firstGameColumn } from "@lingfan-engine/ui";

function enterGame(): void {
  engine.start(); // navigates to the entry column from project.json
  const target = firstGameColumn(engine.columns(), entry);
  if (target !== undefined) engine.navigate(target);
}
```

`firstGameColumn()` handles the case where the entry column is not a `game` column: if the entry column is itself `game` it is used as is, otherwise the first `game` column in the column list is taken. If the project has no `game` column at all it returns `undefined`, and the button is disabled accordingly.

"Continue" reads the most recently written slot:

```ts
import { latestSave } from "@lingfan-engine/ui";

const slots = slotIds(resolveSavesConfig(manifest).slots);
const latest = latestSave(await savePort.list(), slots);
if (latest !== undefined) engine.load(latest.slot);
```

When there is no usable save, `latest` is `undefined` — disable the button and put a hint in its `title`. Do not fail silently.

## Inside the game: stage and interface columns

After entering the game, everything the player sees is on the stage, in one of two kinds of column:

| Column type      | What it is                                                   | History and saves |
| ---------------- | ------------------------------------------------------------ | ----------------- |
| `game` (default) | The stage: dialogue, elements, choices, video                | Yes               |
| `ui`             | In-game interface: menu columns, status panels, mounted hubs | No                |

There is exactly one rule: columns whose `type` is `game` take part in history and saves, `ui` columns do not. The engine does not know what a "page" is; `type` answers only this one question.

## What goes in an interface column

A `ui` column can contain ordinary commands, and they run as usual — it is an interface on the stage, not a skipped screen:

```text
scene pause_menu type=ui
  say "Take a break?"
  menu "What next?"
    "Back to the story" -> chapter_one
```

```ts
export const columnType = "ui";
```

`type` is written only for non-default values: omitted means `game`, and `ui` marks an interface layer. There are only two values; whether an interface is a title screen or a settings page is told apart by its column id, and needs no further layer.

`chapter_one` declares no type, so it is a `game` column: from there on every step is replayable and savable.

## Mounted UI gets a controls channel

Components placed by `mount` (status bars, side menus) need to operate the engine: pause, save, return to the title. That channel is `HostControls`, injected by the host at assembly time rather than passed through `props`.

```ts
export interface HostControls {
  pause(): void;
  resume(): void;
  paused(): boolean;
  pauseMedia(channel?: AudioChannel): void;
  resumeMedia(channel?: AudioChannel): void;
  navigate(columnId: string): void;
  save(slot: string): void;
  load(slot: string): void;
  dispose(): void;
}
```

Nine methods — a **narrowed** view of `StoryEngine`: only what a menu needs, and it survives across rendering forms. It is injected at runtime, stored nowhere, and never enters a save.

`props` and `controls` are two different channels:

|          | `props`                                                   | `controls`                                   |
| -------- | --------------------------------------------------------- | -------------------------------------------- |
| Source   | third argument of `mount(hub, true, { scene: "forest" })` | an object built by the host at assembly time |
| Stored   | yes — travels through snapshots, saves and rollback       | no — injected at runtime                     |
| Contract | must be JSON-safe                                         | any object, functions allowed                |

A component gets both. One sentence is enough to remember it: `props` goes into saves, `controls` does not.

In the Vue form, `UiHost` passes `controls` as a prop to every mounted component; in the native form the factory receives it as the second argument:

```ts
const instance = factory(props, controls);
```

## Pausing

Pausing is a public engine method, reached by the host menu and by mounted UI alike through `HostControls`:

```ts
engine.pause(); // idempotent
engine.paused(); // true
engine.resume(); // idempotent
```

`pause()` does four things: suspends running timers and records the remaining milliseconds, pauses the three resident audio channels `bgm` / `ambient` / `voice`, pauses video, and writes the paused flag into state. `se` is a one-shot trigger and does not take part. `resume()` restarts the timers with their remaining milliseconds and resumes each media channel according to the current state — channels already `stop`ped do not spring back to life.

While paused:

- `advance()` / `choose()` are rejected (`pause-active`) rather than silently ignored — silently ignoring makes the player think the click was lost.
- `navigate()` / `save()` / `load()` / `dispose()` keep working. Saving while paused is a normal need, and it records the position as it was before the pause.

To stop only the media without freezing the narrative, use `pauseMedia()` / `resumeMedia()`; with no channel argument they cover every resident channel plus video.

## Current limitations

- **One screen at a time.** There is no page stack. To build "back from settings", keep the previous page in the host.
- **Do not add a router.** Page switches are driven by the host's interface state, not by the URL. Wire a router in and you have to solve "the URL changed but the engine did not" yourself, with two sources of truth.
- **Zero framework changes.** Ordinary pages are host code; switching to Vue, React or plain native touches the host only, and not a line under `packages/*`.
- **Do not put ordinary pages in `src/ui/`.** That is the scan surface for `mount`; a page placed there becomes a component a story can mount and unmount at will.

## Related

- [Story & Narrative Flow](/en/concepts/story/): what `type=ui` and `type=game` mean.
- [Mounting UI Components](/en/guides/ui-mount/): the `mount` directory convention, `uis` declarations and the component table.
- [Project Manifest](/en/reference/manifest/): the rules for `entry`, `name` and `shell.saves.slots`.
- [Save System](/en/concepts/saves/): where slot names come from and what a save stores.
