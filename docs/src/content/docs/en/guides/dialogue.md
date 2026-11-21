---
title: Writing Dialogue & Portraits
description: How to write a say line, where the speaker and color come from, how inline markup and variable interpolation coexist, and how to use pause markers and full-screen narration.
---

Dialogue is a string of `say`. Each `say` establishes a wait point; the player clicks or presses a key to move on.

## A line of dialogue

```text
label start:
  say "Eleven at night, and the rain still had not stopped."
  say "The shop on the corner still had its lights on."
```

The first quoted string after `say` is the body. In the text form, a missing body reports "say is missing a text string" at parse time and rejects the whole file; in the JSON form it reports `say-invalid` at runtime. Neither lets an empty line through.

`{` in the body has special meaning; see the interpolation and inline-markup sections below.

## Who is speaking

`speaker=` or `by=` assigns a speaker to this line; the two are equivalent:

```text
say "You're late." speaker="A-Che"
say "Traffic was bad." by="Lin"
```

The speaker is shown above the dialogue box. Without it there is no speaker, only the body.

`character` registers a character first; afterwards `say`'s `speaker` can look it up:

```text
character "A-Che" name="A-Che" color="#7aa2f7" textColor="#c0caf5"
say "You're late." speaker="A-Che"
```

`character` supports six fields — `name` / `color` / `size` / `font` / `textColor` / `screen`; write only the ones you want to change. **A second `character` with the same name replaces the whole entry, it does not merge** — if the first wrote `color` and the second writes only `name`, the color is gone.

`character`'s `key` is the name used for lookup; `say speaker` hits only with the same string. To unregister a character mid-story use `uncharacter "A-Che"` — subsequent `say` no longer applies its colors; a missing key only emits an informational event without stopping, and unregistration rolls back with rollback.

## Color

Three places can set the speaker color, highest priority first:

1. `say color="#FFD700"` — affects only this line.
2. `character`'s `color`.
3. Neither — then it is the empty string, and your host decides what to display.

`say color` accepts only hexadecimal: `#888`, `#FFD700`, `#FFD700CC` all work; writing `red` reports `say-invalid-color`.

```text
say "Don't move." speaker="A-Che" color="#f7768e"
```

Color is **override** semantics: if this line writes it, it is written; if not, the empty string is written. So the previous line's red does not leak into the next.

## Inline markup

The body can carry style markers, rendered as the corresponding effects:

| Marker                       | Effect      |
| ---------------------------- | ----------- |
| `{b}` `{/b}`                 | Bold        |
| `{i}` `{/i}`                 | Italic      |
| `{u}` `{/u}`                 | Underline   |
| `{color=#FFD700}` `{/color}` | Colorize    |
| `{font=楷体}` `{/font}`      | Change font |
| `{size=22}` `{/size}`        | Change size |

```text
say "He said: {b}don't move{/b}. Then {color=#f7768e}the lights went out{/color}."
```

Note `{color=#FFD700}` colorizes **a span of text**, while `say color=` colorizes **the speaker**. The names are similar; the roles differ.

Markers may be left unclosed; rendering fills them in. Writing them wrong only looks odd — it does not make the project fail to open.

## Variable interpolation

`{variable-name}` in the body is replaced with the variable's value:

```text
set "player.gold" 7
say "You have {player.gold:000} gold coins."     →  You have 007 gold coins.
set "code" 255
say "In hexadecimal it is {code:X}."             →  In hexadecimal it is FF.
```

`0` is the zero-pad width, `X` is uppercase hex, `x` is lowercase. A format on a non-number value has no effect; it is output as-is.

Arrays and dicts cannot be interpolated into text directly; it reports `type-error` with the message "text interpolation does not support array/dict values". To display one, first take an element out and store it in a variable.

### Interpolation and inline markup name collisions

`{i}` could be either the italic marker or the variable `i`. The rule is:

- `i` is defined → treat as a variable, interpolate.
- `i` is not defined → treat as a marker, italic.

So do not use `b` / `i` / `u` / `w` / `p` / `fast` / `color` / `font` / `size` as variable names. If you really must, write a path other than `{i}`, such as `player.i`.

Interpolation failure does not crash the game: the original text is shown as-is, and the engine also throws an error to the host. This is deliberate — a typo in one line should not make the whole project fail to open.

## Typewriter & pauses

The dialogue box displays character by character by default. Three control markers govern the rhythm:

| Form           | Role                                                          |
| -------------- | ------------------------------------------------------------- |
| `{p}` or `{w}` | Pause here when typed, wait for one player click to continue  |
| `{fast}`       | From here on, no longer character-by-character; show directly |

```text
say "The rain was still falling.{p} He handed over the umbrella."
```

Style markers are zero-width — `{b}` takes no typing time and does not appear in the characters the player sees. The prefix shown mid-typing is always a complete marker; a half like `{b` is never exposed.

Three outcomes of a player click: stopped at `{p}` → skip the pause and keep typing; not finished typing → finish typing directly; already finished → move on. These three levels are the same click entry; your host just calls `advance()` once.

Story-level speed is set with `text_typewriter`:

```text
text_typewriter speed=30
```

`speed` is characters per second. You can also `text_typewriter enabled=false` to turn off character-by-character directly, or write both together. Writing `enabled` without `speed` keeps the previous speed value.

If a player preference exists, it takes priority over the story setting — this is host-layer composition; the engine only writes state.

## Full-screen narration

`nvl` accumulates the following `say` into a full-screen text layer instead of replacing the dialogue box line by line:

```text
nvl
say "Chapter One"
say "After that day, things got complicated."
nvl clear
say "Chapter Two"
```

Four subcommands:

| Subcommand       | Role                                         |
| ---------------- | -------------------------------------------- |
| (none)           | Enter the accumulation layer                 |
| `auto` / `enter` | Same as none; enter the accumulation layer   |
| `clear`          | Clear accumulated content, keep accumulating |
| `exit`           | Clear and exit the accumulation layer        |

Accumulated content travels with state; rollback and load both restore the content along with it.

## Voice

`voice=` binds voice to this line; it stops automatically when the player advances past it:

```text
say "You're late." speaker="A-Che" voice="Audio/voice/ache_01.mp3"
```

Voice uses an independent voice channel, not interfering with `bgm` / `ambient` / `se`. To stop it manually use `stop_voice`.

## Portraits

`character` only governs name and style, not the image. A portrait is a stage element, added to the element column with `show`:

```text
scene stage:
  show "Images/ache.png" id="ache" x=10% y=0
  say "You're late." speaker="A-Che"
```

`show`'s positional argument is the resource path, written into the element's `source`. `id=` gives it a name; afterwards `hide "ache"`, `zindex "ache" value=5`, `animate "ache" ...` all address it by this name.

Element columns (columns starting with `scene`) load as a whole on entry and clear on exit. So a portrait written in a `scene` column enters and exits with the column.

`show`'s element type is `image`. For finer control — such as using the `portrait` type, adding buttons, wrapping in a container — write element lines directly in the `scene` column; those are declarative and do not go through ops.

Portraits and the dialogue layer are two layers, each governing its own. The dialogue layer's z is set with `say z=`, affecting only that line; the element layer's z uses `zindex` or the element's own `zindex=` attribute.

## Next steps

- [Menus, input & notifications](/guides/menu-input/) — the remaining three wait points.
- [Op reference · Dialogue & narrative](/reference/ops/dialogue/) — full argument tables for `say` / `nvl` / `character` / `uncharacter` / `notify` / `wait` / `pause`.
- [State & variables](/concepts/state/) — how the variables in interpolation are stored.
