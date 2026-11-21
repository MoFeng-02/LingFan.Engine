---
title: Extending the Engine
description: Custom ops are declared as ESM modules and loaded after being registered in project.json. State written by extensions goes into saves automatically; when unregistered they are rejected as unknown commands.
---

The 76 built-in ops cover the routine needs of narrative, presentation, audio and saves. To add your own commands — raising stats, card logic, interfacing with external systems — use extensions.

An extension is an ESM module that default-exports a description object:

```ts
// ext/affinity.ts
export default {
  id: "affinity",
  stateVersion: 1,
  ops: [
    {
      op: "affinity_add",
      exec(cmd, ctx) {
        const key = String(cmd.key ?? "");
        const delta = Number(cmd.delta ?? 0);
        if (key === "" || !Number.isFinite(delta)) {
          return {
            ok: false,
            code: "affinity-invalid",
            message: "affinity_add requires key and delta",
          };
        }
        const current = Number(ctx.get(`value.${key}`) ?? 0);
        ctx.set(`value.${key}`, current + delta);
        return { ok: true };
      },
    },
  ],
};
```

## Three fields

| Field          | Role                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| `id`           | Stable identifier. Starts with a lowercase letter, then lowercase letters/digits/`_`/`-`, up to 32 characters |
| `stateVersion` | State-structure version, a positive integer. Not the same thing as the code version                           |
| `ops`          | The list of custom ops provided; optional                                                                     |

`id` is written into saves — a save records "which extensions this save used, and each one's state version".

`stateVersion` governs the **shape of state**. If you refactor code but the keys stored in state have not changed, you do not need to touch it; only when you add new keys or change the meaning of a value do you bump it.

Each definition in `ops`:

| Field            | Role                                                                          |
| ---------------- | ----------------------------------------------------------------------------- |
| `op`             | The command name written in the story                                         |
| `exec(cmd, ctx)` | The executor, returning `{ ok: true }` or `{ ok: false, code, message }`      |
| `project`        | Optional, the projection for the text form; see below                         |
| `schema`         | Optional, a form declaration for the editor. The engine does not interpret it |

## Registration and loading

An extension is only loaded if it is written in `Resources/project.json`:

```json
{
  "formatVersion": 1,
  "id": "my-story",
  "entry": "title_main",
  "extensions": ["ext/affinity.ts", "ext/cards.ts"]
}
```

The strings are module specifiers; the host uses them to `import` dynamically:

```ts
import { loadDeclaredExtensions } from "@lingfan-engine/core";

const extensions = await loadDeclaredExtensions(
  manifest.extensions,
  (specifier) => import(specifier),
);
const engine = new StoryEngine(story, { savePort, extensions });
```

**Files that are not registered are not scanned.** If you put `ext/foo.ts` in the project but forget to write it into `extensions`, it does not exist at all to the engine — it is not loaded and does not error. This design avoids dragging in a whole directory at bundle time.

If the `extensions` field is absent, or written as an empty array, the loader is never called even once.

A load failure throws, with the message carrying which entry in the manifest had the problem:

```text
Extension load failed: ext/affinity.ts — module provides no default export (must be an OpExtension declaration)
Extension load failed: ext/affinity.ts — id is invalid: Affinity (must match /^[a-z][a-z0-9_-]{0,31}$/)
Extension load failed: ext/affinity.ts — ops entries must be { op: non-empty name, exec: function }
```

## Checks at registration

The engine validates extensions at construction; a problem throws outright and the story cannot run:

| Situation                               | What it reports                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `id` invalid                            | `Extension id is invalid: Affinity (must match /^[a-z][a-z0-9_-]{0,31}$/)`                     |
| Same `id` registered twice              | `Extension id registered twice: affinity`                                                      |
| `stateVersion` not a positive integer   | `stateVersion of extension affinity is invalid: 0 (must be a positive integer)`                |
| op name collides with a built-in        | `op "say" of extension affinity conflicts with a built-in op (built-ins cannot be overridden)` |
| op name collides with another extension | `op "draw" of extension affinity duplicates another extension`                                 |
| `exec` missing                          | `op "draw" of extension affinity is missing exec`                                              |

Built-ins always win. If you want to override the behavior of `say`, you cannot.

## Writing state

An extension's context has only three things:

```ts
interface ExtensionContext {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  readonly story: Readonly<Story>;
}
```

`set` and `get` operate on **your own namespace** — the engine physically prefixes `ext.<your-id>.` for you. In the example above, `ctx.set("value.affinity", 10)` actually writes `ext.affinity.value.affinity`. You cannot write keys outside the prefix; this is guaranteed structurally.

The benefit: values you write in are global state, traveling with snapshots, saves and rollback; serialization is handed to the engine. You do not need to manage saves yourself.

`story` is read-only. Changing the story is only possible through story commands and the editor.

Values written in must be JSON-safe. Stuffing in functions, `Map`, or circular references is rejected; after the error, state stays as it was.

## The executor must not throw

`exec` returning `{ ok: false, code, message }` signals failure; the engine emits `engine.error` and stops at the current command, state unchanged.

If it throws, the engine catches it and converts it to `custom-op-threw`. The story does not crash, but the error code is no longer yours, making it harder to diagnose. **Judge failure yourself; do not throw.**

```ts
exec(cmd, ctx) {
  if (typeof cmd.amount !== "number") {
    return { ok: false, code: "shop-invalid-amount", message: "shop_buy requires a numeric amount" };
  }
  // ...
  return { ok: true };
}
```

## How to use it in the story

The JSON form writes it directly:

```json
{ "op": "affinity_add", "key": "lin", "delta": 5 }
```

The text form does not work by default — the parser does not recognize `affinity_add` and reports "statement not yet supported by text projection: affinity_add". To make it writable in `.story` too, add a projector:

```ts
{
  op: "affinity_add",
  exec(cmd, ctx) { /* … */ },
  project: {
    toText: (cmd) => `affinity_add "${cmd.key}" ${cmd.delta}`,
    fromText: (text) => {
      const m = /^affinity_add\\s+"([^"]*)"\\s+(-?[\\d.]+)$/.exec(text);
      if (m === null) return null;
      return { op: "affinity_add", key: m[1], delta: Number(m[2]) };
    },
  },
}
```

`toText` returning `null` means this command cannot be projected; writing back to text rejects the whole thing. `fromText` returning `null` means this line failed to parse; the error carries row/column numbers. Neither direction should throw.

You can use it without a projector — extension commands execute as usual, only the story file must be written in the JSON form.

## Extensions and saves

A story that has used extensions has an extra section in its saves:

```json
{
  "extensions": [{ "id": "affinity", "stateVersion": 1 }]
}
```

On load the engine checks each one:

| Situation                                                              | Result                                                                                                                                                                      |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extension not registered                                               | Whole save rejected: `Extension required by the save is not registered: "affinity". Install and enable it before loading`                                                   |
| Save's state version older than the extension, extension has `migrate` | Calls `migrate` to migrate; on success notifies "extension 'affinity' state migrated from v1 to v2"                                                                         |
| Save's state version older, `migrate` returns `null`                   | Whole save rejected: `extension "affinity" cannot migrate from state version v1 to v2; save rejected`                                                                       |
| Save's state version older, extension has no `migrate`                 | Whole save rejected: `save depends on state version v1 of extension "affinity", currently registered version is v2 (save too new or missing migration path); save rejected` |
| Save's state version newer than the extension                          | Same as above, rejected                                                                                                                                                     |
| Extension's `restore` returns `false`                                  | Whole save rejected: `extension "affinity" failed to restore on load (restore returned false); save rejected`                                                               |

A save that did not use extensions does not carry this section, and an engine with extensions installed can still read it — no false positive.

### State migration

`migrate` receives the key-values within your namespace, **without** the `ext.<id>.` prefix, and returns an isomorphic object:

```ts
{
  id: "affinity",
  stateVersion: 2,
  migrate(fromStateVersion, state) {
    if (fromStateVersion !== 1) return null;
    return { ...state, bonds: {} };  // v1 has no bonds; add an empty object
  },
  ops: [ /* … */ ],
}
```

Returning `null` means it cannot migrate; the whole save is rejected. This function should not throw either.

### Restoring runtime handles

After state is restored, some things need to be reconnected — timers, event subscriptions, connections to external systems. Use `restore`:

```ts
{
  id: "affinity",
  stateVersion: 1,
  restore(ctx) {
    const pending = ctx.get("pendingEvent");
    if (pending !== undefined) scheduleAffinityEvent(pending);
    return true;
  },
  ops: [ /* … */ ],
}
```

Returning `false` means it cannot restore; the whole save is rejected. State stays as it was.

## What extensions can and cannot do

Can:

- Add new ops and write state in your own namespace.
- Provide text projection so custom commands can be written into `.story`.
- Declare a state version and provide migration and restore.

Cannot:

- Override or delete built-in ops.
- Write state keys outside your own namespace.
- Change story definitions (`story` is read-only).
- Touch the file system, keys, or platform interfaces — the context simply does not have these things. If you need platform capabilities, have the host do it; extensions communicate with the host through state.

## Next steps

- [Save system](/concepts/saves/): how extension markers enter saves.
- [State & variables](/concepts/state/): where the `ext.` namespace sits in the state container.
- [Minigames & gameplay systems](/concepts/minigame/): another way to write gameplay state.
