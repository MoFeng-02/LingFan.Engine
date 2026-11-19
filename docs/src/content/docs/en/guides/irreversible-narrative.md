---
title: "Irreversible narrative: a no-rollback deployment"
description: Combine rollbackEnabled, historyLimit and game columns into a forward-only story; save/load still works.
---

Some stories deliberately have no "going back": one-shot choices, timed challenges, roguelike one-way journeys. The engine treats rollback as a deployment switch you can turn off wholesale, not a special case scattered across the code. Turning it off leaves the narrative semantics unchanged — it just folds away the "return to the previous line" path.

## Three knobs

| Knob                 | Where                                                                                        | Effect                                                                                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rollbackEnabled`    | Engine option (`new StoryEngine(story, { rollbackEnabled: false })` at the composition root) | Project-level master switch. When `false`, `back` / `forward` / `rollbackTo` are all rejected and checkpoints stop accumulating. Defaults to `true`, identical to prior behavior.                                               |
| `shell.historyLimit` | `project.json` → `shell.historyLimit` (positive integer)                                     | History capacity cap. `1` means "keep only the current frame". Invalid values are rejected at assembly time; if an invalid value still reaches runtime, the engine degrades to the built-in default 200 and emits a diagnostic. |
| `game` column        | Story source column kind `columnKind: "game"`                                                | Gameplay column. Hands a whole segment to a minigame / interaction system; the engine yields control and the segment never participates in line-by-line rollback.                                                               |

Together: `rollbackEnabled: false` folds away the rollback entry, `historyLimit: 1` keeps history from growing without bound, and `game` columns carry "play then move on" segments.

If you know Ren'Py, the comparison is direct: this engine's `rollbackEnabled: false` is the equivalent of Ren'Py's first-class `config.rollback_enabled = False` — one deployment switch that turns rollback off wholesale, leaving narrative semantics unchanged, rather than a per-segment patch.

## What happens once it is off

- **Rollback is rejected, state untouched.** Any `back` / `forward` / `rollbackTo` call fails closed: the engine emits a `rollback-disabled` diagnostic and the screen and state stay exactly as they were. Host controls (wheel rollback, history-panel buttons) read the engine's single read surface `rollbackAvailable()` and hide or disable themselves accordingly — controls do not compute a second copy of the judgment.
- **Checkpoints do not accumulate.** With `rollbackEnabled: false` the engine stops building a checkpoint per line; history length stays 0, so a long run does not eat memory.
- **Save/load still works.** Saving is a separate path: `save` / `load` are unrelated to rollback. Players can still save, load, and continue from the last save; loading restores "the moment of the save", not "the previous line".

## Op-level temporary lock

To lock rollback only for a short segment (say, an unskippable cutscene) without turning off rollback for the whole project, use two commands:

```text
block_rollback
say "You cannot go back during this segment."
fix_rollback
```

`block_rollback` sets the session-level lock key true; `fix_rollback` unlocks it. The lock is **session state**: it goes into snapshots, not into saves — it does not linger after loading. It is a different layer from the project-level `rollbackEnabled`: `fix_rollback` releases the op-level temporary lock but cannot release the project-level master switch. While locked, rollback is rejected with diagnostic code `rollback-locked`.

## Host wiring

The composition root passes the switch to the engine; host controls read `rollbackAvailable()`:

```ts
const engine = new StoryEngine(story, {
  rollbackEnabled: false, // project-level master switch
  historyLimit: 1, // or supplied by project.json shell.historyLimit
});

// Wheel rollback and history buttons both ask this first; controls keep no second copy
if (!engine.rollbackAvailable()) return;
engine.back();
```

`rollbackAvailable()` = project master switch × op-level lock, the single source of truth for "can I roll back". The engine's own `back` / `forward` / `rollbackTo` go through the same guard, so even if a control forgets to check, state cannot be corrupted.

## Notes

- Turning off rollback is a **deployment shape**, not a change to narrative semantics: `say` / `menu` / variables / media all behave as before; only the "go back" path is folded away.
- `historyLimit` only affects history capacity, not saves; "one-way but still save/loadable" is exactly the `rollbackEnabled: false` + normal save/load combination.
- When migrating an old save, history checkpoints each go through the same migration pipeline; checkpoints that cannot migrate are truncated individually with a `load.notice`, and the save progress itself is unaffected.
