---
title: Rollback & History
description: The engine builds checkpoints at wait points; when the player rolls back it returns to the previous checkpoint and re-executes. Re-choosing truncates later history, and rollback also interrupts a running minigame.
---

When the player clicks "back", the story returns to the previous screen. This is not scrolling the UI backwards — the engine genuinely returns to that command and re-executes from there. So variables, random numbers and stage elements all go back with it.

## Where checkpoints are built

Only wait points build checkpoints. Commands that run and move on leave no trace.

| Command                                 | Checkpoint                             |
| --------------------------------------- | -------------------------------------- |
| `say`                                   | Yes                                    |
| `menu`                                  | Yes                                    |
| `wait` / `pause`                        | Yes                                    |
| `input`                                 | Yes                                    |
| `cutscene`                              | Yes                                    |
| `minigame` / `interaction`              | Yes                                    |
| `jump` / `navigate` / `call` / `return` | No                                     |
| `video`                                 | No (non-blocking; the story continues) |

A `say`'s checkpoint is snapshotted the moment it appears on screen, but is only committed once you leave that screen. This makes "what you saw is history": after rolling back and going forward again, you return to the line you just saw.

Columns with `type=ui` take no part in history at all — they build no checkpoints and do not enter the history list. Use them for title screens, pause menus and status panels, so the player's rollback record is not cluttered with these temporary screens.

## Rolling back one step

```ts
engine.back();
```

Pressing back while stopped on a screen first commits the current screen, then returns to the one before it. Pressing again when already at the earliest retained checkpoint reports `history-empty` ("already rolled back to the earliest retained point").

To decide for yourself whether a rollback is possible, read two numbers:

```ts
engine.historyLength(); // number of committed checkpoints
engine.historyCursor(); // current cursor; less than historyLength() - 1 after rolling back
```

## Rolling back to a specific position

```ts
engine.rollbackTo(12); // the 12th checkpoint (counting from 0)
engine.rollbackTo({ columnId: "chapter_two", index: 8 }); // the nearest checkpoint before this coordinate
```

An index is an exact position. A coordinate means **take the nearest checkpoint before that coordinate** — if no checkpoint was built at that position itself, it lands on the wait point before it. Not finding one reports `rollback-target-not-found` ("no checkpoint before the coordinate: (columnId, index)"); an out-of-range index reports `rollback-target-out-of-range` ("checkpoint index out of range: N (M total)").

If the story has not started, or a previous rollback has not finished and you call again, it reports `rollback-invalid` ("the story has not started") and `rollback-in-progress` ("replay in progress; re-entry refused").

## Going forward

```ts
engine.forward();
```

Pressing again when already at the newest point reports `no-forward` ("no history to go forward to (already at the newest point, or the timeline has branched)").

"Branching" works like this: you roll back to checkpoint 5, then choose a different option. The engine records new history from there, and the original checkpoints 6, 7, 8 are truncated — you have already walked away from that path.

```text
Checkpoints: 0 1 2 3 4 [5] 6 7 8      ← rolled back to 5, cursor stays at 5
Checkpoints: 0 1 2 3 4 [5] 6'         ← chose another option; 6 7 8 were cut off
```

There is a cap on the total number of checkpoints, default 200. When full, the oldest end is dropped, so the player cannot roll back any earlier.

## What rolls back with it

| Content                            | After rollback                                                     |
| ---------------------------------- | ------------------------------------------------------------------ |
| Global variables                   | Return to their values at the checkpoint                           |
| Random state                       | Returns to the seed at that moment; replay draws the same sequence |
| Function table                     | Returns to that moment                                             |
| Stage elements                     | Return to the whole tree at that moment                            |
| Block- and column-scoped variables | Restored with the snapshot (scopes deep-copied, unlike saves)      |
| Minigames, interaction systems     | Receive an abort signal and wind down immediately                  |
| A running `wait` timer             | Cleared; re-timed on replay                                        |

The last two rows are where rollback most easily goes wrong: without interrupting them, an old minigame would keep running in the background after rollback, and a waking timer would modify state that has already been rolled back. The engine handles both before rolling back.

## Data for a history panel

```ts
engine.historyView();
// [{ index, coord, speaker, text, nvl, nvlLines }, ...]
```

Each entry corresponds to a checkpoint. `speaker` and `text` are the person and line on screen at that moment; `nvl` marks whether it was NVL full-screen mode, in which case `nvlLines` carries the whole accumulated block of text. Build a dialogue-log panel straight from this — no need to store your own.

## Error reference

| Error code                     | Message                                                                                 | When                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `rollback-invalid`             | the story has not started / cannot roll back now / cannot go forward now                | no `start()`, or replay has not finished                               |
| `rollback-in-progress`         | replay in progress; re-entry refused                                                    | the previous rollback has not finished and you called again            |
| `rollback-target-not-found`    | no checkpoint before the coordinate: (columnId, index)                                  | positioning by coordinate, and there really is no checkpoint before it |
| `rollback-target-out-of-range` | checkpoint index out of range: N (M total)                                              | the index is out of range                                              |
| `history-empty`                | already rolled back to the earliest retained point                                      | you have rolled back to the start                                      |
| `no-forward`                   | no history to go forward to (already at the newest point, or the timeline has branched) | nothing to go forward to                                               |

All these errors come out through the `engine.error` event, with `code` as the first column above. The player clicked a useless button; the UI should not crash — just show the message.

## Next steps

- [Save system](/concepts/saves/): saves and history are two separate things; what each records.
- [State & variables](/concepts/state/): which variables roll back with it.
- [Minigames & interaction](/concepts/minigame/): what to do when an external system is interrupted.
