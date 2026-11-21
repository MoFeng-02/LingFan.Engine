---
title: Stage Elements
description: Element rows in a scene column form the picture: 36 types in seven groups; unknown types and unknown attributes are both rejected. The element table is part of state and travels with saves and rollback.
---

Everything outside the dialogue box and menus — portraits, panels, buttons, progress bars — is written in a `scene` column. This kind of column has no command stream, only an element table.

```text
scene stage_demo
  panel x=5% y=10% width=90% zindex=10
    text "The chest on the left"
    text "The door on the right"
```

When you enter this column the element table is loaded into state; when you leave for a `label` column (flow) it is cleared.

## 36 types

Grouped by purpose into seven:

| Group       | Types                                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Text        | `text` `dialog` `narrator` `speaker`                                                                                                     |
| Interaction | `button` `choice` `imagebutton`                                                                                                          |
| Image       | `image` `background` `portrait` `video`                                                                                                  |
| Container   | `panel` `frame` `window` `dialogbox` `choicebox` `infobox` `overlay` `popup` `vbox` `hbox` `grid` `stack` `stackpanel` `canvas` `border` |
| Scroll      | `scroll` `scrollviewer` `viewport`                                                                                                       |
| Progress    | `bar` `vbar` `progressbar` `slider` `checkbox`                                                                                           |
| Spacing     | `separator` `spacer`                                                                                                                     |

Only container types can carry children. Writing nesting under `text` reports "`.children` is only allowed on container types (text is not a container: ELEMENT_CONTAINER_TYPES)".

## Two ways to write

Just write the type name bare:

```text
  text "A piece of text"
```

But the three names `video`, `background` and `window` collide with commands; written bare they are treated as commands. To write an element with the same name, add the `element` prefix:

```text
  element window x=0 y=0 width=100% height=100%
```

If the name after `element` is not an element type, it reports "the name after the element prefix is not a known element type: xxx".

Nesting relies on indentation; child levels only allow element rows:

```text
  vbox spacing=8
    text "First line"
    text "Second line"
```

Writing a command like `say` in a child level reports "only child element rows are allowed inside an element, not commands".

## Attributes and validation

Unknown types are rejected outright:

```text
.type must be one of the 36 element types, got "pannel" (unknown type fail-closed)
```

Unknown attributes likewise:

```text
.text.x is not a valid element attribute (attribute set = union of common and element-specific attributes, unknown fail-closed)
```

The attribute table covers position (`x` `y` `margin`), size (`width` `height` `minWidth` `maxWidth`), appearance (`opacity` `rotation` `scale` `cornerRadius` `borderThickness`), layout (`spacing` `direction` `columns` `rows` `col` `row` `colspan`), alignment (`align` `halign`), and more. The two attributes `class` and `style` hand the rest over to CSS.

The contract also declares a few attributes that are not yet implemented: `xanchor` `yanchor` `xalign` `yalign` `valign` `xoffset` `yoffset`. Writing them does not error, but they have no effect — the editor does not give you forms for these, and the diagnostics panel reports "element attribute xanchor is declared but currently has no rendering semantics (writing has no effect)".

`order` is a different matter: when `zindex` is not written the engine uses it as the stacking basis; see the stacking order below. The editor's diagnostics list currently groups it with the batch above, so writing `order` also receives the same warning — that one is a false positive.

A misspelled attribute name is not silently ignored — it errors at build time.

## Media fill

Five element kinds — image, image button, portrait, video, background — share one attribute `stretch` deciding "what to do when the image and the box are different sizes". There are only five values; anything else falls back to the default `cover`:

| Value        | Meaning                                                                   |
| ------------ | ------------------------------------------------------------------------- |
| `fill`       | Stretch each axis to fill; distortion allowed                             |
| `contain`    | Scale proportionally to show fully; letterbox the extra direction         |
| `cover`      | Scale proportionally to fill; crop the overflow (default)                 |
| `none`       | No scaling; original size centered                                        |
| `scale-down` | Take the smaller of `none` and `contain`, i.e. only shrink, never enlarge |

The default is `cover`, not `contain`: in a narrative picture, letterboxing that shows the base color is more jarring than cropping the edges; if the author did not write it, it should "fill".

These five words are a neutral vocabulary; each of the three ends maps them to its own notation — the engine side only stores the word, not CSS:

| End               | Expression                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| Browser / desktop | `<img>`, `<video>` write `object-fit`; background elements write `background-size` + `background-position`           |
| Mini program      | `<video>`'s `object-fit` only has `contain` / `fill` / `cover`, so `none` and `scale-down` both degrade to `contain` |
| Editor            | The dropdown shows these five words directly                                                                         |

The two ends not being verbatim identical is a platform fact, not unfinished work: CSS `background-size` has no `scale-down` (the background side degrades to `auto`), and the mini program's `object-fit` has only three values. Writing `scale-down` shows the `contain` effect on the mini program.

Background elements have an extra convention: their box is written by the engine as `100% × 100%` (as big as the stage); the author does not need to write `width` / `height` — a background has no "content size" to rely on, and leaving it blank would collapse to zero height so the image could not fill.

How big the element box itself is, and how the whole stage fits into the window, is another layer's concern; see [Screen adaptation](/guides/screen-adaptation/).

## Addressing: id and name

The two identifier fields have different roles:

```text
  text "HP" id="hp_label"
  text "HP bar base" name="hud"
  text "HP bar value" name="hud"
```

`id` must be unique and hits exactly one. `name` can repeat and hits all in bulk.

Target-based commands like `hide`, `zindex`, `style`, `animate` look by `id` first, then by `name` if not found. If neither hits it errors (`hide` is the exception — it does not error on a miss and can be called repeatedly).

When `id` is omitted it is auto-derived as `${column-id}#${index}`, where the index is the declaration order within the same level. This value is only a fallback; do not depend on it.

## Stacking order

`zindex` wins, then `order`, and if neither is present, declaration order:

```text
  panel zindex=10      // topmost
  image order=5        // middle
  text "Background text" // placed by declaration position
```

Smaller numbers are further forward. When `background` swaps the background it always uses the bottom order (-1000) — the one written in is always at the bottom, and all other elements draw on top of it. The exception is images appended by `show`: by default they stack above the background in append order, but afterwards writing a negative `zindex` (e.g. `-5000`) pushes them below the background, in which case the background covers them instead (see [Stage commands](/reference/ops/stage/)).

## Clicks

What an interaction element (`button` `choice` `imagebutton`) does when clicked is chosen by this priority:

```text
disabled  >  nav  >  ops  >  cmd
```

- If `disabled` is true it does not respond. You can write a boolean or the raw expression text:

  ```text
    button "Buy" disabled="{player.gold < 10}" cmd="buy"
  ```

  The expression is evaluated at the moment of the click. `enabled=false` is synonymous with `disabled`.

- `nav` jumps columns directly, going through the engine's `navigate`:

  ```text
    button "Go to the next chapter" nav="chapter_two"
  ```

- `ops` is an array of commands executed in order on click, written in JSON:

  ```json
  {
    "type": "button",
    "text": "Open the door",
    "ops": [{ "op": "set", "key": "door_open", "value": true }]
  }
  ```

- `cmd` is the name of a custom command registered by the host; on a hit it is handed to the host. If not registered it reports "element command not registered: xxx (fail-closed: the host must provide it via the command registry)".

These commands cannot be used in `ops`: `say` `menu` `input` `wait` `pause` `nvl` `cutscene` `minigame` (wait kinds), `jump` `navigate` `call` `return` (position kinds), `save` `load` `auto_save` `save_delete` (save kinds). Writing them in rejects the whole thing, reporting "say in element ops[0] cannot be used for a click action (wait/position/save ops would interrupt the current narrative stream)". Use `nav` to jump columns.

`ops` only takes effect on a waiting screen — while the player is looking at a screen. Clicks do not trigger while the command stream is running. If any one fails during execution, the whole sequence rolls back and state is the same as before the click.

Visual states like `hover_*`, `selected_*`, `disabled_*` do not interfere with click logic; each binds its own.

## Presentation commands

These 12 commands modify the element table or trigger effects, and can be used in any column:

| Command                                               | What it does                                           |
| ----------------------------------------------------- | ------------------------------------------------------ |
| `show "Images/box.png"`                               | Append an image; may carry `x` `y` `id` `name`         |
| `hide "hp_label"`                                     | Remove by `id`/`name`/resource path                    |
| `background "Images/bg.png"`                          | Swap background; fixed bottom order                    |
| `bg_switch "Images/bg2.png"`                          | Same, with a switch effect                             |
| `zindex "hud" value=20`                               | Change stacking order                                  |
| `style "hud" props={opacity: 0.5}`                    | Change attributes; keys must be in the attribute table |
| `window hide` / `window show` / `window auto`         | Dialogue box visibility                                |
| `animate "hud" property=opacity value=0 duration=0.5` | Single-property animation                              |
| `animate_block "hud" x=100 opacity=1 duration=0.4`    | Multiple properties animate together                   |
| `transition "fade" duration=0.5`                      | Full-screen transition                                 |
| `shake intensity=8 duration=0.3`                      | Screen shake                                           |
| `text_typewriter enabled=true speed=40`               | Typewriter switch and speed                            |

The core of `animate` and `animate_block` only records the single description "from where to where, over how long"; the per-frame intermediate values are computed by the presentation layer. When done it writes the final value back to the element attribute — so saves and rollback both see the end state, never some intermediate frame.

The multiple properties of `animate_block` start **simultaneously**, not sequentially. For serial, write multiple `animate`.

The `props` keys of `style` must be in the element attribute table; writing `props={width2: 100}` reports "style unknown element attribute: width2".

## Element text gets translated

An element's `text` attribute is looked up in the translation table at load time, and the translated value enters the state container. So after switching language, element text already on screen does not change; it updates only when you re-enter the column. Details in [Multilingual & translations](/concepts/i18n/).

## Rendering belongs to the presentation layer

The engine only manages the element table as a data structure. What it looks like drawn, and whether a type is recognized, is the presentation layer's concern — the template host registers a set of built-in renderers, and an unregistered type reports "element type not registered: xxx (fail-closed: it does not fake rendering)". If you write your own presentation layer, you must wire this layer yourself.

## Next steps

- [State beyond visual elements](/concepts/state/): the element table is also in the same state container.
- [Rollback & history](/concepts/rollback/): how element changes follow rollback.
- [Multilingual & translations](/concepts/i18n/): when element text is translated.
