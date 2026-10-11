---
title: Save System
description: "A save records the wait-point coordinate, global state, RNG seed and history. Unlike rollback, it replays from the coordinate and rebuilds the screen you saw."
---

Saves and rollback both go back in time, but they work differently. Rollback returns to a checkpoint in memory; a save writes a payload to disk, where it outlives the browser session.

## Making a save

Declare it in the story:

```text
  save "slot_1" title "Chapter one"
```

`save` is not a wait command — it notes "write the next screen into this slot" and execution continues. The engine actually writes to disk when that screen appears for the player, then emits `save.done`.

You can also call the command surface from the host:

```ts
engine.save("slot_1", { title: "Chapter one" });
```

That one requires being at a wait point; otherwise it reports `save-invalid`. Slot names are limited to alphanumerics, `_` and `-`, length 1 to 64, and a violation reports `save-invalid-slot`.

With no save port wired up (no `savePort` when the engine was constructed), `save()` always returns `false` and the event reports `save-unavailable`.

## Where slots come from

`shell.saves.slots` in `Resources/project.json`:

```json
{
  "shell": {
    "saves": {
      "slots": 6
    }
  }
}
```

An integer from 1 to 32, 6 by default. Slot ids are `slot_1` … `slot_N`; hosts get the list from `slotIds()` rather than building the strings themselves. Those ids are what the `save` command and `engine.save()` take.

`auto_save` uses a separate fixed slot, `auto`, which does not consume one of those numbers.

## What's in a save

```ts
{
  formatVersion: 1,
  storyId: "my-story",
  title: "Chapter one",   // optional
  coord: { columnId: "chapter_one", index: 12 },
  state: [["player.name", "A-Lan"], ["coins", 30], ...],
  rngState: 1735689600,
  functions: [...],
  cursor: 7,
  history: [...],
  screenshot: "...",      // optional
  extensions: [{ id: "demo", stateVersion: 1 }]  // only when extensions were used
}
```

A few things worth knowing:

- `coord` points at the **position within a column that can rebuild that screen**. Loading does not paste a screenshot back; it replays from this coordinate, re-running the commands.
- `state` is the global layer. Block and column variables never enter a save — they are re-declared by the same code after loading, so as long as their values are determined by code they end up correct.
- `rngState` is the RNG seed. Load the same save twice and `random` draws the same sequence.
- `history` keeps only each checkpoint's coordinate, state and seed, not the frame stack — the frame stack is rebuilt from the coordinate.
- `extensions` appears only when the story actually used extensions. Without them the field is absent, so an engine with extensions installed still reads an extension-free save.

Saving inside a `menu` or `ui` column stores **the game progress from before entering that menu**, not the menu itself. If no such progress exists, it reports `save-invalid`.

## What can't go in

Before saving, the engine checks every value for serializability. Put a function, a `Map` or a circular reference into state and it reports `value-not-serializable`:

```text
状态含不可序列化值，存档被拒绝：player.data（请检查是否有原地修改已写入的值；应整值替换）
```

The runtime messages themselves are not localized yet, so that one comes out in Chinese.

The most common source is in-place mutation: `push` onto an array and then `set` it back. Copy-on-write requires replacing the whole value.

```text
  array_push "inventory" "key"     // correct
```

Commands like `array_push` and `dict_set` always write a new reference and never hit this. Only extensions that mutate objects directly do.

## Save modes

`machine-bound` (the default) and `portable`.

The first is bound to the current machine, so copying the save file to another machine will not open — that is what it is for, local progress. For cross-device use, pick `portable` when constructing the engine:

```ts
new StoryEngine(story, { savePort, saveMode: "portable" });
```

The engine does not use this parameter itself — it passes it straight through to `savePort.write(slot, payload, mode)`. **The engine holds no keys and does no encryption or decryption** — its job is orchestrating the payload (coordinate, global state, RNG seed, history) and managing slots; how the ciphertext is produced and what it is bound to live in the port implementation.

So the question "is a save safe" is answered at the platform layer:

- The engine's `SaveMode` is only a statement of intent: `machine-bound` means "this save should not be readable once it leaves this machine".
- Where the key comes from, what it is bound to and which algorithm is used are port-implementation business; neither the story nor the engine gets a say.
- Anti-rollback is platform-layer too: saves carry a write counter, and deleting a newer save to load an older one is refused — otherwise deleting saves would be a rollback backdoor. You can see this take effect in the [Deleting](#deleting) section.

To distribute saves across machines, switching `mode` to `portable` is not enough — the port implementation also has to actually produce machine-independent ciphertext. On the engine side that one parameter is all it takes; the rest is the platform layer.

## Loading

```ts
engine.load("slot_1");
```

It completes asynchronously: read the raw data back, validate it, restore global state, replay from the coordinate, rebuild that screen. Success emits `load.done`; failure emits only `engine.error` and leaves state untouched.

Validation rejects these cases:

| Error code | When |
|---|---|
| `save-format` | The save structure is incomplete, a history checkpoint is missing fields, or `cursor` has the wrong type |
| `save-story-mismatch` | `storyId` does not match, or a column the save references no longer exists in the current story |
| `load-invalid-slot` | The slot name is invalid |
| `load-failed` | The slot cannot be read, or JSON parsing failed |
| `save-unavailable` / `load-unavailable` | No save port is wired up |

The second row is the one you hit most when editing a story: delete or rename a column and existing player saves report `save-story-mismatch`. The column a save's coordinate points at has to still be there.

`importSave(data)` reads a `SaveDataV1` you built yourself through the same validation.

## Auto-save

```text
  auto_save true
  say "This scene saves automatically afterwards."
  auto_save false
```

While it is on, every wait screen writes the `auto` slot when it is built. The switch is system state: it goes into the save together with the state (the save export writes state out unfiltered, `export.ts:74`) and is restored as-is on load (a full restore, `import.ts:85`; only the waiting flag is reset, `import.ts:125`) — auto-save that was on before the load point is still on afterwards, with no need to switch it back on.

When a pending `save` declaration and an auto-save land on the same screen, only the slot named by `save` is written — one screen, one write.

## Deleting

```ts
engine.save_delete("slot_1");
```

In a story that is `save_delete "slot_1"`. It clears the slot's contents but leaves its write counter alone, so anti-rollback baselines do not rewind with it. `list()` shows each slot's write count and timestamp:

```ts
await savePort.list();
// [{ slot: "slot_1", saveCount: 3, timestamp: 1735689600, mode: "machine-bound" }]
```

## Thumbnails

`shell.saves.thumbnail` controls save thumbnails:

```json
{
  "shell": {
    "saves": {
      "thumbnail": { "width": 320, "height": 180, "quality": 0.7, "showText": true }
    }
  }
}
```

Width runs 80 to 1280, height 45 to 720, and `quality` sits between 0 and 1. The host generates the screenshot and passes it in through `save(slot, { screenshot })`; the engine only places it in the save payload.

## Preferences stay out

Volume, text speed and key bindings are player preferences and live outside saves; loading does not change them. They are persisted separately, so switching saves leaves your settings alone. See the [dialogue guide](/en/guides/dialogue/) for details — if the host has no preferences panel yet, volume takes the value written in the command.

## Next

- [Rollback & History](/en/concepts/rollback/): the other way back in time, the one that never touches disk.
- [Extending the Engine](/en/concepts/extensions/): how extension state travels with saves.
- [Project Structure](/en/project-structure/): which file `shell` configuration goes in.
