---
title: Menus, Input & Notifications
description: How menu options connect to columns, which variable an input value lands in, how to write a notify toast, and who releases each of the wait points.
---

Besides `say`, the wait points include `menu`, `input`, and `wait` / `pause`. This page covers how to use them and who each one waits for.

## menu

`menu` is a block statement; options are written as indented lines:

```text
menu "Where to next?"
  "Go to the dock" -> dock
  "Go home" -> home
```

Each option is written `"label" -> target-column`. The target column is **not quoted**; it is a column id. There must be at least one option; none reports "menu needs at least one option".

`menu` enters the `menu` wait state; after the player picks one, it jumps to that option's target column and continues. A nonexistent target column errors on the jump; it does not stop silently.

The menu prompt can be omitted:

```text
menu
  "Accept" -> accept
  "Decline" -> refuse
```

### Option labels are translated; target columns are not

The translation table only applies to option **labels**. The target column name is passed to the engine as-is — it is a column id, not human-facing text, and should not appear in the translation table.

### Remembering what the player chose

`menu` itself does not write a variable; the jump is a control transfer. To remember the choice, write it yourself in the target column:

```text
menu "What's for dinner tonight?"
  "Noodles" -> noodle
  "Rice" -> rice

label noodle:
  set "player.choice" "noodles"
  jump dinner
```

The engine writes `menuSelected` to record the index, but it is an internal key for the render layer; do not use it as a business variable.

### Saving inside a menu column

A column declaration can carry `type=ui`. On entering such a column the engine records the rollback-able coordinate from before entry; saving inside such a column stores **the game position from before entry**, not the interface itself.

This is not the same as the `menu` op: the `menu` op builds a checkpoint, and player rollback lands back at the menu to re-choose; a `type=ui` **column** builds no checkpoint — it is a layer "overlaid" on the story. Treat the two separately.

## input

`input` asks a question and writes the player's input into a variable:

```text
input "What's your name?" store="player.name"
say "Hello, {player.name}!"
```

Both fields are required. Missing `store` is rejected at parse time with the message "input needs prompt and store".

The variable written is **global** — the player's answer travels with the save. The `.` in the name is only a naming convention; it does not form a nested structure. `player.name` is just a key with that name.

`input` enters the `input` wait state, filled back by the host:

```ts
engine.input("A-Lan");
```

The host calls this when your input box submits; the engine writes the value into the variable `store` points to, then continues.

## Input candidates

Give a set of common answers; the player can click one or type their own:

```text
input "What is your role?" store="role" options=[{"text": "Traveler", "value": "traveler"}, {"text": "Merchant", "value": "merchant"}]
```

Two extra buttons appear beside the input box. Clicking "Traveler" writes `traveler` into `role` — **what is written is the `value`, not the `text` shown on the button**. This way translation only affects display; the variable value the story logic reads stays the same across languages.

Candidates are a shortcut, not a single-choice question: the player can still ignore them and type; both paths go through the same submit exit. For a true "pick one of three" you still need `menu` (`menu` jumps columns, `input` fills a variable — this is the deliberate divide between the two).

## wait & pause

Both are timed pauses:

```text
wait 1.5
pause 2
```

`wait` can add `skipable`, letting the player click to end it early:

```text
wait 3 skipable
```

`pause` has no `skipable`; it moves on only when the seconds elapse. It suits places you do not want the player to interrupt.

**A parameterless `pause` warns**, treated as 0 seconds — i.e. no pause effect at all. In traditional writing a parameterless `pause` means "wait for a player click"; the engine only supports timed pauses, so to wait for a click write `wait` or add the seconds:

```text
pause 1.5     ← correct
pause         ← warning: treated as 0 seconds
```

This choice is deliberate: not silently dropped, and not making the whole project fail to open. The warning appears in the parse result; you will see it during development.

## notify

`notify` emits a toast; it does not establish a wait point — the toast floats up and the story keeps going:

```text
notify "Item obtained: copper key"
```

It can carry a type and duration:

```text
notify "Quest updated" type="quest" duration=3000
```

`type` is a string for the host to categorize; `duration` is milliseconds. The engine only emits it; what it looks like, how long it stays, which corner it sits in — all are the host's business.

Variable interpolation in the text works like `say`:

```text
notify "Gold +{reward}"
```

## Who releases the four wait points

| Op      | Wait state | Who releases     | What the host calls                                |
| ------- | ---------- | ---------------- | -------------------------------------------------- |
| `menu`  | `menu`     | Player picks one | `engine.choose(target-column)`                     |
| `input` | `input`    | Player submits   | `engine.input(value)`                              |
| `wait`  | `wait`     | Timer            | Automatic; with `skipable` also `engine.advance()` |
| `pause` | `wait`     | Timer            | Automatic. Not skippable                           |

The release authority for `menu` and `input` is with the host — the engine does not know which option the player clicked or what they typed; you must tell it.

`wait`'s timer is in the engine; it moves on when due. A `wait` with `skipable` can also be released early by `advance()`; without it, `advance()` reports "the current wait is not skippable (only a skipable wait can be released by click)".

## z-order

Both `menu` and `input` can carry an instance-level z, affecting only this one:

```text
menu "Where to next?" z=20
  "Go to the dock" -> dock
input "Name?" store="player.name" z=20
```

Omitting it removes the override, returning to the layer default. Writing an illegal value (negative, NaN) reports `instance-z-invalid` and changes no state.

## Next steps

- [Op reference · Interaction & minigames](/reference/ops/interaction/) — full arguments for `menu` / `input` / `minigame` / `interaction`.
- [Op reference · Dialogue & narrative](/reference/ops/dialogue/) — argument tables for `notify` / `wait` / `pause`.
- [Writing dialogue & portraits](/guides/dialogue/) — `say`'s inline markup and interpolation.
