---
title: State & Variables
description: Variables with set, let and local; collections with array and dict; text interpolation with {expr}. Globals follow saves and rollback; block-level ones do not.
---

Variables in a story land in one of two places: the **global layer** or the **current scope**. Keep that split straight and saves and rollback stop surprising you.

## Writing a variable

```text
label title_main:
  set "player.name" "A-Lan"
  say "Hello, {player.name}."
```

`set` first walks the current scope chain looking for a variable of that name; if it finds one it writes there, and if it does not it writes to the global layer. So the first `set` creates a global.

`let` and `local` are different: they always declare into the innermost scope.

```text
label title_main:
  if {has_key}
    let "hint" "You are holding the key"
    say "{hint}"
  say "{hint}"
```

Blocks are delimited by indentation — there is no closing keyword like `endif`. `hint` is declared inside the `if` block, so it is gone once the block ends; when that last `say` interpolates and cannot find `hint`, the engine emits the `unknown-variable` error on `engine.error`, renders the body as the original text (`{hint}`), and the story keeps waiting for the player's click — the error is neither silently swallowed nor does it halt the project.

Block and column variables never enter saves and take no part in rollback; they die with their execution frame. Globals travel with snapshots, saves and rollback.

## Changing an existing value

```text
  set "coins" 10
  set "coins" += 5
```

`+=` `-=` `*=` `/=` `%=` are all supported, and only for numbers. Division and modulo by zero report `division-by-zero` outright rather than handing you `Infinity`.

## Constants

`define` only assigns when the variable does not already exist, which makes it a good fit for configuration:

```text
define "max_hp" 100
set "max_hp" 200
say "{max_hp}"
```

That second line is a plain `set` and really does overwrite it. `define` only guarantees who writes the value first.

`undef` deletes a variable. If neither the scope chain nor the global layer holds it, the engine reports `undef: undefined variable X` and stops — check that it exists before deleting.

## Collections

```text
  array "inventory" ["key", "letter"]
  array_push "inventory" "map"
  array_pop "inventory"

  dict "player" { "name": "A-Lan", "hp": 100 }
  dict_set "player" "hp" 80
```

`array_push` requires the target to exist and be an array; `array_pop` errors on an empty array instead of handing you `undefined`. `dict_set` requires a dictionary — an array does not count.

These commands all write a new array or dictionary reference rather than mutating in place, which is what lets the renderer notice the value changed.

`random` draws an integer from an inclusive range:

```text
  random seed=20261010 min=1 max=6 var="dice"
  say "Rolled {dice}."
```

The seed goes into state, so replaying the same story through rollback draws the same sequence of numbers. `seed` must be an integer, and `min` cannot exceed `max`.

## Expressions

Conditions, interpolation and variable values all accept expressions:

```text
  if {coins >= 10 && has_key}
    say "You can open the door now."
```

Supported: `== != >= <= > < && || + - * / %`, unary `!` and `-`, the ternary `? :`, and parentheses. `>=` `<=` `>` `<` take numbers only; `==` `!=` take same-type scalars only (numbers, strings, booleans) — crossing types reports `type-error`; `&&` `||` `!` take booleans only — any wrong type reports `type-error` rather than quietly computing `NaN`.

There are exactly five built-in functions: `random(lo, hi)` (inclusive, integer arguments only), `min(a, b)`, `max(a, b)`, `abs(a)` and `clamp(v, lo, hi)`. Any other name reports an unknown-function error listing those five.

An expression error stops execution and emits the error on the `engine.error` event; it does not fall back to a default value.

## Interpolating values into text

```text
  set "minutes" 7
  say "{minutes:00} minutes left."
```

`{minutes:00}` renders as `07`. Format specifiers work on integers only: all zeros pad to that many digits, `X` emits uppercase hexadecimal, `x` lowercase, and anything else passes through unchanged.

Text also carries a set of inline markers sharing the braces with interpolation:

```text
  say "This is {b}bold{/b} and this is {color=#7aa2f7}blue{/color}."
  say "One beat{p}before speaking."
```

`b` `/b` `i` `/i` `u` `/u` are styles, `color=` `font=` `size=` take arguments, and `{p}` pauses, `{w}` waits, `{fast}` fast-forwards. All of these pass through to the renderer untouched and take no part in evaluation.

`{i}` is ambiguous, though: if you have a variable named `i` it evaluates as that variable, and without one it passes through as an inline marker. Naming your variables something else saves trouble.

When interpolation fails, the original fragment stays in the text and the error is collected rather than interrupting rendering.

## Reserved keys

Keys starting with `__` belong to the engine — `__current_dialog_text` and `__waiting`, for example. Writing them programmatically is refused with `reserved-key`. Keys you define yourself, like `__foo`, are unaffected; the check matches exact key names.

## Observing state changes

The host receives every write through `engine.onStateChanged`:

```ts
engine.onStateChanged((change) => {
  console.log(change.key, change.value, change.scope);
});
```

`scope` is `"global"`, `"column"` or `"block"`, telling you which layer that write landed in.

## Next

- [Rollback & History](/en/concepts/rollback/): how variables rewind along with rollback.
- [Save System](/en/concepts/saves/): which state goes into a save and which does not.
- [Extending the Engine](/en/concepts/extensions/): how extensions read and write state.
