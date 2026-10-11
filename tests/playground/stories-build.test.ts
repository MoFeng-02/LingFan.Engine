/**
 * Stories.src 构建管线 v2（静态转译编译器）契约测试。
 *
 * 契约口径（设计稿：私有文档/设计稿/2026-10-11-Stories源新创作模式-设计稿.md）：
 * - 源侧只有 TS：Stories.src/config.ts 布局声明（folders/start）；各目录故事源以
 *   default 导出的具名 function 声明（一个故事 = 一个列 id）。
 * - 编译期静态转译：TS → 命令 JSON；故事源绝不加载执行（本文件也不 import 故事源）。
 * - report 口径：{ added, updated, removed, columns, extensions, functions, warnings }；
 *   旧 written 字段已废除。逻辑路径两个命名空间：资源根（Stories/…、project.json）
 *   与源根（Stories.src/gen/…）。
 * - sourcePath 由源相对路径派生（Stories/<相对目录>/<名>.json），不再可声明。
 * - project.json：tsSource 标记、entry/defines 托管；其余键原值保真。
 *
 * 8 类行为 → 测试映射（任务书口径）：
 *   ① report 计数（added/updated）……「多目录 folders：首跑 added…」「源文本变化 ⇒ 仅该列 updated」
 *   ② 幂等二跑零差量 ……………………「幂等：二跑零差量」「cell 全链路 … 幂等零差量」
 *   ③ 陈旧产物清理 …………………………「陈旧产物清理…」「cell 全部移除 ⇒ 陈旧 gen 删除」
 *   ④ tsSource 清单标记 …………………「清单托管：project.json 获得 tsSource 标记…」
 *   ⑤ sourcePath 镜像落点 ………………「多目录 folders：首跑 added + sourcePath 镜像落点」
 *   ⑥ fail-closed E02/E03/E04/E05/E07 ……「v2 fail-closed」describe 全部
 *   ⑦ 跨文件 defines 同键异值 …………「defines 工程级收敛与冲突」describe
 *   ⑧ "*" 兜底 ………………………………「"*" 兜底：覆盖全部子目录」
 *
 * 边界：管线真 bug 不得在本文件内改 scripts/build/**，记录 finding 回报。
 * fixture 全部自建在 tests/playground/.tmp-build/ 下（vite fs.allow 白名单内）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildStories } from "../../apps/playground/scripts/stories-build";
import { renderFunRegister, scanCells } from "../../apps/playground/scripts/cell-extract";
import type { StoriesCompiler } from "../../apps/playground/scripts/build/compiler-contract";

const BASE = fileURLToPath(new URL("./.tmp-build/", import.meta.url));

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

/** config.ts 布局声明（v2 源侧根文件）。 */
const config = (folders: string[], start = "start.ts"): string =>
  `export default { folders: ${JSON.stringify(folders)}, start: ${JSON.stringify(start)} };\n`;

/** 工程清单（不归 TS 源管；v2 编译器产物无 defines，fixture 不预置）。 */
const MANIFEST = `{
  "formatVersion": 1,
  "name": "演示工程",
  "entry": "start",
  "shell": { "orientation": "auto" }
}`;

const MANIFEST_EXT = `{
  "formatVersion": 1,
  "name": "演示工程",
  "entry": "start",
  "extensions": ["./extensions/demo.ts"],
  "shell": { "orientation": "auto" }
}`;

/** 词汇层绑定（graph 词绑定形态之一：script 命名空间解构；真实工程同款）。 */
const WORDS = `import { script } from "@lingfan/editor";
const { say, option, menu, guard, cell, extOp } = script;

`;

/** v2 故事源范式：default 导出的具名 function = 一个故事 = 一个列 id。 */
const story = (name: string, body: string): string =>
  `${WORDS}export default function ${name}(): void {
${body}
}
`;

const SYNTHETIC_STORY = story("start", `  say("欢迎来到灵泛");`);

/** 过渡期注入缝：合成编译器（按 discovery 清单生成空列条目；可携带 defines）。
 * definesByFile 的键 = 相对 Stories.src/ 的 posix 路径（与 input.stories 同口径）。 */
function syntheticCompiler(definesByFile?: Record<string, Record<string, unknown>>): StoriesCompiler {
  return {
    compileStories: async (input) => ({
      diags: [],
      stories: input.stories.map((rel) => {
        const columnId = rel.slice(rel.lastIndexOf("/") + 1).replace(/\.ts$/, "");
        const entry = {
          formatVersion: 1,
          id: columnId,
          entry: columnId,
          columns: [{ id: columnId, kind: "flow", commands: [] }],
          ...(definesByFile?.[rel] === undefined ? {} : { defines: definesByFile[rel] }),
        };
        return { columnId, sourceRelPath: rel, story: entry };
      }),
    }),
  };
}

describe("stories:build v2 · 正常路径（布局声明 → 编译 → 差量写盘）", () => {
  it("①⑤多目录 folders：首跑 added 计数 + sourcePath 镜像落点（源子目录 → 产物同名目录）", async () => {
    const root = makeProject("v2-happy", {
      "Stories.src/config.ts": config(["common", "other"]),
      "Stories.src/common/start.ts": SYNTHETIC_STORY,
      "Stories.src/common/tavern.ts": story("tavern", `  say("到了酒馆");`),
      "Stories.src/other/market.ts": story("market", `  say("到了集市");`),
      "Resources/project.json": MANIFEST,
    });
    const report = await buildStories(root);
    expect(report.columns).toBe(3);
    expect(report.storyId).toBe("start");
    // 差量计数：3 个故事产物新增 + 清单更新（tsSource 标记）
    expect([...report.added].sort()).toEqual([
      "Stories/common/start.json",
      "Stories/common/tavern.json",
      "Stories/other/market.json",
    ]);
    expect(report.updated).toEqual(["project.json"]);
    expect(report.removed).toEqual([]);
    // sourcePath 镜像：源 common/start.ts → 产物 Stories/common/start.json（单列原子形态）
    const startFile = JSON.parse(
      readFileSync(join(root, "Resources/Stories/common/start.json"), "utf8"),
    ) as { formatVersion: number; id: string; kind: string; commands: { op: string; text: string }[] };
    expect(startFile).toMatchObject({ formatVersion: 1, id: "start", kind: "flow" });
    expect(startFile.commands).toEqual([{ op: "say", text: "欢迎来到灵泛" }]);
    expect(existsSync(join(root, "Resources/Stories/other/market.json"))).toBe(true);
  });

  it("②幂等：二跑零差量（added/updated/removed 全空）", async () => {
    const root = makeProject("v2-idempotent", {
      "Stories.src/config.ts": config(["common"]),
      "Stories.src/common/start.ts": SYNTHETIC_STORY,
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);
    const report = await buildStories(root);
    expect(report.added).toEqual([]);
    expect(report.updated).toEqual([]);
    expect(report.removed).toEqual([]);
  });

  it("①源文本变化 ⇒ 仅该列 updated（差量收敛）", async () => {
    const root = makeProject("v2-delta", {
      "Stories.src/config.ts": config(["common"]),
      "Stories.src/common/start.ts": SYNTHETIC_STORY,
      "Stories.src/common/tavern.ts": story("tavern", `  say("到了酒馆");`),
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);
    writeFileSync(
      join(root, "Stories.src/common/tavern.ts"),
      story("tavern", `  say("酒馆改版了");`),
    );
    const report = await buildStories(root);
    expect(report.added).toEqual([]);
    expect(report.updated).toEqual(["Stories/common/tavern.json"]);
    expect(report.removed).toEqual([]);
  });

  it("③陈旧产物清理：源里已删除的故事进 removed 并真实删盘", async () => {
    const root = makeProject("v2-stale", {
      "Stories.src/config.ts": config(["common"]),
      "Stories.src/common/start.ts": SYNTHETIC_STORY,
      "Resources/project.json": MANIFEST,
      // 陈旧产物：手写遗留 / 章节删除后的残留（源里已无对应故事）
      "Resources/Stories/legacy.json": `{"formatVersion":1,"id":"legacy","kind":"flow","commands":[]}`,
      "Resources/Stories/old-chapter/ghost.json": `{"formatVersion":1,"columns":[]}`,
    });
    const report = await buildStories(root);
    expect(report.removed).toContain("Stories/legacy.json");
    expect(report.removed).toContain("Stories/old-chapter/ghost.json");
    expect(existsSync(join(root, "Resources/Stories/legacy.json"))).toBe(false);
    expect(existsSync(join(root, "Resources/Stories/old-chapter/ghost.json"))).toBe(false);
    expect(report.added).toContain("Stories/common/start.json");
  });

  it("④清单托管：project.json 获得 tsSource 标记；entry 防御补齐；非托管键保真", async () => {
    const root = makeProject("v2-manifest", {
      "Stories.src/config.ts": config(["common"]),
      "Stories.src/common/start.ts": SYNTHETIC_STORY,
      "Resources/project.json": `{
        "formatVersion": 1,
        "name": "演示工程",
        "shell": { "orientation": "auto" }
      }`,
    });
    await buildStories(root);
    const manifest = JSON.parse(readFileSync(join(root, "Resources/project.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(manifest.tsSource).toBe(true);
    expect(manifest.entry).toBe("start");
    expect(manifest.name).toBe("演示工程");
    expect(manifest.shell).toEqual({ orientation: "auto" });
    expect(manifest.formatVersion).toBe(1);
  });

  it("⑧\"*\" 兜底：folders:[\"*\"] 覆盖全部子目录，故事全部编译", async () => {
    const root = makeProject("v2-star", {
      "Stories.src/config.ts": config(["*"]),
      "Stories.src/common/start.ts": SYNTHETIC_STORY,
      "Stories.src/chapter1/tavern.ts": story("tavern", `  say("到了酒馆");`),
      "Resources/project.json": MANIFEST,
    });
    const report = await buildStories(root);
    expect(report.columns).toBe(2);
    expect(report.added).toContain("Stories/common/start.json");
    expect(report.added).toContain("Stories/chapter1/tavern.json");
    expect(existsSync(join(root, "Resources/Stories/chapter1/tavern.json"))).toBe(true);
  });
});

describe("stories:build v2 · fail-closed 布局与形态校验（写盘前拦截）", () => {
  it("E02 缺 config.ts ⇒ 布局声明指引（folders/start）", async () => {
    const root = makeProject("e02", {
      "Stories.src/common/start.ts": SYNTHETIC_STORY,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /config\.ts 不存在——多目录 TS 源工程需要布局声明[\s\S]*folders[\s\S]*start/s,
    );
  });

  it("E03 根级多个 .ts ⇒ 根级唯一根文件是 config.ts", async () => {
    const root = makeProject("e03", {
      "Stories.src/config.ts": config(["common"]),
      "Stories.src/extra.ts": `export const extra = 1;\n`,
      "Stories.src/common/start.ts": SYNTHETIC_STORY,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /根级发现 2 个 \.ts（config\.ts、extra\.ts）——根级唯一根文件是 config\.ts/,
    );
  });

  it("E04 start 零命中 ⇒ 带候选清单（按 basename 排序）", async () => {
    const root = makeProject("e04-miss", {
      "Stories.src/config.ts": config(["common"], "main.ts"),
      "Stories.src/common/start.ts": SYNTHETIC_STORY,
      "Stories.src/common/tavern.ts": story("tavern", `  say("到了酒馆");`),
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /start "main\.ts" 未匹配任何故事文件（候选：start\.ts、tavern\.ts）/,
    );
  });

  it("E04 start 双命中 ⇒ 入口故事必须全局恰一（带两处定位）", async () => {
    const root = makeProject("e04-dup", {
      "Stories.src/config.ts": config(["common", "other"]),
      "Stories.src/common/start.ts": SYNTHETIC_STORY,
      "Stories.src/other/start.ts": story("start", `  say("另一个 start");`),
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /start "start\.ts" 命中 2 个文件（common\/start\.ts、other\/start\.ts）[\s\S]*全局恰一/s,
    );
  });

  it("E04 start 命中文件无 default 导出 ⇒ 形态要求提示", async () => {
    const root = makeProject("e04-nonstory", {
      "Stories.src/config.ts": config(["common"], "helpers.ts"),
      "Stories.src/common/helpers.ts": `export const helper = 1;\n`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /start "helpers\.ts" 命中的文件没有 default 导出的具名故事函数/,
    );
  });

  it("E05 匿名 default ⇒ 无法确定列 id", async () => {
    const root = makeProject("e05", {
      "Stories.src/config.ts": config(["common"], "main.ts"),
      "Stories.src/common/main.ts": `export default function (): void {}\n`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /default 导出须是具名 function 声明[\s\S]*匿名函数、类与表达式形态无法确定列 id/s,
    );
  });

  it("E07 覆盖外 default ⇒ 全量管理删除警告，指向 folders 或 \"*\" 兜底", async () => {
    const root = makeProject("e07", {
      "Stories.src/config.ts": config(["common"]),
      "Stories.src/common/start.ts": SYNTHETIC_STORY,
      "Stories.src/other/rogue.ts": story("rogue", `  say("野故事");`),
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /含 default 导出但未被 folders 覆盖[\s\S]*Stories\.src\/other\/rogue\.ts[\s\S]*"\*" 兜底/s,
    );
  });
});

describe("stories:build v2 · defines 工程级收敛与冲突（注入编译器契约）", () => {
  const emptyStories = (): Record<string, string> => ({
    "Stories.src/config.ts": config(["common"]),
    "Stories.src/common/start.ts": `export default function start(): void {}\n`,
    "Stories.src/common/tavern.ts": `export default function tavern(): void {}\n`,
  });

  it("⑦跨文件同键异值 ⇒ fail-closed（先于清单读取，冲突即拦截）", async () => {
    const root = makeProject("defines-conflict", {
      ...emptyStories(),
      // 刻意不放 manifest：钉住 mergeDefines 先于 readManifest 的契约次序
    });
    const compiler = syntheticCompiler({
      "common/start.ts": { "player.gold": 7 },
      "common/tavern.ts": { "player.gold": 9 },
    });
    await expect(buildStories(root, { compiler })).rejects.toThrow(
      /跨故事文件的 defines 冲突[\s\S]*defines\["player\.gold"\][\s\S]*7 ≠ 9/s,
    );
  });

  it("同键同值收敛 ⇒ defines 写入清单托管键（tsSource 标记同场）", async () => {
    const root = makeProject("defines-merge", {
      ...emptyStories(),
      "Resources/project.json": MANIFEST,
    });
    const report = await buildStories(root, {
      compiler: syntheticCompiler({
        "common/start.ts": { "player.gold": 7 },
        "common/tavern.ts": { "player.gold": 7 },
      }),
    });
    expect(report.columns).toBe(2);
    const manifest = JSON.parse(readFileSync(join(root, "Resources/project.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(manifest.defines).toEqual({ "player.gold": 7 });
    expect(manifest.tsSource).toBe(true);
  });

  it("编译器诊断非空 ⇒ fail-closed 逐条 file:line:col（编排契约：注入编译器被采纳）", async () => {
    const root = makeProject("diag-fail", {
      "Stories.src/config.ts": config(["common"]),
      "Stories.src/common/start.ts": SYNTHETIC_STORY,
      "Resources/project.json": MANIFEST,
    });
    const broken: StoriesCompiler = {
      compileStories: async () => ({
        stories: [],
        diags: [
          { file: "Stories.src/common/start.ts", line: 3, col: 1, message: "词汇层未知词 nope" },
        ],
      }),
    };
    await expect(buildStories(root, { compiler: broken })).rejects.toThrow(
      /故事编译失败（1 条）[\s\S]*start\.ts:3:1 词汇层未知词/s,
    );
  });
});

describe("stories:build v2 · 扩展声明通道（extOp → 清单声明 → 构建期放行）", () => {
  const EXT_DEMO = `import type { OpExtension } from "@lingfan/engine";

const extension: OpExtension = {
  id: "demoquest",
  stateVersion: 1,
  ops: [
    {
      op: "quest",
      exec: (cmd, ctx) => {
        const step = cmd.step;
        if (typeof step !== "string" || step === "") {
          return { ok: false, code: "quest-bad-step", message: "quest 需要 step 为非空字符串" };
        }
        ctx.set("step", step);
        return { ok: true };
      },
    },
  ],
};

export default extension;
`;

  const EXT_STATEFUL = `import type { OpExtension } from "@lingfan/engine";

const extension: OpExtension = {
  id: "demoquest-state",
  stateVersion: 1,
  ops: [],
};

export default extension;
`;

  const extStory = story("start", `  extOp("quest", { step: "接取" });\n  say("出发");`);

  it("扩展放行：清单声明 ⇒ report.extensions + 产物含扩展 op（含往返幂等）", async () => {
    const root = makeProject("ext-ok", {
      "Stories.src/config.ts": config(["common"]),
      "Stories.src/common/start.ts": extStory,
      "extensions/demo.ts": EXT_DEMO,
      "Resources/project.json": MANIFEST_EXT,
    });
    const report = await buildStories(root);
    expect(report.extensions).toEqual(["./extensions/demo.ts"]);
    const product = readFileSync(join(root, "Resources/Stories/common/start.json"), "utf8");
    expect(product).toContain('"quest"');
    expect(product).toContain('"step": "接取"');
    const again = await buildStories(root);
    expect(again.added).toEqual([]);
    expect(again.updated).toEqual([]);
    expect(again.removed).toEqual([]);
  });

  it("故意错误：用了扩展 op 但清单未声明 ⇒ 构建期拦截（带指针 + 零写盘）", async () => {
    const root = makeProject("ext-undeclared", {
      "Stories.src/config.ts": config(["common"]),
      "Stories.src/common/start.ts": extStory,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /op "quest"[\s\S]*\/columns\/0\/commands\/0[\s\S]*extensions/s,
    );
    expect(existsSync(join(root, "Resources/Stories"))).toBe(false);
  });

  it("故意错误：extensions 声明非数组 ⇒ fail-closed", async () => {
    const root = makeProject("ext-not-array", {
      "Stories.src/config.ts": config(["common"]),
      "Stories.src/common/start.ts": SYNTHETIC_STORY,
      "Resources/project.json": `{
        "formatVersion": 1,
        "name": "演示工程",
        "entry": "start",
        "extensions": "demo",
        "shell": { "orientation": "auto" }
      }`,
    });
    await expect(buildStories(root)).rejects.toThrow(/extensions 必须为数组/);
  });

  it("故意错误：声明条目为空字符串 ⇒ fail-closed", async () => {
    const root = makeProject("ext-empty-entry", {
      "Stories.src/config.ts": config(["common"]),
      "Stories.src/common/start.ts": SYNTHETIC_STORY,
      "extensions/demo.ts": EXT_DEMO,
      "Resources/project.json": `{
        "formatVersion": 1,
        "name": "演示工程",
        "entry": "start",
        "extensions": [""],
        "shell": { "orientation": "auto" }
      }`,
    });
    await expect(buildStories(root)).rejects.toThrow(/非空模块说明符/);
  });

  it("故意错误：声明模块不存在 ⇒ 装载失败带说明符定位", async () => {
    const root = makeProject("ext-missing", {
      "Stories.src/config.ts": config(["common"]),
      "Stories.src/common/start.ts": SYNTHETIC_STORY,
      "Resources/project.json": `{
        "formatVersion": 1,
        "name": "演示工程",
        "entry": "start",
        "extensions": ["./extensions/missing.ts"],
        "shell": { "orientation": "auto" }
      }`,
    });
    await expect(buildStories(root)).rejects.toThrow(/missing\.ts/);
  });

  it("故意错误：声明模块默认导出不是 OpExtension ⇒ 形状校验拒绝（带说明符定位）", async () => {
    const root = makeProject("ext-shape", {
      "Stories.src/config.ts": config(["common"]),
      "Stories.src/common/start.ts": SYNTHETIC_STORY,
      "extensions/demo.ts": `export default 42;\n`,
      "Resources/project.json": MANIFEST_EXT,
    });
    await expect(buildStories(root)).rejects.toThrow(/demo\.ts/);
  });

  it("边界：声明了扩展但故事未用（含无 ops 的状态型扩展）⇒ 放行", async () => {
    const root = makeProject("ext-unused", {
      "Stories.src/config.ts": config(["common"]),
      "Stories.src/common/start.ts": SYNTHETIC_STORY,
      "extensions/demo.ts": EXT_DEMO,
      "extensions/stateful.ts": EXT_STATEFUL,
      "Resources/project.json": `{
        "formatVersion": 1,
        "name": "演示工程",
        "entry": "start",
        "extensions": ["./extensions/demo.ts", "./extensions/stateful.ts"],
        "shell": { "orientation": "auto" }
      }`,
    });
    const report = await buildStories(root);
    expect(report.extensions).toEqual(["./extensions/demo.ts", "./extensions/stateful.ts"]);
    expect(report.added).toContain("Stories/common/start.json");
  });

  it("边界：内建 op 故事 + 无扩展声明 ⇒ 行为零变化（零装载）", async () => {
    const root = makeProject("ext-builtin", {
      "Stories.src/config.ts": config(["common"]),
      "Stories.src/common/start.ts": SYNTHETIC_STORY,
      "Resources/project.json": MANIFEST,
    });
    const report = await buildStories(root);
    expect(report.extensions).toEqual([]);
    expect(report.added).toContain("Stories/common/start.json");
  });
});

describe("stories:build v2 · cell 函数注册构建期提取（C10）", () => {
  const CELL_STORY = `import { script } from "@lingfan/editor";
import { helperGuard } from "./tools";
const { cell, guard, say } = script;
export const checkGold = cell("gold-non-negative", (ctx, args) => {
  const gold = ctx.get("player.gold");
  if (typeof gold !== "number" || gold < 0) ctx.fail("gold");
});
export const helper = cell("helper-guard", helperGuard);

export default function start(): void {
  guard(checkGold);
  guard(helper);
  say("ok");
}
`;
  const CELL_LIB = `export function helperGuard(ctx: unknown, args: unknown): void {}\n`;

  const genOf = (root: string): string =>
    readFileSync(join(root, "Stories.src/gen/fun_register.g.ts"), "utf8");

  it("拟态旅程：内联 + 导入引用 → 生成物（实现/重写说明符/类型扩充）→ 幂等零差量", async () => {
    const root = makeProject("cell-happy", {
      "Stories.src/config.ts": config(["common"]),
      "Stories.src/common/start.ts": CELL_STORY,
      "Stories.src/common/tools.ts": CELL_LIB,
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
    // 导入引用 + 相对说明符按 gen/ 位置重写（common/ 下的 ./tools → ../common/tools）
    expect(gen).toContain('"helper-guard": helperGuard,');
    expect(gen).toContain('from "../common/tools"');
    // 类型扩充（vue-router typed-routes 机制）
    expect(gen).toContain('declare module "@lingfan/editor"');
    expect(gen).toContain('"gold-non-negative": 1;');
    // 幂等：二次构建零差量（含生成物）
    const again = await buildStories(root);
    expect(again.added).toEqual([]);
    expect(again.updated).toEqual([]);
    expect(again.removed).toEqual([]);
    expect(again.functions).toEqual(["gold-non-negative", "helper-guard"]);
  });

  it("③去重：同名同实现写两处 ⇒ 合并为一条（\"dup\" 落两处：条目 + 类型扩充）", async () => {
    const impl = `cell("dup", (ctx, args) => { ctx.get("x"); });`;
    const root = makeProject("cell-dedupe", {
      "Stories.src/config.ts": config(["common"]),
      "Stories.src/common/start.ts": `import { script } from "@lingfan/editor";
const { cell, say } = script;
export const a = ${impl}
export default function start(): void {
  say("x");
}
`,
      "Stories.src/lib/more.ts": `import { script } from "@lingfan/editor";
const { cell } = script;
export const b = ${impl}
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
      "Stories.src/config.ts": config(["common"]),
      "Stories.src/common/start.ts": `import { script } from "@lingfan/editor";
const { cell, say } = script;
export const a = cell("dup", (ctx, args) => { ctx.get("x"); });
export default function start(): void {
  say("x");
}
`,
      "Stories.src/lib/more.ts": `import { script } from "@lingfan/editor";
const { cell } = script;
export const b = cell("dup", (ctx, args) => { ctx.get("y"); });
`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /more\.ts[\s\S]*同名不同实现[\s\S]*start\.ts/,
    );
  });

  it("故意错误：内联实现引用模块级本地 const ⇒ fail-closed（不做传递闭包）", async () => {
    const root = makeProject("cell-local-ref", {
      "Stories.src/config.ts": config(["common"]),
      "Stories.src/common/start.ts": `import { script } from "@lingfan/editor";
const { cell } = script;
const 阈值 = 10;
export const check = cell("check", (ctx, args) => { ctx.get(阈值); });
export default function start(): void {
  guard(check);
  say("x");
}
`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/未导入的标识符[\s\S]*阈值/s);
  });

  it("故意错误：故事用了未声明的守卫名 ⇒ 名字闸门 fail-closed（带指针）", async () => {
    const root = makeProject("cell-gate", {
      "Stories.src/config.ts": config(["common"]),
      "Stories.src/common/start.ts": story("start", `  guard("nope");`),
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /未在源内 cell[\s\S]*guard "nope"[\s\S]*commands\/0/s,
    );
  });

  it("故意错误：调用表达式（参数固化）= L2 ⇒ 显式不支持", async () => {
    const root = makeProject("cell-baked", {
      "Stories.src/config.ts": config(["common"]),
      "Stories.src/common/start.ts": `import { script } from "@lingfan/editor";
import { baked } from "./tools";
const { cell } = script;
export const a = cell("baked-entry", baked(1));
export default function start(): void {
  say("x");
}
`,
      "Stories.src/common/tools.ts": `export const baked = (n: number) => (ctx: unknown, args: unknown): void => {};\n`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/参数固化属 L2/);
  });

  it("③边界：无 cell 声明 + 无守卫引用 ⇒ 零生成；陈旧生成物清理", async () => {
    const root = makeProject("cell-absent", {
      "Stories.src/config.ts": config(["common"]),
      "Stories.src/common/start.ts": SYNTHETIC_STORY,
      "Stories.src/gen/fun_register.g.ts": "/* 陈旧生成物 */",
      "Resources/project.json": MANIFEST,
    });
    const report = await buildStories(root);
    expect(report.functions).toEqual([]);
    expect(report.removed).toContain("Stories.src/gen/fun_register.g.ts");
    expect(() => genOf(root)).toThrow();
  });

  it("回归：playground 真源 gen 生成物 ⇄ 重提取逐字节一致（防手改漂移）", () => {
    // 真实工程 = Stories.src 源里 cell 槽位是守卫实现的唯一住所——
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

describe("stories:build v2 · 状态根名自定义（export declare const <根名>: StoryState）", () => {
  /** 状态根声明（发现域：注解文本引用 StoryState 或本文件别名链）；
   * lib/state.ts 同场携带 stateSchema（编排层 C12 约定：该文件存在就必须有 schema 导出）。 */
  const stateRoot = (name: string): string =>
    `export const stateSchema = { player: { gold: 100 } } as const;\n` +
    `export type StoryState = { player: { gold: number } };\n` +
    `export declare const ${name}: StoryState;\n`;

  it("发现：根名 s ⇒ set 键剥根为裸 player.gold（前缀只是源侧命名空间）", async () => {
    const root = makeProject("state-root-custom", {
      "Stories.src/config.ts": config(["common"]),
      "Stories.src/lib/state.ts": stateRoot("s"),
      "Stories.src/common/start.ts": story("start", `  s.player.gold += 20;\n  say("x");\n`),
      "Resources/project.json": MANIFEST,
    });
    const report = await buildStories(root);
    expect(report.columns).toBe(1);
    const product = readFileSync(join(root, "Resources/Stories/common/start.json"), "utf8");
    expect(product).toContain('"player.gold"');
    expect(product).not.toContain('"s.player.gold"');
  });

  it("冲突：根名 say 与词汇层词函数同名 ⇒ fail-closed（带声明定位）", async () => {
    const root = makeProject("state-root-conflict", {
      "Stories.src/config.ts": config(["common"]),
      "Stories.src/lib/state.ts": stateRoot("say"),
      "Stories.src/common/start.ts": story("start", `  say.player.gold += 20;\n`),
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/状态根名 `say` 与词汇层词函数冲突/);
  });

  it("回退：无状态根声明 ⇒ 默认根 state 仍然生效（现状零迁移）", async () => {
    const root = makeProject("state-root-fallback", {
      "Stories.src/config.ts": config(["common"]),
      "Stories.src/common/start.ts": story("start", `  state.player.gold += 20;\n  say("x");\n`),
      "Resources/project.json": MANIFEST,
    });
    const report = await buildStories(root);
    expect(report.columns).toBe(1);
    const product = readFileSync(join(root, "Resources/Stories/common/start.json"), "utf8");
    expect(product).toContain('"player.gold"');
    expect(product).not.toContain('"state.player.gold"');
  });
});
