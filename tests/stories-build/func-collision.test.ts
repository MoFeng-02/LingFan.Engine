/**
 * 验收项 A · 跨文件同名私有函数：碰撞路径互锁（用户点名必交）。
 *
 * 为什么单独立一个文件：这条路径的失败形态是**产物静默串味**——两文件各自定义同名私有
 * 函数、又被同一列拉到一起时，产物里的 `func` 命名与 `call.target` 是否仍各指其源。
 * E12 只拦「同列同名导入」，拦不住「同列里经两跳把两个同名函数拉进 closure」。
 *
 * 本文件锁的是**当前真实行为**，不是设计意图。实测结论有三条，都被下面的用例钉住：
 *   ① 经 closure 的两跳路径（导入 `outerA`/`outerB`，各自体内调本地 `helper`）被
 *      `registerName` 判为同列同名 ⇒ **fail-closed 报错**，不产该列产物。
 *      这是 fail-closed 一侧，不是静默串味。
 *   ② 别名直连导入（`import { helper as other } from "./beta"`）**曾经**绕过 closure：
 *      不报错，但产物里留下 `call.target = "other"` 而**没有对应的 `func op`** ——
 *      函数体从未被编译进来（真正静默坏掉的一侧）。
 *   ③ t11 修掉族 A 后，②归入①：refs 键与 `call.target` 都改用**声明名**，两个不同源的
 *      同名函数于是同样撞上同列同名闸门，报同一族文案并 fail-closed。②不再静默，
 *      而是提前到构建期报错。单个别名（只拉进一个函数）照常产出，见最后一条用例。
 *
 * 互锁形态：断言点全落在**产物字节**上（`func` op 的 name/body、`call` op 的 target），
 * 且走真实编译器（不是合成缝）——只有这样「键控里少一段」这类改动才会真的转红。
 *
 * 变异注入自证（本轮实测，实验后已还原）：把 `story-compiler/assemble.ts` 的
 * `key = \`${file}#${[...ownerChain, name].join("#")}\`` 临时改成丢掉 file 段，
 * 第 ①② 两条用例的产物断言转红；还原后逐字节一致。
 *
 * 边界：管线真 bug 不得在本文件内改 packages/stories-build/src/**，记录 finding 回报。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildStories } from "@lingfan/stories-build";

const BASE = fileURLToPath(new URL("./.tmp-collide/", import.meta.url));

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
  "name": "碰撞工程",
  "entry": "start",
  "shell": { "orientation": "auto" }
}`;

/** 词汇层绑定：故事文件内直接解构（与 build-pipeline.test.ts 的 WORDS 同款）。 */
const WORDS = `import { script } from "@lingfan/editor";
const { say } = script;

`;

interface Command {
  op: string;
  name?: string;
  target?: string;
  text?: string;
  body?: Command[];
  args?: unknown[];
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

/** func body 里的首条 say 文本——用来区分「这个同名函数到底是哪个文件里的那个」。 */
function firstSay(funcBody: readonly Command[]): string {
  const say = funcBody.find((c) => c.op === "say");
  return say?.text ?? "";
}

describe("验收项 A · 跨文件同名私有函数：碰撞路径互锁", () => {
  it("两文件各自定义同名私有函数、经两跳进同一列 ⇒ 报双文件定位并 fail-closed", async () => {
    // start 导入 alpha 的 helper（裸名）与 beta 的 wrapper（其体内调本地 helper）：
    // closure 里两条 CompiledFunction 同名不同源，registerName 必须报出**两个文件**的位置。
    const root = makeProject("two-hops", {
      "Stories.src/config.ts": config(["ch1"], "start.ts"),
      "Stories.src/ch1/alpha.ts": `${WORDS}export function helper(): void {
  say("alpha 的私有体");
}
`,
      "Stories.src/ch1/beta.ts": `${WORDS}export function helper(): void {
  say("beta 的私有体");
}
export function wrapper(): void {
  helper();
}
`,
      "Stories.src/ch1/start.ts": `${WORDS}import { helper } from "./alpha";
import { wrapper } from "./beta";

export default function start(): void {
  helper();
  wrapper();
}
`,
      "Resources/project.json": MANIFEST,
    });

    // 互锁点：诊断必须点出两个源文件（丢一段定位就说明键控里少了 file 段）。
    await expect(buildStories(root)).rejects.toThrow(
      /同列存在同名 func `helper`：ch1\/beta\.ts:\d+:\d+ 与 ch1\/alpha\.ts:\d+:\d+/,
    );
    // fail-closed：报错即不产该列产物，不留半成品让运行期踩到串味的函数。
    expect(() =>
      readFileSync(join(root, "Resources/Stories/ch1/start.json"), "utf8"),
    ).toThrow();
  });

  it("两个文件各自的嵌套私有函数同名 ⇒ 同样报双文件定位（ownerChain 参与键控）", async () => {
    const root = makeProject("nested", {
      "Stories.src/config.ts": config(["ch1"], "start.ts"),
      "Stories.src/ch1/alpha.ts": `${WORDS}export function outerA(): void {
  function helper(): void {
    say("嵌套于 alpha");
  }
  helper();
}
`,
      "Stories.src/ch1/beta.ts": `${WORDS}export function outerB(): void {
  function helper(): void {
    say("嵌套于 beta");
  }
  helper();
}
`,
      "Stories.src/ch1/start.ts": `${WORDS}import { outerA } from "./alpha";
import { outerB } from "./beta";

export default function start(): void {
  outerA();
  outerB();
}
`,
      "Resources/project.json": MANIFEST,
    });

    await expect(buildStories(root)).rejects.toThrow(
      /同列存在同名 func `helper`：ch1\/beta\.ts:\d+:\d+ 与 ch1\/alpha\.ts:\d+:\d+/,
    );
  });

  it("同文件内的同名嵌套函数 ⇒ 同一诊断（定位落在同一文件两处，仍须各有行列）", async () => {
    const root = makeProject("same-file", {
      "Stories.src/config.ts": config(["ch1"], "start.ts"),
      "Stories.src/ch1/alpha.ts": `${WORDS}export function outerA(): void {
  function helper(): void {
    say("第一处");
  }
  helper();
}
export function outerB(): void {
  function helper(): void {
    say("第二处");
  }
  helper();
}
`,
      "Stories.src/ch1/start.ts": `${WORDS}import { outerA, outerB } from "./alpha";

export default function start(): void {
  outerA();
  outerB();
}
`,
      "Resources/project.json": MANIFEST,
    });

    await expect(buildStories(root)).rejects.toThrow(
      /同列存在同名 func `helper`：ch1\/alpha\.ts:\d+:\d+ 与 ch1\/alpha\.ts:\d+:\d+/,
    );
  });

  it("别名直连导入同名函数 ⇒ 与两跳同一条 fail-closed 闸门（不再静默留悬空 call）", async () => {
    // 这里原先锚定的是**缺陷实况**：`import { helper as other } from "./beta"` 产
    // `call{target:"other"}`，而 beta 的 helper 体从未进 closure ⇒ 产物里留一条查无 func
    // 的悬空 call，运行期才炸。t11 把别名路径的 refs 键与 call.target 改回**声明名**后，
    // 两个不同源的 helper 都要求发射 `func name="helper"`，于是撞上 registerName 的同列
    // 同名闸门——与两跳路径（上一条用例）报的是同一族文案、同样 fail-closed。
    // 断言锚点仍在**产物字节**上：报错即不产该列文件。
    const root = makeProject("alias-mixed", {
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

    await expect(buildStories(root)).rejects.toThrow(
      /同列存在同名 func `helper`：ch1\/beta\.ts:\d+:\d+ 与 ch1\/alpha\.ts:\d+:\d+/,
    );
    expect(() =>
      readFileSync(join(root, "Resources/Stories/ch1/start.json"), "utf8"),
    ).toThrow();
  });

  it("别名直连但只拉进一个函数 ⇒ 正常产出，func.name 与 call.target 都是声明名", async () => {
    // 与上一条配对：碰撞闸门只该拦「同名不同源」，不能连单个别名也一起拦掉。
    // 这正是族 A 的正例——修复前这里产 `call{target:"h"}` 且无 func（悬空）。
    const root = makeProject("alias-single", {
      "Stories.src/config.ts": config(["ch1"], "start.ts"),
      "Stories.src/ch1/alpha.ts": `${WORDS}export function helper(): void {
  say("alpha 体");
}
`,
      "Stories.src/ch1/start.ts": `${WORDS}import { helper as h } from "./alpha";

export default function start(): void {
  h();
}
`,
      "Resources/project.json": MANIFEST,
    });

    const report = await buildStories(root);
    expect(report.columns).toBe(1);

    const commands = readCommands(root, "ch1/start.json");
    const compiled = funcs(commands);
    expect(compiled.map((f) => f.name)).toEqual(["helper"]);
    expect(firstSay(compiled[0]!.body)).toBe("alpha 体");
    // call.target 必须是声明名 helper，而不是调用点的局部别名 h。
    expect(
      commands.filter((c) => c.op === "call").map((c) => c.target),
    ).toEqual(["helper"]);
  });
});
