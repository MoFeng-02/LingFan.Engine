---
title: Minigames & Gameplay Systems
description: minigame hands control to a factory registered by the host and returns a result when done; interaction lets a gameplay system take over the whole screen. Neither changes the narrative coordinate, and rollback interrupts them.
---

When the story needs to insert a stretch of gameplay mid-way — rock-paper-scissors, a puzzle, fishing, a riddle — use `minigame`. When an external system needs to take over the whole screen (a battle UI, a map), use `interaction`.

The mechanism is the same for both: the engine sets up a waiting screen, hands control out, waits for the result to come back, and branches on the result. The engine does not care what the gameplay looks like.

## Starting a minigame

```text
  minigame "coin_flip" on_success "win" on_fail "lose" config {rounds: 3} reward {coins: 10}
```

Grammar:

```text
minigame "game" [on_success "column"] [on_fail "column"] [config {…}] [reward {…}]
```

`game` is required; it is the minigame identifier, restricted to starting with a lowercase letter and containing lowercase letters / digits / `_` / `-`, at most 32 characters. Invalid input reports "minigame.game is required and must be a valid system identifier (matching /^[a-z][a-z0-9_-]{0,31}$/)".

`config` is passed through to the host verbatim; the engine does not interpret the keys inside. `reward` is a set of key-value pairs, written only on success.

When this command executes:

1. A waiting screen is set up (`__waiting` becomes `minigame`).
2. A checkpoint is recorded — the player can roll back here, and auto-save works too.
3. A `minigame.mount` event is emitted, carrying `game`, `config`, `seq` and a `signal`.

When `on_success` / `on_fail` are omitted there is no jump; the current column continues downward.

## The host registers factories

The engine does not manage how the game runs; it only recognizes factories in the host registry:

```ts
const minigames = createMinigameRegistry();

minigames.register("coin_flip", async (host, ctx) => {
  const rounds = Number(ctx.config.rounds ?? 1);
  const result = await runCoinFlip(host, rounds, ctx.signal);
  return { outcome: result.won ? "success" : "fail", score: result.score };
});
```

The factory signature is `(host, ctx) => Promise<MinigameResult>`:

| Argument     | What it is                                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `host`       | The mount container provided by the host. The contract only says "there is something to mount onto"; the concrete type is narrowed by the host itself |
| `ctx.config` | The `config` from the command, verbatim                                                                                                               |
| `ctx.signal` | The abort handle, see below                                                                                                                           |
| `ctx.seq`    | The monotonic sequence number of this mount, used to distinguish replays                                                                              |

Return value:

```ts
{ outcome: "success" | "fail", score?: number, state?: Record<string, unknown> }
```

The engine does not consume `score`; it is left for the UI to display. The keys in `state` land one by one under the `game.<game-id>.` namespace — the factory does not need to build the prefix itself, and should not write bare global keys.

When the registry has no such `game` identifier there is **no default fallback**. The template host shows a notice: "The story entered a minigame wait: coin_flip. This template ships no minigame registry (fail-closed: it does not fake completion) — to support it in the host, register with `createMinigameRegistry` and call engine.resolveMinigame(result) after the mount event." It does not pretend the game was played.

## Returning the result

```ts
engine.resolveMinigame({ outcome: "success", state: { best: 12 } });
```

On success the `reward` is written into state item by item first, then it jumps to `on_success` or `on_fail` according to `outcome`. On failure `reward` is not written, but `state` still is — even a loss records the score.

An invalid result is rejected wholesale; the pending state is preserved, and once corrected it can be returned again:

| Error code                 | When                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `minigame-resolve-invalid` | Not currently in a minigame wait: `resolveMinigame is only valid during a minigame wait (current __waiting=dialog)` |
| `minigame-result-invalid`  | `outcome` is not `success`/`fail`, `score` is not a finite number, `state` is not an object                         |
| `minigame-state-corrupt`   | The wait state exists but there is no pending record                                                                |

If one key in `state` cannot be written, the whole batch is not written.

## When it gets interrupted

When the player rolls back, loads a save, navigates to another column, or the engine is disposed, `signal.aborted` is set. At that point the minigame must wrap up immediately and **not** return a result — the engine will not accept it.

When rolling back to the minigame screen, the engine re-mounts: a new `seq`, a new `signal`. So the factory must rebuild state on every mount and cannot assume "the previous round is still there".

The layer the minigame occupies is `minigame`, above the dialogue box and choices.

## Gameplay system takeover

`interaction` uses the same mechanism as minigames; the difference is that it carries a `system` identifier and can mount several different external systems:

```json
{
  "op": "interaction",
  "system": "battle",
  "config": { "enemy": "slime" },
  "on_success": "battle_win",
  "on_fail": "battle_lose",
  "z": 1200
}
```

`system` is written the same way as `game` (starts with a lowercase letter, at most 32 characters); invalid input reports "interaction.system is required and must be a valid system identifier (matching /^[a-z][a-z0-9_-]{0,31}$/)".

`interaction` has **no text form** — `minigame` can be written as a single line of text, but it cannot. Write this command in JSON form in the story file.

Return:

```ts
engine.resolveInteraction("battle", { outcome: "success", state: { hp: 30 } });
```

The first argument is the system identifier; if it does not match the one at start it reports "resolveInteraction system identifier mismatch: expected battle, got fishing". The other error codes correspond one-to-one with minigames (`interaction-resolve-invalid`, `interaction-result-invalid`, `interaction-state-corrupt`).

When `config` is not an object it reports "interaction.config must be an object (passed through to the host verbatim)".

## How to write gameplay state

The host changes state inside a gameplay system via `engine.gameState`:

```ts
engine.gameState.set("hp", 30); // enters the event stream; the UI can respond
engine.gameState.setSilent("cursorX", 120); // does not enter the event stream
engine.gameState.setScoped("battle", "hp", 30); // lands at game.battle.hp
engine.gameState.setScopedSilent("battle", "cursorX", 120);
```

The difference between `set` and `setSilent` is the event stream: `set` emits a state-change event so the UI can respond immediately; `setSilent` does not. Use `setSilent` for coordinates and mouse positions that change every frame — otherwise dozens of events per second would flood the UI. Use `set` for low-frequency changes like picking up an item or completing a quest.

`setScoped` automatically adds the `game.<system>.` prefix; no need to build it yourself.

These keys live in the same state container as story variables, so they travel with saves, snapshots and rollback. The gameplay system does not need to write its own save logic.

Values that cannot be written (functions, `Map`, circular references) are rejected, and state stays as it was.

## A complete example

```text
label fishing_spot:
  say "Something stirs on the water."
  minigame "fishing" on_success "caught" on_fail "missed" config {difficulty: 2} reward {fish: 1}

label caught:
  say "Got one!"
  jump fishing_spot

label missed:
  say "The fish got away."
  jump fishing_spot
```

```ts
minigames.register("fishing", async (host, ctx) => {
  const difficulty = Number(ctx.config.difficulty ?? 1);
  const won = await runFishingMinigame(host, difficulty, ctx.signal);
  if (ctx.signal.aborted) return { outcome: "fail" }; // interrupted by rollback; the result will not be accepted
  return { outcome: won ? "success" : "fail", state: { attempts: 1 } };
});
```

## Next steps

- [Rollback & history](/concepts/rollback/): why rollback makes a minigame re-mount.
- [Save system](/concepts/saves/): how gameplay state travels with saves.
- [Extending the engine](/concepts/extensions/): adding custom commands for minigames.
