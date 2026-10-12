/**
 * 验收项 D · 别名导入与命名空间形态等价性（t11 族 A / 族 B）。
 *
 * 为什么单独立一个文件：这组缺陷的共同形态是**同一个东西换个写法就坏掉**——
 * `helper()` 与 `helper as ah` 后调 `ah()` 应当等价、`say()` 与 `script.say()` 应当等价。
 * 它们各自走的是不同分支（标识符分支 / 属性访问分支），改一处不动另一处就会出现
 * 「具名能用、别名不能用」这类只在换写法时才暴露的静默坏掉。
 *
 * 断言一律落在**产物字节**上（`func` op 的 name/body、`call` op 的 target），不读 report
 * 的计数——计数对了但 refs 键错，产物里照样是悬空 call。
 *
 * 全部走**真实默认编译器**（不注入 syntheticCompiler），每用例独立工程根：`loadStoryConfig`
 * 用 `import()` 装载 config.ts，同一进程内同路径会命中 ESM 模块缓存。
 *
 * 边界：管线真 bug 不得在本文件内改 packages/stories-build/src/**，记录 finding 回报。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildStories } from "@lingfan/stories-build";

const BASE = fileURLToPath(new URL("./.tmp-alias/", import.meta.url));

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
  `export default { folders: ${JSON.stringify(folders)}, start: ${JSON.stringify(start)} };\n`;

const MANIFEST = `{
  "formatVersion": 1,
  "name": "别名工程",
  "entry": "start",
  "shell": { "orientation": "auto" }
}`;

const WORDS = `import { script } from "@lingfan/editor";
const { say, option, menu } = script;

`;

interface Command {
  op: string;
  name?: string;
  target?: string;
  text?: string;
  fn?: string;
  body?: Command[];
  args?: unknown[];
  params?: string[];
  options?: Array<{ text: string; target: string }>;
}

function readStart(root: string, rel = "ch1/start.json"): Command[] {
  const text = readFileSync(join(root, "Resources/Stories", rel), "utf8");
  return (JSON.parse(text) as { commands: Command[] }).commands;
}

function funcs(commands: readonly Command[]): Array<{ name: string; body: Command[]; params?: string[] }> {
  return commands.filter((c) => c.op === "func").map((c) => ({ name: c.name ?? "", body: c.body ?? [], params: c.params }));
}

function calls(commands: readonly Command[]): string[] {
  return commands.filter((c) => c.op === "call").map((c) => c.target ?? "");
}

/**
 * 递归下钻收集所有层级的 call 目标。控制流的嵌套体不都叫 body——`if` 用的是
 * `then`/`else`，`loop` 用的是 `body`——所以这里把对象里所有数组值都当嵌套体下钻，
 * 免得新增一种控制流就要回来补一个键名。
 */
function allCalls(commands: readonly Command[]): string[] {
  const out: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record.op === "call") out.push(typeof record.target === "string" ? record.target : "");
    for (const nested of Object.values(record)) visit(nested);
  };
  visit(commands);
  return out;
}

/** 顶层函数体里的首条 say 文本。 */
function firstSay(body: readonly Command[]): string {
  return body.find((c) => c.op === "say")?.text ?? "";
}

describe("别名导入跨文件函数（族 A）", () => {
  it("严格多方位：别名无参 / 别名有参 / 两别名指同一声明 / 别名递归", async () => {
    // 四种形态一次跑完：都是「调用点局部名 ≠ 声明名」，修复前一律产悬空 call，
    // 因为 refs 键与 call.target 都用调用点局部名，而 func 表按声明名索引。
    const root = makeProject("alias-forms", {
      "Stories.src/config.ts": config(["ch1"], "start.ts"),
      "Stories.src/ch1/tools.ts": `${WORDS}export function noArg(): void {
  say("无参");
}
export function withArg(tag: string, times: number): void {
  say(tag);
}
export function recur(n: number): void {
  say("递归体");
  if (n > 0) {
    recur(n - 1);
  }
}
`,
      "Stories.src/ch1/start.ts": `${WORDS}import { noArg as a1 } from "./tools";
import { withArg as a2, recur as a3 } from "./tools";
import { noArg as a4 } from "./tools";

export default function start(): void {
  a1();
  a2("带参", 3);
  a4();
  a3(2);
}
`,
      "Resources/project.json": MANIFEST,
    });

    const report = await buildStories(root);
    expect(report.columns).toBe(1);

    const commands = readStart(root);
    // func 名全部是**声明名**，与调用点别名无关。
    expect(funcs(commands).map((f) => f.name)).toEqual(["noArg", "recur", "withArg"]);
    // call 目标同样是声明名；两个别名 a1/a4 指同一声明 ⇒ 两条 call 都落到 noArg。
    expect(calls(commands)).toEqual(["noArg", "withArg", "noArg", "recur"]);
    // 实参个数与 params 一致（withArg 收了两个字面量实参）。
    const withArg = funcs(commands).find((f) => f.name === "withArg")!;
    expect(withArg.params).toEqual(["tag", "times"]);
    expect(commands.filter((c) => c.op === "call" && c.target === "withArg")[0]!.args).toEqual(["带参", 3]);
    // 递归：函数体内部的自我调用也必须用声明名；调用点在 if 体内，需下钻。
    const recur = funcs(commands).find((f) => f.name === "recur")!;
    expect(allCalls(recur.body)).toEqual(["recur"]);
  });

  it("拟态用户：别名指向的函数体本身又调用了一个别名导入的函数（两跳）", async () => {
    const root = makeProject("alias-two-hop", {
      "Stories.src/config.ts": config(["ch1"], "start.ts"),
      "Stories.src/ch1/leaf.ts": `${WORDS}export function leaf(): void {
  say("叶子");
}
`,
      "Stories.src/ch1/mid.ts": `${WORDS}import { leaf as l } from "./leaf";

export function mid(): void {
  l();
}
`,
      "Stories.src/ch1/start.ts": `${WORDS}import { mid as m } from "./mid";

export default function start(): void {
  m();
}
`,
      "Resources/project.json": MANIFEST,
    });

    const report = await buildStories(root);
    expect(report.columns).toBe(1);

    const commands = readStart(root);
    expect(funcs(commands).map((f) => f.name).sort()).toEqual(["leaf", "mid"]);
    expect(calls(commands)).toEqual(["mid"]);
    const mid = funcs(commands).find((f) => f.name === "mid")!;
    expect(calls(mid.body)).toEqual(["leaf"]);
    expect(firstSay(funcs(commands).find((f) => f.name === "leaf")!.body)).toBe("叶子");
  });

  it("故意错误：两个不同文件里的同名函数经别名拉进同一列 ⇒ fail-closed，不产该列产物", async () => {
    // 别名直连过去会静默留下 `call{target:"other"}` 且无对应 func。改用声明名后，
    // 两个不同源的 helper 都要发 `func name="helper"`，撞上同列同名闸门并拒绝整列。
    const root = makeProject("alias-collide", {
      "Stories.src/config.ts": config(["ch1"], "start.ts"),
      "Stories.src/ch1/alpha.ts": `${WORDS}export function helper(): void {
  say("alpha 体");
}
`,
      "Stories.src/ch1/beta.ts": `${WORDS}export function helper(): void {
  say("beta 体");
}
`,
      "Stories.src/ch1/start.ts": `${WORDS}import { helper } from "./alpha";
import { helper as other } from "./beta";

export default function start(): void {
  helper();
  other();
}
`,
      "Resources/project.json": MANIFEST,
    });

    await expect(buildStories(root)).rejects.toThrow(/同列存在同名 func `helper`/);
    // fail-closed：报错即不产该列产物，别留半成品让运行期去踩。
    expect(existsSync(join(root, "Resources/Stories/ch1/start.json"))).toBe(false);
  });

  it("边界条件：别名指向不存在的导出 ⇒ 报未导出并列出模块，不静默降级", async () => {
    const root = makeProject("alias-missing", {
      "Stories.src/config.ts": config(["ch1"], "start.ts"),
      "Stories.src/ch1/tools.ts": `${WORDS}export function present(): void {
  say("在");
}
`,
      "Stories.src/ch1/start.ts": `${WORDS}import { absent as a } from "./tools";

export default function start(): void {
  a();
}
`,
      "Resources/project.json": MANIFEST,
    });

    await expect(buildStories(root)).rejects.toThrow(/未导出 `absent`/);
  });
});

describe("词汇层别名与命名空间等价性（族 B）", () => {
  it("严格多方位：import { say as 说 } 与 import { script as ct } 两条通道都可用", async () => {
    const root = makeProject("word-alias", {
      "Stories.src/config.ts": config(["ch1"], "start.ts"),
      "Stories.src/ch1/start.ts": `import { say as 说 } from "@lingfan/editor";
import { script as ct } from "@lingfan/editor";

export default function start(): void {
  说("中文别名");
  ct.say("命名空间别名");
}
`,
      "Resources/project.json": MANIFEST,
    });

    const report = await buildStories(root);
    expect(report.columns).toBe(1);
    expect(readStart(root).map((c) => c.text)).toEqual(["中文别名", "命名空间别名"]);
  });

  it("严格多方位：ct.staticFor / ct.cell 作命令 / ct.option 值位置，与具名形态产物逐字节一致", async () => {
    // 三条各写成命名空间形态与具名形态两个工程，产物必须完全相同。
    const build = async (name: string, src: string): Promise<string> => {
      const root = makeProject(name, {
        "Stories.src/config.ts": config(["ch1"], "start.ts"),
        "Stories.src/ch1/start.ts": src,
        "Resources/project.json": MANIFEST,
      });
      await buildStories(root);
      return readFileSync(join(root, "Resources/Stories/ch1/start.json"), "utf8");
    };

    // staticFor：命名空间 vs 具名（模板串，不能用 "第"+i 拼接）。
    const sfNs = await build(
      "sf-ns",
      `import { script } from "@lingfan/editor";
const { say } = script;

export default function start(): void {
  script.staticFor(3, (i) => [say(\`第 \${i} 次\`)]);
}
`,
    );
    const sfNamed = await build(
      "sf-named",
      `import { script, staticFor } from "@lingfan/editor";
const { say } = script;

export default function start(): void {
  staticFor(3, (i) => [say(\`第 \${i} 次\`)]);
}
`,
    );
    expect(sfNs).toBe(sfNamed);

    // option 值位置：命名空间 vs 具名。
    const optNs = await build(
      "opt-ns",
      `${WORDS}export default function start(): void {
  menu("选一个", [
    script.option("去看", "start"),
  ]);
}
`,
    );
    const optNamed = await build(
      "opt-named",
      `${WORDS}export default function start(): void {
  menu("选一个", [
    option("去看", "start"),
  ]);
}
`,
    );
    expect(optNs).toBe(optNamed);
    expect(JSON.parse(optNs).commands[0].options).toEqual([{ text: "去看", target: "start" }]);
  });

  it("故意错误：ct.cell 作命令 ⇒ 报「构建期声明词」，不得退化成「实参形态非法」", async () => {
    const root = makeProject("cell-ns-cmd", {
      "Stories.src/config.ts": config(["ch1"], "start.ts"),
      "Stories.src/ch1/start.ts": `import { script } from "@lingfan/editor";
const { say } = script;

export default function start(): void {
  script.cell("probe", () => true);
}
`,
      "Resources/project.json": MANIFEST,
    });

    // 文案是设计意图的一部分：说「实参形态非法」会把作者引向去改实参，
    // 而真正的问题是 cell 只能出现在模块层 const。
    await expect(buildStories(root)).rejects.toThrow(/cell 是构建期声明词，只能用于模块层 const，不能作为命令/);
    await expect(buildStories(root)).rejects.not.toThrow(/实参形态非法/);
  });

  it("不变量：两条设计意图文案在修复后仍逐字存在（改错位不得顺手改文案）", () => {
    // 用 import.meta.glob 取实物源码文本：路径按本文件位置相对书写，不拼 BASE
    // （BASE 是 fixture 目录，拼出来会指到别处——上一版就是这么读错文件的）。
    const sources = import.meta.glob(
      "../../packages/stories-build/src/compiler/story-compiler/graph/imports.ts",
      { eager: true, query: "?raw", import: "default" },
    ) as Record<string, string>;
    const keys = Object.keys(sources);
    expect(keys).toHaveLength(1);
    const importsSrc = sources[keys[0]!]!;

    expect(importsSrc).toContain("纯模块 ${targetRel} 没有 default 导出——跨故事引用请导入故事文件");
    expect(importsSrc).toContain("命名空间导入仅支持词汇层 script");
    // 这两条是设计意图（用户选 A 的判定），不是可选措辞：改错位时不得顺手删改。
  });
});

describe("族 C 回归锚定：非别名路径产物不受影响", () => {
  it("不变量：裸名导入 / 同文件私有函数 / script.say 三条路径产物正确", async () => {
    const root = makeProject("regression", {
      "Stories.src/config.ts": config(["ch1"], "start.ts"),
      "Stories.src/ch1/tools.ts": `${WORDS}export function plain(): void {
  say("裸名体");
}
`,
      "Stories.src/ch1/start.ts": `${WORDS}import { plain } from "./tools";

function local(): void {
  say("本地体");
}

export default function start(): void {
  plain();
  local();
  script.say("命名空间直调");
}
`,
      "Resources/project.json": MANIFEST,
    });

    const report = await buildStories(root);
    expect(report.columns).toBe(1);

    const commands = readStart(root);
    expect(funcs(commands).map((f) => f.name).sort()).toEqual(["local", "plain"]);
    expect(calls(commands).sort()).toEqual(["local", "plain"]);
    expect(commands.filter((c) => c.op === "say").map((c) => c.text)).toEqual(["命名空间直调"]);
  });
});
