---
title: Story & Narrative Flow
description: A story is a set of columns. The engine runs commands from the entry column and stops at wait points. Jumps move execution; rollback moves the history cursor.
---

A story is a set of **columns**. The engine starts at the first command of the entry column, walks down one command at a time, and stops at a **wait point** for the player.

## Columns

A column is written one of two ways.

`label` opens a column of commands, executed in order:

```text
label title_main:
  say "First line."
  say "Second line."
  menu "Where to?"
    "Left" -> left_path
    "Right" -> right_path
```

`scene` opens a column of **elements** — things that stay on stage rather than disappearing as dialogue advances:

```text
scene stage_demo
  panel x=5% y=10% width=90% zindex=10
    text "I am an element, not dialogue"
  say "The elements are already loaded when this column is entered."
```

A `scene` column can hold commands too, written after the elements. For the full rules on elements, see [Visual Elements](/concepts/elements/).

Column ids are unique across the project and may cross files. File names are unrelated to column ids; the error is two files declaring the same column id.

## Wait points

The engine stops at these commands and waits for the player:

| Command       | Waits for                                           |
| ------------- | --------------------------------------------------- |
| `say`         | The player clicking or pressing Space               |
| `menu`        | The player picking an option                        |
| `input`       | The player typing a line of text                    |
| `wait`        | The timer to finish, or the player clicking to skip |
| `pause`       | The timer to finish. Cannot be skipped              |
| `cutscene`    | The video to finish playing                         |
| `minigame`    | A result from the minigame                          |
| `interaction` | A result from the interaction system                |

`video` does not stop — playback starts and the story keeps going. When you need "play to the end, then continue", use `cutscene`.

`jump`, `navigate`, `call` and `return` do not stop either; they transfer control, continuing execution somewhere else. Extension ops produce no wait points either.

## Jumps

`jump` moves to a column:

```text
  jump chapter_one
```

`navigate` jumps by column id the same way, but takes an extra `scene` parameter and clears the dialogue mirror left behind by the previous column:

```text
  navigate "chapter_one"
  navigate "chapter_two" scene "chapter_one"
```

Both arguments are column ids, not file paths — files are flattened into columns at assembly time, and "file" does not exist at runtime. When `scene` is present it wins over `path`, so the second line above actually jumps to `chapter_one`.

Writing `scene "target"` inside a column is equivalent to `navigate "target"`:

```text
  scene "chapter_one"
```

`call` jumps out and `return` comes back — for reusing a shared stretch of flow:

```text
label title_main:
  call show_warning
  say "Back again."

label show_warning:
  say "This is a warning."
  return
```

## Column types

Columns default to story columns (`game`): they enter history, can be saved, and build a checkpoint at each wait point.

The other two types take no part in history and build no checkpoints:

```text
scene pause_menu type=menu
  say "Menu scene."

scene status_panel type=ui
  say "Status panel."
```

Use them for title screens, pause menus and status panels so those transient screens never land in rollback history. Moving from a story column into one of these, the engine notes the progress from before the entry; a save made inside such a column stores the game position from before it, not the menu itself.

`type` only needs writing when it is not the default. Today `menu` and `ui` behave identically inside the engine — no scenario has needed them distinguished yet, so either one runs the same.

## Entry column

The `entry` field of `Resources/project.json` names the starting column:

```json
{
  "entry": "title_main"
}
```

If the entry column does not exist, the whole project fails to load with "project.json: entry column X does not exist (jump targets must exist)". A single-file story that names none defaults to its first column.

## How a column ends

When a column's commands run out with no jump, the story simply stops there. Continuing takes an explicit jump:

```text
label chapter_one:
  say "Chapter one ends."
  jump chapter_two
```

## Next

- [State & Variables](/en/concepts/state/): how data moves between commands.
- [Rollback & History](/concepts/rollback/): how the player gets back to an earlier position.
- [Save System](/en/concepts/saves/): what a save actually stores.
