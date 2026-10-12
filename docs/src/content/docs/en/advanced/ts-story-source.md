---
title: TypeScript Authoring
description: Put a Stories.src/ directory beside your project and write stories in plain TypeScript. The build compiles them to the same JSON the engine reads.
---

Besides hand-written `.story` files and editing JSON directly, there is a third way to write stories: put a `Stories.src/` directory next to your project root and write plain TypeScript.

The output is still the same JSON under `Resources/Stories/`, unchanged. The engine, the Rust layer and the editor all read JSON and know nothing about the TypeScript source — it exists at build time only, never at runtime.

```text
your-project/
├── Stories.src/          ← you write this
│   ├── config.ts
│   └── chapter1/start.ts
└── Resources/
    └── Stories/          ← build output; the engine reads this
        └── chapter1/start.json
```

## When to use it

Reach for TypeScript when the story is long, when it has many branches and loops, when you want the type system keeping your state keys honest, or when you want to pull a table of pure data out of an npm package. For changing two lines of dialogue, or a project already running fine on `.story`, don't migrate — this compile chain is still being finished, and what hasn't landed is listed under "Status" below.

## config.ts

`Stories.src/config.ts` is the only `.ts` allowed at the root of that directory. It declares which directories take part in the build and which file is the entry point:

```ts
// apps/playground/Stories.src/config.ts
export default {
  folders: ["chapter1", "chapter2", "chapter3", "chapter4"],
  start: "start.ts",
};
```

`folders` is an array of directory names relative to `Stories.src/`, each scanned recursively. Writing `"*"` means "every directory that holds a story is picked up automatically", which saves you returning to this file each time you add a chapter:

```ts
export default {
  folders: ["common", "*"],
  start: "main.ts",
};
```

An empty `folders` with no `"*"` fails the build rather than quietly compiling zero columns.

`start` is a story file name, `.ts` included, looked up by name across every directory. Exactly one file must match: zero matches or two or more both fail the build and list the candidates. The file that matches is written into `project.json` as `entry`.

Any other `.ts` at the root of `Stories.src/` is an error — you are meant to keep them in subdirectories.

## One file is a column, or none

There is a single rule, and it comes down to how the file exports:

```ts
// has a named default function → this is a column
export default function tavern(): void {
  say("Welcome in.");
}
```

`tavern` in `export default function tavern()` is the column id, equivalent to `label tavern:`. It has to be a `function` declaration — an anonymous arrow or `export default () => {}` fails with "default 导出必须是具名函数声明" ("a default export must be a named function declaration"), because there would be nowhere to take the column id from.

```ts
// only named exports, no default → a plain module, produces no column
export function farewell(who: string): void {
  say(`${who}, take care.`, who);
}
```

Plain modules hold functions and constants that story files `import`. The `farewell` above is used by `chapter1/inn.ts`; it produces no column of its own and can live in any directory.

Column ids are unique across the project, the same rule as the JSON form. Two files both declaring `export default function main()` is a duplicate column id, and the error carries both file locations.

## How statements become ops

This is the mechanism behind the whole mode: **the build statically compiles your TypeScript statements into an op sequence, and the engine runs it.** The TypeScript itself never executes — except for module-level constants, covered below.

| What you write                         | What it compiles to                                      |
| -------------------------------------- | -------------------------------------------------------- |
| `say(…)` / `menu(…)` / `guard(…)`      | the same-named op, shaped like the vocabulary layer      |
| `if (c) {…} else if (c2) {…} else {…}` | an `if` op with `cond` / `then` / `elif[]` / `else`      |
| `while (c) {…}`                        | a `while` op                                             |
| `for (let i = 0; i < n; i++)`          | `let` + `while`, advancing at the end of the body        |
| `for (const v of state.items)`         | a `for` op                                               |
| `switch (e) { case v: … }`             | a `switch` op; case values must be literals              |
| `break` / `continue`                   | `break` / `continue` ops bound to the nearest loop       |
| `function f(a, b) {…}` plus a call     | a `func` op hoisted to the column head, plus a `call` op |
| `let x = e`                            | a `let` op, a runtime local                              |
| `state.gold = 10` / `state.gold += 5`  | a `set` op, keeping `+=` semantics                       |
| `` `You have ${state.gold} gold` ``    | the string `You have {gold} gold`                        |

A function of yours is not inlined at each call site. It compiles to a real subroutine: the definition emits a `func` op hoisted to the head of the column's command sequence, and each call site emits a `call` op. Recursion works as a result.

```ts
function greet(who: string): void {
  say(`${who}, welcome to LingFan!`, who);
}

export default function start(): void {
  greet("traveler"); // → call greet, a real jump at runtime
}
```

Sharing a function across files needs `export` + `import`. A module-level function with no `export` is visible only inside its own file.

### How to import the vocabulary

There are three ways to get a vocabulary function out of `@lingfan/editor`, and all three work:

| What you write                                                   | What you get                         |
| ---------------------------------------------------------------- | ------------------------------------ |
| `import { say, menu } from "@lingfan/editor";`                   | the function itself, called directly |
| `import { script } from "@lingfan/editor";` then `script.say(…)` | the vocabulary namespace             |
| `import * as ct from "@lingfan/editor";` then `ct.say(…)`        | the whole namespace                  |

Rename with `as`: `import { say as greet }` and `import { script as ct }` both work, and the vocabulary functions follow the alias of the namespace.

The four forms below are build-time errors. The error text is quoted verbatim; the examples differ only in the import lines.

```ts
import script from "@lingfan/editor"; // ← default import

export default function start(): void {
  script.say("Default import.");
}
```

```text
故事编译失败（2 条）：
- ch1/start.ts:1:8 词汇层请以具名导入（import { say, … } from "@lingfan/editor"）或 script 命名空间使用
- ch1/start.ts:4:3 方法调用不支持：词函数通过具名导入或 script 命名空间调用
```

```ts
import * as v from "../lib/cast"; // ← namespace of a relative module

export default function start(): void {
  v.say("Namespace of a relative module.");
}
```

```text
故事编译失败（2 条）：
- ch1/start.ts:1:8 命名空间导入仅支持词汇层 script
- ch1/start.ts:4:3 方法调用不支持：词函数通过具名导入或 script 命名空间调用
```

```ts
import { say, notAWord } from "@lingfan/editor"; // ← no such word

export default function start(): void {
  say("A word that does not exist.");
}
```

```text
故事编译失败（1 条）：
- ch1/start.ts:1:15 词汇层不存在词 `notAWord`
```

```ts
import "@lingfan/editor"; // ← side-effect import
import { say } from "@lingfan/editor";

export default function start(): void {
  say("Side-effect import.");
}
```

```text
故事编译失败（1 条）：
- ch1/start.ts:1:1 副作用导入不支持：请显式导入所需符号
```

**Why only these two imports work**: the vocabulary is a build-time sub-language. Word calls are translated into ops statically at build time, and no `script` object exists at runtime. The compiler has to see which word you mean straight from the import statement, and only the named imports of `@lingfan/editor` and its `script` namespace carry that information.

`staticFor` is a compile-time loop — it expands into static commands rather than looping at runtime:

```ts
staticFor(3, (i) => [say(`Round ${i + 1}.`)]);
```

`i` is substituted with a literal at build time, so the output holds three separate `say` commands and no loop exists at runtime.

### What TypeScript you cannot write

These forms fail the build instead of being quietly ignored:

- `for (const k in obj)` — the engine has no object-key enumeration
- `state.a.b = e` — the engine's `set` key is a flat name; deep fields go through the `dictSet` word function
- `const f = () => {}` — custom functions only accept `function` declarations
- `return v` inside a function body — the engine's `call` has no return channel, so `return v` is stopped at build time rather than silently discarded at runtime

What you may write in condition expressions, `let` values and arguments is decided by the engine's expression grammar, not by a subset of TypeScript. Literals, `state.a.b` paths, local variable names, operator combinations and built-in function calls (`random`/`min`/`max`/`abs`/`clamp`/`arrayGet`/`dictGet`/`optGet`/`len`) are fine; calls to anything outside the built-ins, `new`, method calls, `typeof`, destructuring and spread all fail the build.

Optional chaining and element access are the exception to the exception: `state.player?.nick` is desugared into the engine's `optGet("player.nick")` (a missing path yields null; the `state.` prefix is stripped in the output), `state.bag[0]` into `arrayGet("bag", 0)`, and `state.cfg["speed"]` into `dictGet("cfg", "speed")`; `len(state.bag)` gives the length. All four are value-position only — `for...of` sources and assignment targets still require a path that really exists, and the path built-ins refuse a variable as the path (paths must be fixed at build time). Pair missing values with `??`:

```ts
let nick = state.player?.nick ?? "Stranger";
say(`Hello, ${nick}`);
state.last = state.bag[0] ?? 0;
say(`Items: ${len(state.bag)}`);
say(`Absent: ${state.cfg["ghost"] ?? "none"}`);
```

## npm dependencies

The rule in one line: **an npm package used as a source of pure data is supported; used as runtime behaviour it is not.**

The line falls between code at module level and code inside a function body.

### Allowed: module-level `const`

```ts
import { weatherTable } from "some-data-pkg";
import { cities } from "another-pkg";

const defaultCity = weatherTable[cities.beijing]; // other consts in the chain are fine too
```

This is actually executed once at build time, and the result is inlined into the JSON output. The package code itself does not enter the output; only the evaluated value does. That value must therefore be JSON-serializable — a scalar, an array, a plain object. Function values, class instances, `Symbol` and circular references are all errors.

The chain may reference other module `const`s and npm imports, but it **must converge on an exported `const`**. A non-exported const standing in the middle is rejected:

```text
模块层 const 引用了 node_modules 值导入——仅导出的 const 可经编译期求值内联
（请把 npm 值收敛为导出 const，§十二）
```

Evaluation may not depend on a non-deterministic source either: `Date.now()`, `new Date()`, `Math.random()`, crypto randomness, or file/network/process IO. The builder evaluates the same constant twice in isolated environments and compares the results; a mismatch is an error. That gate is enforced, not advisory.

### Not allowed: referencing an npm value inside a function body or control flow

```ts
import axios from "axios";

export default function start(): void {
  const http = axios.get("https://api.example.com/data");   // ← error
  if (http.status === 200) { … }
}
```

This case reports exactly one error — an npm value imported by a story file is stopped at the first evaluation gate, so it never reaches the ones further down:

```text
编译期求值失败（1 条）：
- Stories.src/ch1/start.ts:1:1 故事文件不支持 node_modules 值导入 `axios`——npm 值请收敛为纯模块的导出 const（编译期求值仅作用于纯模块），再经相对导入使用（§十二/C10）
```

The C10 error about "referencing an npm value inside a function body" needs a different setup to appear: put the npm import in a pure module and reference it inside a function body of that same module.

```ts
// Stories.src/lib/endpoint.ts
import { version } from "typescript";

export const v = version;

function describe(): void {
  say(version); // ← error
}
```

```text
故事编译失败（1 条）：
- lib/endpoint.ts:6:7 node_modules 值导入 `version` 仅限模块层 const 初始化链（§十二/C10）：函数体与其他语句不得引用
```

That one comes from `packages/stories-build/src/compiler/story-compiler/graph/bindings.ts:221`, and only if the module was evaluated at build time and the package resolves inside the project.

The compiler keeps one more fallback: when a file that was never evaluated imports an external package, `packages/stories-build/src/compiler/story-compiler/graph/imports.ts:81` refuses it with "导入仅限相对路径与词汇层既有出口，不支持外部包 `x`". The example above does not trip it.

Even if you got past all of this, `axios.get()` returns a Promise, which is not JSON-serializable.

**The underlying reason**: this mode is "compile statically into ops at authoring time, hand over to the engine at runtime". "Fire an HTTP request, then branch on the response" is a **runtime** behaviour, and it has to be expressed by an engine op. Running that `axios.get()` once at build time gives you the response your build machine happened to get — which has nothing to do with whether the game should send that request when a player runs it. The branch is fixed at compile time, so the player only ever takes that one path.

### The right way to do "request → branch"

Keep the npm value at module level as pure data, and leave the runtime behaviour to `extOp`:

```ts
import { defaultEndpoint } from "some-config-pkg";

const endpoint = defaultEndpoint; // ✅ module level, inlined as a string at build time

export default function start(): void {
  extOp("http.get", { url: endpoint, saveTo: "player.apiData" }); // the engine runs this
  if (state.player.apiData.status === 200) {
    // ✅ a runtime branch
    say("Request succeeded.");
  }
}
```

The command name passed to `extOp` only means something once the engine has actually registered it. Writing `extOp("http.get", …)` against an engine that has no such op behaves like any other unregistered command and does nothing — adding ops is engine-side work, see [Extending the Engine](/en/concepts/extensions/).

## Building and output

```powershell
pnpm stories:build        # compile once
pnpm stories:watch        # recompile on change
pnpm stories-typecheck    # tsc --noEmit type check
```

Output goes to `Resources/Stories/` with paths mirroring the source — `Stories.src/chapter1/start.ts` compiles to `Resources/Stories/chapter1/start.json`. A TypeScript source project manages its column set **wholesale**: a column the source no longer declares is deleted from the output directory, and every deletion is listed in the report.

Forgetting to add a new chapter to `folders` does not silently turn into a "stale deletion" — a `default` export found outside the covered set is an error.

A file with a `default` export whose directory `folders` does not cover fails with the file path in the message.

The editor treats a TypeScript source project's JSON output as read-only; change columns in the source.

## Status

TypeScript authoring is still being implemented and has not shipped. The build CLI, statement translation and compile-time constant evaluator have all landed and pass their tests, and the build chain is packaged: the entry point is a standalone `@lingfan/stories-build` package, and the `Stories.src/gen/stories.gen.d.ts` generated alongside your build hands your project's column names and interpolation keys to the IDE for instant checking. What is still missing is the incremental story for `stories:watch` — today it is `tsx watch` wrapping a full rebuild — and the generation source for the vocabulary layer's `staticFor` declaration.

Concretely, what you may run into while writing:

- The vocabulary layer's exports are source-generated: `vocabulary.g.ts` is produced by the generate-vocabulary CLI from the words/ sources, with fail-closed consistency checks. When the engine gains an op, one generation run syncs it — no hand-written export layer.
- Which command names `extOp` can call depends on what the engine has registered — this authoring mode adds no ops of its own.
- The `state` declaration lives in `Stories.src/config.ts` (the `define` accumulation form, evaluated at build time and flattened into flat defines); `export declare const state` is a types-only, zero-runtime shim provided by the `@lingfan/stories-build` package exports. It never enters the output and exists to give the IDE jumps and checks; precise type-face generation for the define form is still on the way, bridged by a wide index signature.

## Next

- [Story & Narrative Flow](/en/concepts/story/): the runtime rules for columns, wait points and jumps.
- [State & Variables](/en/concepts/state/): how paths like `state.gold` are read and written at runtime.
- [Extending the Engine](/en/concepts/extensions/): registering the custom ops `extOp` points at.
