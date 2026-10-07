import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildStories } from "../../apps/playground/scripts/stories-build";
import { renderFunRegister, scanCells } from "../../apps/playground/scripts/cell-extract";

// 临时工程根建在项目内（vite fs.allow 覆盖；用后即删，.gitignore 防崩溃残留）
const BASE = fileURLToPath(new URL("./.tmp-build/", import.meta.url));

const VALID_SOURCE = `export default {
  formatVersion: 1,
  id: "src-demo",
  entry: "start",
  defines: { "player.gold": 7 },
  columns: [
    { id: "start", kind: "flow", commands: [
      { op: "say", text: "源文件你好" },
      { op: "menu", prompt: "去哪？", options: [{ text: "酒馆", target: "tavern" }] },
    ] },
    { id: "tavern", kind: "flow", commands: [{ op: "say", text: "到了酒馆" }] },
  ],
};
`;

const MANIFEST = `{
  "formatVersion": 1,
  "id": "demo",
  "name": "演示工程",
  "entry": "start",
  "defines": { "player.gold": 7 },
  "shell": { "orientation": "auto" }
}`;

function makeProject(name: string, files: Record<string, string>): string {
  const root = join(BASE, name);
  rmSync(root, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    const target = join(root, rel);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

afterEach(() => {
  rmSync(BASE, { recursive: true, force: true });
});

describe("stories:build · TS 故事源编译", () => {
  it("拟态旅程：合法源 → 磁盘终态（列拆分 + 清单托管键更新 + 非托管键保真）→ 再编译零差量", async () => {
    const root = makeProject("happy", {
      "Stories.src/demo.ts": VALID_SOURCE,
      "Resources/project.json": MANIFEST,
      // 手写列文件（非源产物）→ 应被当作陈旧清理
      "Resources/Stories/handwritten.json": `{"formatVersion":1,"id":"handwritten","kind":"flow","commands":[]}`,
    });

    const report = await buildStories(root);
    expect(report.storyId).toBe("src-demo");
    expect(report.columns).toBe(2);
    expect(report.written).toContain("Stories/start.json");
    expect(report.written).toContain("Stories/tavern.json");
    expect(report.written).toContain("project.json");
    expect(report.removed).toContain("Stories/handwritten.json");
    expect(existsSync(join(root, "Resources/Stories/handwritten.json"))).toBe(false);

    // 磁盘终态：列文件 = 单列原子形态；清单托管键来自源、非托管键保真
    const start = JSON.parse(readFileSync(join(root, "Resources/Stories/start.json"), "utf8"));
    expect(start).toMatchObject({ formatVersion: 1, id: "start", kind: "flow" });
    expect(JSON.stringify(start)).toContain("源文件你好");
    const manifest = JSON.parse(readFileSync(join(root, "Resources/project.json"), "utf8"));
    expect(manifest).toMatchObject({
      entry: "start",
      defines: { "player.gold": 7 },
      shell: { orientation: "auto" },
      name: "演示工程",
    });

    // 幂等：产物已最新 → 零差量
    const again = await buildStories(root);
    expect(again.written).toEqual([]);
    expect(again.removed).toEqual([]);
  });

  /**
   * 以下 7 条**各自独立成 `it`**。
   *
   * 拆的原因：原先合成一个用例，串行跑 **7 次 `buildStories`**，
   * 而每次都要 `await import()` 一个**新路径的 `.ts` 源** ⇒ vitest 的 tsx 转译
   * **无法缓存**（路径不同）⇒ 单用例耗时过长，直接撞穿 vitest 的 `hookTimeout`
   * ⇒ 表现为「`afterEach` 超时」这种**指向错误位置**的报错。
   *
   * 拆开后每个用例只编译一次，且每条失败路径**独立可定位**，失败时直接告诉你是哪一条。
   */
  it("故意错误：Stories.src/ 下没有 .ts 源", async () => {
    await expect(buildStories(join(BASE, "empty"))).rejects.toThrow(/Stories\.src\/ 下没有 \.ts 源/);
  });

  it("故意错误：多个 .ts 源（一个工程 = 一个源）", async () => {
    const multi = makeProject("multi", {
      "Stories.src/a.ts": VALID_SOURCE,
      "Stories.src/b.ts": VALID_SOURCE,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(multi)).rejects.toThrow(/2 个 \.ts 源.*a\.ts.*b\.ts/s);
  });

  it("故意错误：源缺 default 导出", async () => {

    const noDefault = makeProject("no-default", {
      "Stories.src/demo.ts": `export const story = { formatVersion: 1 };`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(noDefault)).rejects.toThrow(/缺 default 导出/);
  });

  it("故意错误：formatVersion 缺失（issues 带源名定位）", async () => {

    const badVersion = makeProject("bad-version", {
      "Stories.src/demo.ts": `export default { id: "x", entry: "x", columns: [{ id: "x", kind: "flow", commands: [] }] };`,
      "Resources/project.json": MANIFEST,
    });
    // parseStory issues 带源名定位（Stories.src/ 前缀）——零第二套规则，报错透传
    await expect(buildStories(badVersion)).rejects.toThrow(/Stories\.src\/demo\.ts.*formatVersion/s);
  });

  it("故意错误：列 id 重复", async () => {

    const dupColumn = makeProject("dup-column", {
      "Stories.src/demo.ts": `export default {
        formatVersion: 1, id: "x", entry: "x",
        columns: [
          { id: "same", kind: "flow", commands: [] },
          { id: "same", kind: "flow", commands: [] },
        ],
      };`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(dupColumn)).rejects.toThrow(/columnId 重复/);
  });

  it("故意错误：缺工程清单", async () => {

    const noManifest = makeProject("no-manifest", {
      "Stories.src/demo.ts": VALID_SOURCE,
    });
    await expect(buildStories(noManifest)).rejects.toThrow(/工程清单（entry\/defines\/shell）不归 TS 源管/);
  });

  it("故意错误：工程清单不是合法 JSON", async () => {

    const badManifest = makeProject("bad-manifest", {
      "Stories.src/demo.ts": VALID_SOURCE,
      "Resources/project.json": "{not-json",
    });
    await expect(buildStories(badManifest)).rejects.toThrow(/不是合法 JSON/);
  });

  it("入口指向不存在的列 → 校验链 fail-closed（错误透传，不产半套文件）", async () => {
    const root = makeProject("entry-missing", {
      "Stories.src/demo.ts": `export default {
        formatVersion: 1, id: "x", entry: "nope",
        columns: [{ id: "start", kind: "flow", commands: [] }],
      };`,
      "Resources/project.json": MANIFEST,
    });
    // 底层校验错误原样透传（不翻译不改写），消息含入口定位
    await expect(buildStories(root)).rejects.toThrow(/entry|入口/i);
    // fail-closed：零副作用（未写任何产物文件）
    expect(existsSync(join(root, "Resources/Stories"))).toBe(false);
  });
});

describe("stories:build · 布局声明（平铺形态已否决，章节目录 + 多列成组）", () => {
  /** 带布局声明的源：三列分住两章（.story 扩展名 + 多列成组 + 跨文件跳转） */
  const LAYOUT_SOURCE = `export default {
    formatVersion: 1, id: "layout-demo", entry: "a",
    columns: [
      { id: "a", kind: "flow", sourcePath: "Stories/chapter1/chapter1.story",
        commands: [{ op: "say", text: "第一章" }, { op: "jump", target: "b" }] },
      { id: "a2", kind: "flow", sourcePath: "Stories/chapter1/chapter1.story",
        commands: [{ op: "say", text: "第一章第二列" }] },
      { id: "b", kind: "flow", sourcePath: "Stories/chapter2/chapter2.story",
        commands: [{ op: "say", text: "第二章（跨文件跳转落点）" }] },
    ],
  };`;

  it("sourcePath 声明 ⇒ 章节目录 + **同文件多列成组** + 扩展名随声明", async () => {
    const root = makeProject("layout", {
      "Stories.src/demo.ts": LAYOUT_SOURCE,
      "Resources/project.json": MANIFEST,
    });
    const report = await buildStories(root);
    // 平铺形态消失：产物 = 两个章节文件（a 与 a2 成组进同一 .story）
    expect(report.written.sort()).toEqual([
      "Stories/chapter1/chapter1.story",
      "Stories/chapter2/chapter2.story",
      "project.json",
    ]);
    const chapter1 = JSON.parse(
      readFileSync(join(root, "Resources/Stories/chapter1/chapter1.story"), "utf8"),
    ) as { columns: { id: string }[] };
    expect(chapter1.columns.map((c) => c.id)).toEqual(["a", "a2"]); // 多列成组
  });

  it("重复编译零差量（章节形态往返幂等）", async () => {
    const root = makeProject("layout-idempotent", {
      "Stories.src/demo.ts": LAYOUT_SOURCE,
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);
    const second = await buildStories(root);
    expect(second.written).toEqual([]);
    expect(second.removed).toEqual([]);
  });

  it("故意错误：sourcePath 目录逃逸（..）⇒ fail-closed", async () => {
    const root = makeProject("layout-escape", {
      "Stories.src/demo.ts": `export default {
        formatVersion: 1, id: "x", entry: "a",
        columns: [{ id: "a", kind: "flow", sourcePath: "Stories/../Secret/x.story", commands: [] }],
      };`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/\.\./);
  });

  it("故意错误：非 Stories/ 前缀 ⇒ fail-closed", async () => {
    const root = makeProject("layout-prefix", {
      "Stories.src/demo.ts": `export default {
        formatVersion: 1, id: "x", entry: "a",
        columns: [{ id: "a", kind: "flow", sourcePath: "Other/a.story", commands: [] }],
      };`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/Stories\//);
  });

  it("故意错误：扩展名白名单（.story/.json 之外拒）⇒ fail-closed", async () => {
    const root = makeProject("layout-ext", {
      "Stories.src/demo.ts": `export default {
        formatVersion: 1, id: "x", entry: "a",
        columns: [{ id: "a", kind: "flow", sourcePath: "Stories/a.txt", commands: [] }],
      };`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/\.story 或 \.json/);
  });
});

describe("stories:build · 扩展声明通道（T5：对齐运行期声明制，扩展 op 放行）", () => {
  /** 使用扩展 op 的源：顶层与 if.then 块体内各一处（放行校验须递归块体） */
  const EXT_SOURCE = `export default {
    formatVersion: 1, id: "ext-demo", entry: "start",
    columns: [
      { id: "start", kind: "flow", commands: [
        { op: "quest", step: 1 },
        { op: "if", cond: "{step >= 1}", then: [{ op: "quest", step: 2 }] },
        { op: "say", text: "完成" },
      ] },
    ],
  };`;

  /** 真实形状的演示扩展模块（默认导出 = OpExtension；exec 不抛、返回 ok） */
  const EXT_MODULE = `export default {
    id: "demo-ext",
    stateVersion: 1,
    ops: [{ op: "quest", exec: () => ({ ok: true }) }],
  };`;

  const MANIFEST_WITH_EXT = `{
    "formatVersion": 1,
    "id": "demo",
    "entry": "start",
    "extensions": ["./extensions/demo.ts"]
  }`;

  it("拟态旅程：清单声明扩展 ⇒ 扩展 op 放行进产物（含块体内），再编译零差量", async () => {
    const root = makeProject("ext-happy", {
      "Stories.src/demo.ts": EXT_SOURCE,
      "extensions/demo.ts": EXT_MODULE,
      "Resources/project.json": MANIFEST_WITH_EXT,
    });
    const report = await buildStories(root);
    expect(report.extensions).toEqual(["./extensions/demo.ts"]);
    const start = JSON.parse(
      readFileSync(join(root, "Resources/Stories/start.json"), "utf8"),
    );
    expect(JSON.stringify(start)).toContain('"quest"');
    // 幂等：扩展声明进往返自检与差量写盘，不破坏既有不变量
    const again = await buildStories(root);
    expect(again.written).toEqual([]);
    expect(again.removed).toEqual([]);
  });

  it("故意错误：用了扩展 op 但清单未声明 ⇒ 构建期拦截（块体内定位 + 零写入）", async () => {
    const root = makeProject("ext-undeclared", {
      "Stories.src/demo.ts": EXT_SOURCE,
      "Resources/project.json": MANIFEST,
    });
    // 拦截信息含 op 名与定位（顶层 + 嵌套块体各一处，一次报全部）
    await expect(buildStories(root)).rejects.toThrow(
      /op "quest"[\s\S]*commands\/0[\s\S]*commands\/1\/then\/0[\s\S]*extensions/,
    );
    // fail-closed：零副作用（未写任何产物文件）
    expect(existsSync(join(root, "Resources/Stories"))).toBe(false);
  });

  it("故意错误：extensions 声明非数组 ⇒ fail-closed", async () => {
    const root = makeProject("ext-bad-shape", {
      "Stories.src/demo.ts": VALID_SOURCE,
      "Resources/project.json": `{"formatVersion":1,"id":"demo","entry":"start","extensions":"demo"}`,
    });
    await expect(buildStories(root)).rejects.toThrow(/extensions 必须为数组/);
  });

  it("故意错误：声明条目为空字符串 ⇒ fail-closed", async () => {
    const root = makeProject("ext-empty-entry", {
      "Stories.src/demo.ts": VALID_SOURCE,
      "Resources/project.json": `{"formatVersion":1,"id":"demo","entry":"start","extensions":[""]}`,
    });
    await expect(buildStories(root)).rejects.toThrow(/非空模块说明符/);
  });

  it("故意错误：声明模块不存在 ⇒ 装载失败带说明符定位", async () => {
    const root = makeProject("ext-missing", {
      "Stories.src/demo.ts": VALID_SOURCE,
      "Resources/project.json": `{"formatVersion":1,"id":"demo","entry":"start","extensions":["./extensions/missing.ts"]}`,
    });
    await expect(buildStories(root)).rejects.toThrow(/extensions\/missing\.ts/);
  });

  it("故意错误：声明模块默认导出不是 OpExtension ⇒ 形状校验拒绝（带说明符与原因）", async () => {
    const root = makeProject("ext-malformed", {
      "Stories.src/demo.ts": VALID_SOURCE,
      "extensions/demo.ts": `export default {};`,
      "Resources/project.json": MANIFEST_WITH_EXT,
    });
    await expect(buildStories(root)).rejects.toThrow(/demo\.ts[\s\S]*id 不合法/);
  });

  it("边界：声明了扩展但故事未用（含无 ops 的状态型扩展）⇒ 放行", async () => {
    const root = makeProject("ext-unused", {
      "Stories.src/demo.ts": VALID_SOURCE,
      "extensions/stateful.ts": `export default { id: "stateful", stateVersion: 1 };`,
      "extensions/demo.ts": EXT_MODULE,
      "Resources/project.json": `{"formatVersion":1,"id":"demo","entry":"start","extensions":["./extensions/stateful.ts","./extensions/demo.ts"]}`,
    });
    const report = await buildStories(root);
    expect(report.extensions).toHaveLength(2);
    expect(report.written).toContain("Stories/start.json");
  });

  it("边界：内建 op 故事 + 无扩展声明 ⇒ 行为零变化（装载器零触）", async () => {
    const root = makeProject("ext-builtin-only", {
      "Stories.src/demo.ts": VALID_SOURCE,
      "Resources/project.json": MANIFEST,
    });
    const report = await buildStories(root);
    expect(report.extensions).toEqual([]);
    expect(report.written).toContain("Stories/start.json");
  });
});

describe("stories:build · cell 函数注册构建期提取", () => {
  /** 内联 + 导入引用混合的源；lib 文件提供被引用的实现（相对说明符重写断言用） */
  const CELL_SOURCE = `import { script } from "@lingfan/editor";
import { helperGuard } from "./lib/tools";
const { cell, guard, say } = script;
export const checkGold = cell("gold-non-negative", (ctx, args) => {
  const gold = ctx.get("player.gold");
  if (typeof gold !== "number" || gold < 0) ctx.fail("gold");
});
export const helper = cell("helper-guard", helperGuard);
export default {
  formatVersion: 1, id: "cell-demo", entry: "start",
  columns: [{ id: "start", kind: "flow", commands: [
    { op: "guard", fn: "gold-non-negative" },
    { op: "say", text: "ok" },
  ] }],
};
`;
  const CELL_LIB = `export const helperGuard = (ctx: unknown, args: unknown) => {};`;

  const genOf = (root: string): string =>
    readFileSync(join(root, "Stories.src/gen/fun_register.g.ts"), "utf8");

  it("拟态旅程：内联 + 导入引用 → 生成物（实现/重写说明符/类型扩充）→ 幂等零差量", async () => {
    const root = makeProject("cell-happy", {
      "Stories.src/demo.ts": CELL_SOURCE,
      "Stories.src/lib/tools.ts": CELL_LIB,
      "Resources/project.json": MANIFEST,
    });
    const report = await buildStories(root);
    expect(report.functions).toEqual(["gold-non-negative", "helper-guard"]);
    const gen = genOf(root);
    // GuardFn 语境定型（strict 下无 implicit-any）
    expect(gen).toContain('import type { GuardFn } from "@lingfan/engine";');
    expect(gen).toContain("export const guards: Record<string, GuardFn> = {");
    // 内联字面量原文落生成物
    expect(gen).toContain('"gold-non-negative": (ctx, args) => {');
    // 导入引用 + 相对说明符按 gen/ 位置重写（./lib/tools → ../lib/tools）
    expect(gen).toContain('"helper-guard": helperGuard,');
    expect(gen).toContain('from "../lib/tools"');
    // 类型扩充（vue-router typed-routes 机制）
    expect(gen).toContain('declare module "@lingfan/editor"');
    expect(gen).toContain('"gold-non-negative": 1;');
    // 幂等：二次构建零差量（含生成物）
    const again = await buildStories(root);
    expect(again.written).toEqual([]);
    expect(again.removed).toEqual([]);
    expect(again.functions).toEqual(["gold-non-negative", "helper-guard"]);
  });

  it("去重：同名同实现写两处 ⇒ 合并为一条（BuildReport 计数）", async () => {
    const impl = `cell("dup", (ctx, args) => { ctx.get("x"); });`;
    const root = makeProject("cell-dedupe", {
      "Stories.src/demo.ts": `import { script } from "@lingfan/editor";
const { cell } = script;
export const a = ${impl};
export default { formatVersion: 1, id: "x", entry: "s",
  columns: [{ id: "s", kind: "flow", commands: [] }] };
`,
      "Stories.src/lib/more.ts": `import { script } from "@lingfan/editor";
const { cell } = script;
export const b = ${impl};
`,
      "Resources/project.json": MANIFEST,
    });
    const report = await buildStories(root);
    expect(report.functions).toEqual(["dup"]);
    // 去重 = 实现只落一条；"dup": 共 2 处（guards 对象条目 + GuardNameRegistry 扩充键）
    expect(genOf(root).match(/"dup":/g)).toHaveLength(2);
  });

  it("故意错误：同名不同实现 ⇒ fail-closed（带两处定位）", async () => {
    const root = makeProject("cell-conflict", {
      "Stories.src/demo.ts": `import { script } from "@lingfan/editor";
const { cell } = script;
export const a = cell("dup", (ctx, args) => { ctx.get("x"); });
export default { formatVersion: 1, id: "x", entry: "s",
  columns: [{ id: "s", kind: "flow", commands: [] }] };
`,
      "Stories.src/lib/more.ts": `import { script } from "@lingfan/editor";
const { cell } = script;
export const b = cell("dup", (ctx, args) => { ctx.get("y"); });
`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /more\.ts[\s\S]*同名不同实现[\s\S]*demo\.ts/,
    );
  });

  it("故意错误：内联实现引用模块级本地 const ⇒ fail-closed（不做传递闭包）", async () => {
    const root = makeProject("cell-local-ref", {
      "Stories.src/demo.ts": `import { script } from "@lingfan/editor";
const { cell, guard } = script;
const 阈值 = 10;
export const check = cell("check", (ctx, args) => { ctx.get(阈值); });
export default { formatVersion: 1, id: "x", entry: "s",
  columns: [{ id: "s", kind: "flow", commands: [{ op: "guard", fn: "check" }] }] };
`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/未导入的标识符.*阈值/);
  });

  it("故意错误：故事用了未声明的守卫名 ⇒ 名字闸门 fail-closed（带指针）", async () => {
    const root = makeProject("cell-gate", {
      "Stories.src/demo.ts": `export default {
  formatVersion: 1, id: "x", entry: "s",
  columns: [{ id: "s", kind: "flow", commands: [{ op: "guard", fn: "nope" }] }] };
`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /未在源内 cell[\s\S]*guard "nope"[\s\S]*commands\/0/,
    );
  });

  it("故意错误：调用表达式（参数固化）= L2 ⇒ 显式不支持", async () => {
    const root = makeProject("cell-baked", {
      "Stories.src/demo.ts": `import { script } from "@lingfan/editor";
import { baked } from "./lib/tools";
const { cell } = script;
export const a = cell("baked-entry", baked(1));
export default { formatVersion: 1, id: "x", entry: "s",
  columns: [{ id: "s", kind: "flow", commands: [] }] };
`,
      "Stories.src/lib/tools.ts": `export const baked = (n: number) => (ctx: unknown, args: unknown) => {};`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/参数固化属 L2/);
  });

  it("边界：无 cell 声明 + 无守卫引用 ⇒ 零生成；陈旧生成物清理", async () => {
    const root = makeProject("cell-absent", {
      "Stories.src/demo.ts": VALID_SOURCE,
      "Stories.src/gen/fun_register.g.ts": "/* 陈旧生成物 */",
      "Resources/project.json": MANIFEST,
    });
    const report = await buildStories(root);
    expect(report.functions).toEqual([]);
    expect(report.removed).toContain("Stories.src/gen/fun_register.g.ts");
    expect(genOf.bind(null, root)).toThrow();
  });

  it("回归：playground 真源 gen 生成物 ⇄ 重提取逐字节一致（防手改漂移）", () => {
    // 真实工程 = Stories.src/story.ts 的 cell 槽位是守卫实现的唯一住所——
    // 改了 cell 不跑 stories:build（或手改生成物）⇒ 本测试红，漂移在 CI 拦下
    const realRoot = fileURLToPath(new URL("../../apps/playground", import.meta.url));
    const sourcesDir = join(realRoot, "Stories.src");
    const files = new Map<string, string>();
    const walk = (dir: string, rel = ""): void => {
      for (const name of readdirSync(dir).sort()) {
        const path = join(dir, name);
        const key = rel === "" ? name : `${rel}/${name}`;
        if (statSync(path).isDirectory()) {
          if (key !== "gen") walk(path, key); // 生成物不是扫描域
        } else if (key.endsWith(".ts")) {
          files.set(key, readFileSync(path, "utf8"));
        }
      }
    };
    walk(sourcesDir);
    const { errors, scan } = scanCells(files);
    expect(errors).toEqual([]);
    expect(scan.guards.map((g) => g.name)).toEqual(["gold-non-negative", "tour-open"]);
    expect(renderFunRegister(scan)).toBe(
      readFileSync(join(sourcesDir, "gen", "fun_register.g.ts"), "utf8"),
    );
  });
});

describe("Stories.src/story.ts · 真实演示源完整性（端到端健康检查）", () => {
  it("十四列 / 入口 start / 全部跳转目标存在 / defines 保真 / 章节布局声明", async () => {
    const mod = (await import("../../apps/playground/Stories.src/story")) as {
      default: import("@lingfan/engine").Story;
    };
    const story = mod.default;
    expect(story.columns).toHaveLength(14);
    expect(story.entry).toBe("start");
    expect(story.defines).toMatchObject({ "player.gold": 7 });

    // 跳转图闭合：所有 jump/menu/navigate 目标都在列集里（missing-target 零容）
    // navigate 的载荷字段 = path（+可选 scene，目标 = scene ?? path）——不是 target
    const ids = new Set(story.columns.map((c) => c.id));
    const targets: string[] = [];
    for (const column of story.columns) {
      for (const cmd of column.commands ?? []) {
        if (cmd.op === "jump") targets.push(cmd.target as string);
        if (cmd.op === "navigate")
          targets.push((cmd.scene ?? cmd.path) as string);
        if (cmd.op === "menu")
          for (const option of (cmd as { options?: { target: string }[] }).options ?? [])
            targets.push(option.target);
      }
      for (const cmd of column.entry ?? []) {
        if (cmd.op === "navigate")
          targets.push((cmd.scene ?? cmd.path) as string);
      }
    }
    expect(targets.length).toBeGreaterThanOrEqual(10);
    const dangling = [...new Set(targets.filter((t) => !ids.has(t)))];
    expect(dangling, `悬空跳转目标：${dangling.join("、")}`).toEqual([]);

    // 章节布局：全部列都有声明，且恰好落在四个章节文件
    const paths = new Set(story.columns.map((c) => c.sourcePath));
    expect(paths).toEqual(
      new Set([
        "Stories/chapter1/chapter1.story",
        "Stories/chapter2/chapter2.story",
        "Stories/chapter3/chapter3.story",
        "Stories/chapter4/vocab_tour.story",
      ]),
    );
  });

  it("特性覆盖守卫（把 TS 能力用上——防退化成 JSON-ish 普通文件）", async () => {
    const story = readFileSync(
      new URL("../../apps/playground/Stories.src/story.ts", import.meta.url),
      "utf8",
    );
    const helpers = readFileSync(
      new URL("../../apps/playground/Stories.src/lib/helpers.ts", import.meta.url),
      "utf8",
    );
    // story.ts：类型断言 / 构建期条件 / 展开成组 / 模板字符串 / map 生成
    expect(story).toContain("satisfies Story");
    expect(story).toContain("包含教学列 ?");
    expect(story).toContain("...");
    expect(story).toMatch(/`.*\$\{/s);
    expect(story).toContain(".map(");
    // 词汇全席（第四章）：运行期循环/分支/随机/存档/扩展 op 全部经词汇层出场
    expect(story).toContain("whileDo(");
    expect(story).toContain("switchOn(");
    expect(story).toContain("forEach(");
    expect(story).toContain("forIn(");
    expect(story).toContain("continueLoop()");
    expect(story).toContain("breakLoop()");
    expect(story).toContain("autoSave(");
    expect(story).toContain("saveDelete(");
    expect(story).toContain("extOp(");
    // cell 具名实现槽位（构建期提取）：声明 + handle 引用（名字只写一次）
    expect(story).toContain("cell(");
    expect(story).toContain("guard(checkGold)");
    expect(story).toContain("guard(tourOpen)");
    // helpers.ts：enum / interface / 泛型 / while / 递归形态（函数调自身或嵌套构建）
    expect(helpers).toContain("enum 地点");
    expect(helpers).toContain("interface 列草稿");
    expect(helpers).toContain("function 重复<T>");
    expect(helpers).toMatch(/while \(i < 次数\)/);
    expect(helpers).toContain("as const");
  });
});
