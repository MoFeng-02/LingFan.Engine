---
title: Rendering Interface Columns with Pages
description: Hand a ui column to a full-screen page — Vue, React, or plain DOM. How a page reads state, issues commands, why it must really be destroyed on the way out, and how it differs from a HUD.
---

A `type=ui` column does not enter history, does not enter saves, and does not create checkpoints — it is an interface, not story. There are two ways to draw one:

- **Draw it with ops**: same as a `game` column, stacking `say` / `menu` / elements inside a `scene`. Works out of the box.
- **Hand it to a page**: the host mounts a full-screen page onto that column id. The page can use Vue, React, or plain DOM.

This page is about the second. It fits title screens, settings pages and save lists — anything that swaps one screen for another — and it is the only way to use a framework's component ecosystem.

## Two hard boundaries

A page may do a lot, but only two rules are hard; the rest is freedom.

**One: read through `StateReader`, write through the command surface.** Read whatever you need (current column, waiting state, menu options, element table…), and change things only by calling engine commands (`navigate` / `choose` / `input` / `save` / `load`). Pages do not touch state keys and do not invent their own save format — going around that means going around the reserved-key guard and snapshot consistency.

**Two: leaving means really destroying.** A page swap is a **complete interface replacement**, not a visibility toggle. On the way out the page must be destroyed for real: Vue's `app.unmount()`, React's `root.unmount()`, or — in plain DOM — clear the container and unbind your listeners. Hiding the old interface keeps things looking fine, but several interfaces stay in memory and "which interface am I on" has two answers.

In one line: **teardown logic belongs to the host; the engine neither provides nor checks it.** Freedom is yours, and so is getting it right.

## Pages and HUDs are different things

|           | Page                          | HUD                                       |
| --------- | ----------------------------- | ----------------------------------------- |
| Footprint | Full screen (whole viewport)  | Overlay above the game screen             |
| Lifecycle | Destroyed when you leave      | Persistent, may hide but not unload       |
| Why       | One screen should hold one UI | Players reopen it; rebuilding loses state |
| Good for  | Title, settings, save lists   | Toolbars, minimaps, status bars           |

A HUD is built with `createHudPanel`: call `mount(container, ctx)` once, then `setVisible(false)` only sets `hidden` on the root node (the instance is still alive — scroll position and expanded groups survive), and `destroy()` is the real teardown.

## Registering a page

The page registry lives in the host, not the engine. Three steps:

```ts
import {
  bootHost,
  createPageRegistry,
  createTitlePage,
  optional,
} from "./host";

const pages = createPageRegistry();
pages.register("title_main", createTitlePage({ nextColumnId: "chapter1" }));

void bootHost({
  dom,
  manifestFile: "project.json",
  stories: STORIES,
  pageContainer: optional("#page"), // full-screen interfaces mount here
  pages,
});
```

`register(columnId, factory)` keys on the **column id**, not the column type. When the engine enters a column, the host mounts whatever page was registered for that id; columns without one keep rendering with ops — **not having a custom interface is a reasonable fallback, not an error**.

Registering the same id twice replaces rather than appends. An invalid id (it must match `/^[a-z][a-z0-9_-]{0,31}$/`) or a non-function factory is rejected and reported, so it never silently turns into "this column always renders with ops".

## What a page receives

The factory gets a `PageContext` with exactly four things:

```ts
interface PageContext {
  reader: StateReader; // read-only: current column, waiting, menu, elements…
  engine: Pick<StoryEngine, "navigate" | "choose" | "input" | "save" | "load">;
  preferences: PlayerPreferences; // player preferences (volumes, mute, text speed)
  gameState: GameStateWriter; // page state, via the game.<system>.<key> namespace
}
```

`engine` exposing five methods is deliberate: a page needs jump, choose, submit input, save and load — not the whole engine. Every extra method is one more way to bypass the contract.

Anything a page wants to keep across mounts (say, which page of a list you were on) belongs in `gameState` — it travels with saves and rollback. Module-level variables work too, but they bypass saving: after loading a save they will not be reset.

## A minimal page

Plain-DOM version (the template ships one as `src/host/pages/title-page.ts`):

```ts
import { createTitlePage } from "./host";

pages.register("title_main", createTitlePage({ nextColumnId: "chapter1" }));
```

Vue version (`src/pages/title-page.vue`, registered in the composition root):

```ts
import { createApp } from "vue";
import TitlePage from "./pages/title-page.vue";

pages.register("title_main", (ctx) => {
  const app = createApp(TitlePage, { ctx });
  return {
    mount(container) {
      app.mount(container);
    },
    unmount() {
      app.unmount();
    },
  };
});
```

Reading state and issuing commands inside the component:

```vue
<script setup lang="ts">
import { computed } from "vue";
import type { PageContext } from "../host";

const props = defineProps<{ ctx: PageContext }>();
const at = computed(() => props.ctx.reader.currentColumnId());

function start(): void {
  props.ctx.engine.navigate("chapter1"); // jump by column name
}
function resume(): void {
  props.ctx.engine.load("auto"); // no save → one error event, no throw
}
</script>

<template>
  <section class="page-title">
    <h1>My Game</h1>
    <p>{{ at === "" ? "No interface yet" : `Current interface: ${at}` }}</p>
    <button @click="start">Start</button>
    <button @click="resume">Continue</button>
  </section>
</template>
```

Three things worth noting:

- **Jumps only know column names.** The `chapter1` in `navigate("chapter1")` must be a column id that actually exists in the build output; the page does not need to know whether it was written as JSON or TS.
- **"Continue" needs no save check.** `load("auto")` reads the engine's auto-save slot; with no save present the engine emits one `engine.error` event and does not throw.
- **You own the styling.** The engine has no idea what a title screen looks like — everything inside the page container comes from your components and stylesheet.

## What to write in the column

On the story side it is an ordinary `ui` column:

```text
scene title_main type=ui
  say "Welcome to my game."
  menu "Where to next?"
    "Start" -> chapter1

scene chapter1
  say "The story begins here."
```

Those ops inside a `ui` column are not wasted — they are the **fallback when no page is registered**. With a page registered, the page covers them; run the same story on a host that mounts no pages and the ops still work. So keeping a minimal playable flow in the `ui` column costs nothing.

`chapter1` without `type` is a `game` column: from there on every step is rollback-able and save-able.

## Current limitations

- **The page container is optional.** The skeleton's `index.html` has `<div id="page">`, read with `optional("#page")`. If your page structure has no such slot, pass `null` and every column renders with ops — no error.
- **Do not add a router.** Interface switching is driven by column switching, not by URL. Wiring a router in leaves you with two sources of truth ("the URL changed but the engine did not jump").
- **Framework layers are untouched.** The engine does not know about pages, so switching between Vue, React and plain DOM only touches the composition root; `packages/*` does not change.
- **No page stack.** One page at a time. To make "back to the previous screen" work, `navigate` back to that column id yourself — do not expect the engine to remember it.

## See also

- [Story & Narrative Flow](/en/concepts/story/): what `type=ui` and `type=game` mean.
- [Menus, Input & Notifications](/en/guides/menu-input/): the `menu` command is not the same thing as an interface column.
- [Visual Elements](/en/concepts/elements/): what draws the screen when there is no page.
