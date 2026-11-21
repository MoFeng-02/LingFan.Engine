---
title: Template capability boundaries
description: Which capabilities the scaffold's bundled host has wired, which it has not, which simply do not apply in this form, and what you see for the unwired parts.
---

The scaffold's bundled host is a minimal implementation that runs. It leaves an exit for every wait state, but it has not wired up every capability the engine has.

There is only one criterion: **the story must not get stuck.** For every wait state the engine can enter, the template must give the player a button that can advance. For a capability that cannot meet this bar, it is better to explicitly report "not registered" than to pretend it is done.

The `shell.*` in `project.json` is a different matter — it must actually be read. If you change `shell.saves.slots`, the slots in the save dropdown must change with it; a change that has no effect is harder to track down than no support at all.

## Wired

| Capability                                      | Where it lands                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Dialogue layer: typewriter + inline markup      | `say`'s character-by-character display, `{p}` `{w}` pauses, style markers                                                 |
| Wait-state exits: `menu` `input` `wait` `video` | All four can advance                                                                                                      |
| Wait state: `minigame`                          | Shows "not registered" and explains how to wire it; does not fake completion                                              |
| Stage element layer                             | 36 element types, element interaction, 12 presentation commands                                                           |
| Layer z-order                                   | `shell.layers` parsed and written into the DOM                                                                            |
| Saves                                           | `shell.saves.slots` decides the slot count; save / load go through the engine command surface                             |
| Stage adaptation (`shell.stage`)                | The result of `resolveStageConfig` is computed into a transform written to the stage root; UI stays in window coordinates |

The dialogue-layer row is worth spelling out: the `{p}` `{w}` pauses and the zero-width handling of style markers are done in the presentation layer; the engine only puts the marked-up text into state. So writing `{b}bold{/b}` in a `say` shows an effect, but that is the template's dialogue renderer parsing it, not the engine.

`animate` / `transition` / `shake` are **frame-driven** — the template reads the animation queue once per frame, interpolates, writes into the DOM, and on completion writes back the final value. Without driving them, the animation queue only grows and never shrinks, and elements stay at their start forever. These three are wired in the template.

Element commands go through a registry. When the story writes `cmd="..."` on an element, the host looks up that name in the registry; if it cannot be found it reports "element command not registered" rather than silently skipping. Likewise, an unregistered element type reports "element type not registered." An author writing something and seeing no effect is much harder to track down than a one-line error.

## Not wired

These are **the template host not wiring them up**, not the engine lacking the capability:

| Capability                                    | What you see when unwired                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Save thumbnails                               | Saved games have no screenshot                                                                               |
| History panel and rollback UI                 | No rollback button in the player interface                                                                   |
| Player preferences panel (volume, text speed) | Volume is just the value written in the command; the typewriter takes the story-level `text_typewriter`      |
| I18N supply                                   | The `Lang/` directory does not participate at all; original text straight out                                |
| Dialogue-box template registration            | Writing `say template=` has no effect; the built-in skeleton is used                                         |
| Resource encryption                           | Writing `resourceEncryption` in the manifest has no effect; the template reads straight from the static root |
| Hot reload                                    | Changing a story file does not reload in place; only a full page refresh                                     |
| Host information                              | The template does not call `HostPort`; per-platform branching has no landing point                           |

**Save thumbnails**: the engine's save payload has a `screenshot` field (a data URL, composed by the host); the template does not pass it. Not passing it means a save with no image, not a broken save.

**History panel and rollback UI**: the engine has `historyView()`, `rollbackTo()`, `back()`, `forward()`; the template has not built an interface. Calling these methods in the console shows an effect, but there is no entry point on the page.

**Player preferences**: the engine accepts preference injection, with priority over story-level settings. The template has not wired it, so `text_typewriter speed=30` is the final speed, with no player panel to override it.

**I18N supply**: the default semantics of the engine's `i18nPort` is original text straight out. The template has not wired the port, so the translation tables under `Resources/Lang/` are not loaded — not a load failure, but simply never read. To see translations you must wire it yourself.

**Dialogue-box templates**: `say template="xxx"` goes through a template registry. The template has registered no templates, so `template=` is ignored and the built-in skeleton is still shown.

**Resource encryption**: the engine-side interface is `ResourcePort` — give a logical path, get back a currently usable address. The static root joins the path directly; the encrypted form decrypts and gives a short-lived address. Both implementations plug into the same interface. The template uses the static-root one. This does not mean encryption cannot be done in a web page: fetch the ciphertext, decrypt it to plaintext in the page, create a temporary address and hand it to `resolve()` — the path works. The template has not done it; that part of the host code simply is not written.

**Hot reload**: the engine has `reloadStory()`, which can atomically swap the story definition while preserving variables and history. What is missing is "knowing when a file changed" — the browser has no ability to recursively watch the file system, so the template has not wired it. The desktop form watches the source directory in the native layer, and on trigger reassembles and feeds it to the engine.

**Host information**: `HostPort` is a read-only fact (system + form), used for per-platform branching. The template does not call it, so there is no per-platform behavior inside. This port also works in a web page — when the compile-time platform cannot be obtained it falls to `unknown`, an explicit unknown, not an error.

The engine has all these capabilities, and `apps/playground` implements them all. The template and playground share the same engine and adapters; the difference is only in the host code.

## Not applicable

This one is not "unwired" — there is simply no corresponding thing in the pure Web form:

**Screen orientation lock** (`shell.orientation`). The browser has no API to lock screen orientation. This config only takes effect in the desktop shell (Tauri). Writing it in a web page does nothing — not ignored, but there is nothing at the platform level to call.

## Swapping in your own host

The template's host does not depend on any UI framework — it manipulates the DOM directly. Swapping in Vue, React, or anything else works, with zero changes to the engine and adapters.

The interface is already at that layer: the host subscribes to the engine's state changes and lands them on its own view; the engine does not know what the view is. The subscription key table in the template has only ten:

```text
currentDialogSpeaker  currentDialogText  waiting
nvlMode  nvlBuffer
menuOptions  menuTargets  inputOptions
dialogVisible  elements
```

When you swap frameworks, what you need to do is wire the keys in this table to your own components, then subscribe to the outbound events (engine errors, `notify` hints, minigame mounts, save receipts). Everything else — how the story is parsed, how state is stored, how rollback is rebuilt — is in the engine, independent of which framework you use.

For how to generate a new project and install dependencies, see [creating a project from the template](/from-template/).

## Template version

The template version is recorded in `template/v1/template-meta.json`, currently `1.17.0`, and the required engine version is `0.4.0`.

It and the engine version are **two separate lines**. A new engine release does not automatically raise the template version — this number is only changed by hand when the template content actually changes. So the two numbers not matching is normal: when the template content changes, raise the template number; if the engine has not shipped a release alongside, it does not move.

`minEngineVersion` is not a decorative field: the generator compares it against the actual version on the registry, and if the engine has not shipped that version it **refuses to generate** and explains what is missing, rather than writing a pile of files first and only blowing up at `pnpm dev`. When the version cannot be looked up offline, this check is skipped.

The engine packages are published as TS source exports (`exports: "./src/index.ts"`); consumers compile them directly with Vite and TypeScript, with no intermediate build step. They are all on the registry, directly usable with `pnpm install`.

## Next steps

- [Creating a project from the template](/from-template/) — use the generator to start your own project.
- [Project manifest project.json](/reference/manifest/) — the values and defaults of every `shell.*` field.
- [Extending the engine](/concepts/extensions/) — the engine-side capability extension points.
