/**
 * 概念单一声明判据（仓库级源级扫描）。
 *
 * 为什么要有：同一个概念在两处各写一份类型，编译不报错，但两处会各自演化——消费方按 import
 * 路径不同拿到不同形状，改一处另一处悄悄过期。靠人眼读声明守不住，故用判据钉住。
 * 口径：扫 packages / apps / 项目模板的作者源码，剥注释后取 `interface X` 与 `type X =` 声明，
 * 只记**声明**（`export type { X } from "…"` 这类转出、`import type` 不算）。
 *
 * 判据形态：期望表 = 概念名 → 声明文件清单，**逐项相等**——多处声明、声明挪窝、漏抄都失败。
 * 项目模板是独立工程的副本，允许与宿主各留一份，单列一张表。
 */
import { describe, expect, it } from "vitest";

const SOURCES = import.meta.glob(
  [
    "../../packages/*/src/**/*.{ts,vue}",
    "../../apps/*/src/**/*.{ts,vue}",
    "../../template/*/__PROJECT__/src/**/*.{ts,vue}",
  ],
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** glob 键 → 仓库相对路径（posix） */
function rel(key: string): string {
  return key.replace(/^\.\.\/\.\.\//, "").replace(/\\/g, "/");
}

/** 去注释（块注释 + 行注释）：注释里的 `interface X` 例子不算声明 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

/** 声明行：`type X =` / `interface X {` / `interface X extends` 三种后续形态才算 */
const DECL_RE =
  /^[ \t]*(?:export[ \t]+)?(?:declare[ \t]+)?(?:interface|type)[ \t]+([A-Za-z_$][\w$]*)[ \t]*(?:=[ \t]|extends\b|\{)/gm;

/** 从「路径 → 源码」清单建立 概念名 → 声明文件清单（同文件重复声明只记一次） */
function declaringFiles(
  entries: readonly (readonly [string, string])[],
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const [path, source] of entries) {
    const seen = new Set<string>();
    for (const match of stripComments(source).matchAll(DECL_RE)) {
      const name = match[1];
      if (seen.has(name)) continue;
      seen.add(name);
      const files = index.get(name);
      if (files) files.push(path);
      else index.set(name, [path]);
    }
  }
  for (const files of index.values()) files.sort();
  return index;
}

const ENTRIES = Object.entries(SOURCES).map(
  ([key, source]) => [rel(key), source] as const,
);
const INDEX = declaringFiles(ENTRIES);

/** 单一声明：概念名 → 唯一声明文件 */
const SINGLE: Record<string, string> = {
  // 引擎读口/契约
  NotifyPayload: "packages/core/src/contracts/runtime/events.ts",
  MenuChoice: "packages/core/src/contracts/runtime/reader.ts",
  NvlMode: "packages/core/src/contracts/runtime/entities.ts",
  // 渲染层：帧循环与层 z 控制器各只留一份实现面
  FrameSource: "packages/ui/src/host/frame-loop.ts",
  FrameLoopOptions: "packages/ui/src/host/frame-loop.ts",
  FrameLoop: "packages/ui/src/host/frame-loop.ts",
  LayerZController: "packages/ui/src/overlay/layer-z.ts",
  // 视图状态域
  NarrativeState: "packages/shell/src/state/types.ts",
  // 舞台适配：配置契约在引擎（与 shell.saves 同层，宿主一律取解析结果），算出来的布局在壳
  StageConfig: "packages/core/src/contracts/shell.ts",
  StageLayout: "packages/shell/src/stage/types.ts",
  // 编辑器作者面：命令参数名与运行期状态名分开
  NvlCommandMode: "packages/editor/src/script/words/narrative.ts",
  MenuOptionSpec: "packages/editor/src/script/words/narrative.ts",
  // 宿主侧：宿主专属形状带宿主前缀
  VueNarrativeState:
    "apps/playground/src/host/narrative/runtime/narrative-state.ts",
  HostLayerZController: "apps/playground/src/host/narrative/runtime/layer-z.ts",
  HostLayerZControllerOptions:
    "apps/playground/src/host/narrative/runtime/layer-z.ts",
  // 工程生成器：模板元数据、叠加层合并、版本解析三处的对外形状各只一份
  TemplateMeta: "packages/create/src/registry/template-meta.ts",
  TemplateOption: "packages/create/src/registry/template-meta.ts",
  ResolvedVersion: "packages/create/src/registry/versions.ts",
  PendingFile: "packages/create/src/overlay/merge.ts",
  MergedLayer: "packages/create/src/overlay/merge.ts",
  GenerateOptions: "packages/create/src/generate/project.ts",
  GenerateResult: "packages/create/src/generate/project.ts",
  CreateArgs: "packages/create/src/cli/cli.ts",
  PromptTexts: "packages/create/src/cli/prompts.ts",
  PromptIo: "packages/create/src/cli/prompts.ts",
  CreateTexts: "packages/create/src/shared/texts.ts",
};

/** 模板副本：项目模板是独立工程，与宿主各留一份是故意的 */
const TEMPLATED: Record<string, readonly string[]> = {
  HostFrameLoopOptions: [
    "packages/shell/src/frame/appFrameLoop.ts",
    "template/v1/__PROJECT__/src/host/frame-loop.ts",
  ],
};

describe("概念单一声明", () => {
  it("扫描面覆盖 packages / apps / 模板", () => {
    expect(ENTRIES.length).toBeGreaterThan(300);
  });

  it.each(Object.entries(SINGLE))("%s 只在一处声明", (name, path) => {
    expect(INDEX.get(name) ?? []).toEqual([path]);
  });

  it.each(Object.entries(TEMPLATED))("%s 仅宿主与模板各一份", (name, paths) => {
    expect(INDEX.get(name) ?? []).toEqual([...paths].sort());
  });

  it("已被合并的旧名不再作为声明存在", () => {
    // 编辑器命令参数曾直接复用运行期状态名，宿主层曾各写一份视图状态名
    for (const retired of ["MenuOption"]) {
      expect(INDEX.has(retired)).toBe(false);
    }
  });
});

describe("判据自证", () => {
  it("同文件重复声明只记一次", () => {
    const index = declaringFiles([
      ["a.ts", "export interface Dup { x: number }\ntype Dup = string;"],
    ]);
    expect(index.get("Dup")).toEqual(["a.ts"]);
  });

  it("跨文件重复声明会被抓出", () => {
    const index = declaringFiles([
      ["a.ts", "export interface Dup { x: number }"],
      ["b.ts", "type Dup = string;"],
    ]);
    expect(index.get("Dup")).toEqual(["a.ts", "b.ts"]);
  });

  it("转出与 import 不算声明", () => {
    const index = declaringFiles([
      [
        "a.ts",
        [
          'export type { Dup } from "./b";',
          'import type { Dup2 } from "./b";',
          "export type Real = Dup;",
        ].join("\n"),
      ],
    ]);
    expect(index.has("Dup")).toBe(false);
    expect(index.has("Dup2")).toBe(false);
    expect(index.get("Real")).toEqual(["a.ts"]);
  });
});
