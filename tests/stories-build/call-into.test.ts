/**
 * call into 结果通道 · 编译器降糖与取值形态。
 *
 * 语句级 `const x = f(1)` / `let x = f(1)` 是子程序取值的**唯一**合法形态：编译器降糖
 * 成 `{op:"call", target, args, into:"x"}`，引擎把带值 return 声明成调用方局部变量
 * （无带值 return / 函数体自然跑完则绑 null）。表达式位（插值、赋值右值）仍拒绝——
 * 求值是命令内同步一步，中途不能挂起等 call 返回。
 *
 * 本文件把断言钉在**产物字节**上（call 的 target/into/args、func 的 body、return 的
 * value），走真实编译器；别名直连一条锁「refs 归位到声明文件」——键控丢 file 段或
 * target 用调用点局部名都会在这里转红。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildStories } from "@lingfan/stories-build";

const BASE = fileURLToPath(new URL("./.tmp-call-into/", import.meta.url));

afterEach(() => {
  rmSync(BASE, { recursive: true, force: true });
});

function makeProject(name: string, files: Record<string, string>): string {
  const root = join(BASE, name);
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

const config = (folders: string[], start = "start.ts"): string =>
  `export const folders = ${JSON.stringify(folders)};\nexport const start = ${JSON.stringify(start)};\n`;

const MANIFEST = `{
  "formatVersion": 1,
  "name": "结果通道工程",
  "entry": "start",
  "shell": { "orientation": "auto" }
}`;

const WORDS = `import { script } from "@lingfan/editor";
const { say } = script;

`;

interface Command {
  op: string;
  name?: string;
  target?: string;
  text?: string;
  value?: unknown;
  into?: string;
  args?: unknown[];
  body?: Command[];
}

function readCommands(root: string, rel: string): Command[] {
  const text = readFileSync(join(root, "Resources/Stories", rel), "utf8");
  // 序列化产物是**扁平单列**文档（`columns[]` 包装是 compileStory 之前的内存形态）。
  const story = JSON.parse(text) as { commands: Command[] };
  return story.commands;
}

function funcs(
  commands: readonly Command[],
): Array<{ name: string; body: Command[] }> {
  return commands
    .filter((c) => c.op === "func")
    .map((c) => ({ name: c.name ?? "", body: c.body ?? [] }));
}

function calls(commands: readonly Command[]): Command[] {
  return commands.filter((c) => c.op === "call");
}

describe("call into：语句级降糖（拟态旅程）", () => {
  it("const r = double(3) ⇒ call 带 into，且不再发 letVar 声明 r", async () => {
    const root = makeProject("statement", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/start.ts": `${WORDS}export function double(v: number): number {
  return v * 2;
}

export default function start(): void {
  const r = double(3);
  say("r={r}");
}
`,
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);
    const cmds = readCommands(root, "ch1/start.json");
    const intoCall = calls(cmds).find((c) => c.into !== undefined);
    expect(intoCall).toBeDefined();
    expect(intoCall!.target).toBe("double");
    expect(intoCall!.args).toEqual([3]);
    expect(intoCall!.into).toBe("r");
    // into 绑定即声明：letVar 通道不得再发一条 r（发两条会互相覆盖语义）
    expect(cmds.some((c) => c.op === "letVar" && c.name === "r")).toBe(false);
    // 带值 return 逐字节：`v * 2` 不是常量折叠项，落成引擎求值表达式串
    const double_ = funcs(cmds).find((f) => f.name === "double");
    expect(double_).toBeDefined();
    expect(double_!.body[0]).toMatchObject({ op: "return", value: "{v * 2}" });
  });

  it("别名直连：const r = dd(3) ⇒ target/refs 用声明名 double，func 落在声明文件", async () => {
    const root = makeProject("alias", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/lib.ts": `${WORDS}export function double(v: number): number {
  return v * 2;
}
`,
      "Stories.src/ch1/start.ts": `${WORDS}import { double as dd } from "./lib";

export default function start(): void {
  const r = dd(3);
  say("r={r}");
}
`,
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);
    const start = readCommands(root, "ch1/start.json");
    const intoCall = calls(start).find((c) => c.into !== undefined);
    expect(intoCall).toBeDefined();
    expect(intoCall!.target).toBe("double"); // 声明名，不是调用点别名 dd
    expect(intoCall!.into).toBe("r");
    // refs 归位：func 命名与函数体都来自声明文件 lib（body 是 lib 的 return v*2，
    // 不是空壳）；模块文件 lib 本身不产列，函数体提升进导入列 start
    const compiled = funcs(start);
    expect(compiled.map((f) => f.name)).toEqual(["double"]);
    expect(compiled[0]!.body[0]).toMatchObject({
      op: "return",
      value: "{v * 2}",
    });
  });

  it("嵌套函数体内语句级取值：call into 落在内层 func body（帧各自结算）", async () => {
    const root = makeProject("nested", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/start.ts": `${WORDS}export default function start(): void {
  function outer(): void {
    function inner(v: number): number {
      return v + 1;
    }
    const m = inner(2);
    say("m={m}");
  }
  outer();
}
`,
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);
    const cmds = readCommands(root, "ch1/start.json");
    const outer = funcs(cmds).find((f) => f.name === "outer");
    expect(outer).toBeDefined();
    const outerCall = calls(outer!.body).find((c) => c.into !== undefined);
    expect(outerCall).toBeDefined();
    expect(outerCall!.target).toBe("inner");
    expect(outerCall!.into).toBe("m");
  });

  it("实参在当前作用域求值、先于 into 名声明：const y = double(x) 读到的是外层 x", async () => {
    const root = makeProject("shadow", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/start.ts": `${WORDS}export function double(v: number): number {
  return v * 2;
}

export default function start(): void {
  let x = 5;
  const y = double(x);
  say("y={y}");
}
`,
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);
    const cmds = readCommands(root, "ch1/start.json");
    const intoCall = calls(cmds).find((c) => c.into !== undefined);
    expect(intoCall).toBeDefined();
    expect(intoCall!.args).toEqual(["{x}"]); // 实参是外层 x，不是 into 新名 y
  });
});

describe("call into：故意错误 fail-closed", () => {
  it("表达式位取函数返回值 ⇒ 拒绝并指向语句级写法（插值与赋值右值两处）", async () => {
    const template = makeProject("bad-template", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/start.ts": `${WORDS}export function double(v: number): number {
  return v * 2;
}

export default function start(): void {
  say(\`n=\${double(3)}\`);
}
`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(template)).rejects.toThrow(
      /值位置的函数调用不支持.*语句级 `const x = f\(1\)`/,
    );

    const rhs = makeProject("bad-rhs", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/start.ts": `${WORDS}export function double(v: number): number {
  return v * 2;
}

export default function start(): void {
  let x = 1;
  x = double(3);
  say("x={x}");
}
`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(rhs)).rejects.toThrow(/值位置的函数调用不支持/);
  });

  it("未知 callee 的语句级取值仍报未知调用目标（不降糖）", async () => {
    const root = makeProject("unknown-callee", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/start.ts": `${WORDS}export default function start(): void {
  const x = ghost();
  say("x={x}");
}
`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/未知调用目标 `ghost`/);
  });
});

describe("return 带值与列体边界", () => {
  it('裸 return 与带值 return 逐字节：{op:"return"} / {op:"return", value}', async () => {
    const root = makeProject("return-forms", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/start.ts": `${WORDS}export function bare(): void {
  return;
}

export function valued(v: number): number {
  if (v > 0) {
    return v;
  }
  return 0 - 1;
}

export default function start(): void {
  bare();
  const r = valued(2);
  say("r={r}");
}
`,
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);
    const cmds = readCommands(root, "ch1/start.json");
    const bare = funcs(cmds).find((f) => f.name === "bare");
    expect(bare!.body).toEqual([{ op: "return" }]);
    const valued = funcs(cmds).find((f) => f.name === "valued");
    // return v 在 if 块体内（if 命令的 then 体），末尾 return 0-1 在函数体顶层
    const branch = valued!.body.find((c) => c.op === "if") as
      { then?: Command[] } | undefined;
    expect(branch?.then).toContainEqual({ op: "return", value: "{v}" });
    // 常量折叠：0 - 1 折成 -1，但仍走表达式串通道（kind expr → "{-1}"）
    expect(valued!.body).toContainEqual({ op: "return", value: "{-1}" });
  });

  it("列体顶层 return ⇒ 报错且不产该列（fail-closed）", async () => {
    const root = makeProject("top-return", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/start.ts": `${WORDS}export default function start(): void {
  say("前");
  return;
}
`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /列体顶层不能 return（E10）/,
    );
    expect(() =>
      readFileSync(join(root, "Resources/Stories/ch1/start.json"), "utf8"),
    ).toThrow();
  });
});
