/**
 * 示例工程防腐：playground 的 `Resources/` 是可跑的工程内容——
 * 清单 + 故事必须能被组装器接受，且故事引用的媒体必须在资源根内真实存在。
 * 用 `?raw` 与 `import.meta.glob`（不碰 fs：前端禁 Node）。
 *
 */
import { describe, expect, it } from "vitest";
import manifestRaw from "../../apps/playground/Resources/project.json?raw";
import mainSource from "../../apps/playground/src/main.ts?raw";
import type { Story, StoryCommand } from "@lingfan/engine";
import {
  assembleProject,
  diffProjectFiles,
  MANIFEST_FILE,
  parseStoryFile,
  projectText,
  serializeProject,
} from "@lingfan/engine";

/** 磁盘真实存在的故事文件（glob 键即文件清单）→ `Stories/<file>` 逻辑路径
 *  playground 启用 **TS 源工程**（`Stories.src/` → `stories:build`）：
 *  产物 = **章节目录 + 多列 `.story`**（平铺形态已否决）⇒ glob 必须递归且含 .story */
const STORY_MODULES = {
  ...(import.meta.glob("../../apps/playground/Resources/Stories/**/*.story", {
    eager: true,
    query: "?raw",
    import: "default",
  }) as Record<string, string>),
  ...(import.meta.glob("../../apps/playground/Resources/Stories/**/*.json", {
    eager: true,
    query: "?raw",
    import: "default",
  }) as Record<string, string>),
};

function logicalPath(globKey: string): string {
  return globKey.replace(
    "../../apps/playground/Resources/",
    "",
  );
}

const FILES: Record<string, string> = Object.fromEntries(
  Object.entries(STORY_MODULES).map(([key, text]) => [logicalPath(key), text]),
);

function assemble(): Story {
  return assembleProject(
    JSON.parse(manifestRaw),
    new Map(
      Object.entries(FILES).map(([path, text]) => [
        path,
        parseStoryFile(text, path),
      ]),
    ),
  );
}

/** 递归收集命令树里的媒体引用（bgm/se/ambient/voice/video 族） */
function collectResources(commands: StoryCommand[], into: Set<string>): void {
  for (const command of commands) {
    if (typeof command.resource === "string") into.add(command.resource);
    for (const key of ["then", "else", "body"] as const) {
      const nested = command[key];
      if (Array.isArray(nested)) collectResources(nested, into);
    }
  }
}

describe("示例工程防腐", () => {
  it("清单 + 全部故事文件可组装；入口与分支列齐全", () => {
    const story = assemble();
    expect(story.entry).toBe("start");
    // 组装通过即断言了：columnId 唯一 + 文件名=章节名与列 id 解耦（真实工程形态）；
    // 列序 = 文件路径码元序（组装器确定性排序；同文件多列保持文件内顺序）
    expect(story.columns.map((c) => c.id)).toEqual([
      "start",
      "inn",
      "square",
      "stage_demo",
      "ts_power",
      "end",
      "tour",
      "tour_vars",
      "tour_flow",
      "tour_save",
      "tour_av",
      "tour_stage",
      "tour_ext",
      "tour_guard",
    ]);
  });

  it("main.ts 的浏览器故事清单 ↔ 磁盘文件（回归：新增故事文件必须同步）", () => {
    // 浏览器形态按显式清单取文件（Tauri 形态走 Rust 目录枚举）——
    // 漏登记会让该列在浏览器形态不存在，跳转报 unknown-column（实测缺陷）
    const block = /const STORIES = \[([^\]]*)\]/.exec(mainSource)?.[1];
    expect(block, "未在 main.ts 中找到 STORIES 清单").toBeDefined();
    const declared = [...String(block).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0); // 防提取失效空跑
    expect([...declared].sort()).toEqual(
      Object.keys(FILES).sort(),
    );
  });

  it("文本投影（projectText）对示例工程不抛错：编辑器文本模式打开真实工程不崩", () => {
    // 缺陷回归（编辑器工程模型）：编辑器「文本」视图对示例工程投影时崩在
    // `escapeForText(undefined)`——projectText 的契约是**降级为 issues**，不许抛
    const projection = projectText(assemble());
    expect(projection.text.length).toBeGreaterThan(0);
    // 每一条 issue 都必须是可读的定位信息（空串/undefined 说明生成器漏了字段名）
    for (const issue of projection.issues) {
      expect(typeof issue).toBe("string");
      expect(issue.length).toBeGreaterThan(0);
    }
  });

  it("故事引用的媒体在资源根内真实存在（不存在 = 运行期 fail-closed 诊断）", () => {
    const audio = Object.keys(
      import.meta.glob("../../apps/playground/Resources/Audio/*"),
    );
    const images = Object.keys(
      import.meta.glob("../../apps/playground/Resources/Images/*"),
    );
    const video = Object.keys(
      import.meta.glob("../../apps/playground/Resources/Video/*"),
    );
    const available = new Set(
      [...audio, ...images, ...video].map((path) =>
        path.replace("../../apps/playground/Resources/", ""),
      ),
    );
    const referenced = new Set<string>();
    for (const text of Object.values(FILES)) {
      // 章节形态 = **一文件多列** ⇒ 必须扫全部列（含 scene 列的 entry），
      //    旧「columns[0]」口径在多列文件下漏采
      const parsed = parseStoryFile(text, "story");
      for (const column of parsed.columns) {
        collectResources(column.commands ?? [], referenced);
        collectResources(column.entry ?? [], referenced);
      }
    }
    expect(referenced.size).toBeGreaterThan(0); // 防止断言空转
    for (const resource of referenced) {
      expect(available).toContain(resource);
    }
  });

  it("写回零抖动（真实语料）：无编辑保存时故事文件逐字节不变、清单语义不变", () => {
    // 写回：以磁盘真文本为基线做差量——期望「零写零删」，
    // 否则编辑器每次保存都会无谓重写文件（playground 热重载抖动）。
    const story = assemble();
    const { files } = serializeProject(story, JSON.parse(manifestRaw));
    const baseline = new Map<string, string>([
      [MANIFEST_FILE, manifestRaw],
      ...Object.entries(FILES),
    ]);
    const diff = diffProjectFiles(files, baseline);
    expect([...diff.changes.keys()]).toEqual([]);
    expect(diff.deletes).toEqual([]);
    expect([...files.keys()].sort()).toEqual([...baseline.keys()].sort());
  });

  it("写回往返（真实语料）：序列化产物再组装深等于原故事", () => {
    const story = assemble();
    const { files } = serializeProject(story, JSON.parse(manifestRaw));
    let writtenManifest: unknown;
    const stories = new Map<string, string>();
    for (const [path, text] of files) {
      if (path === MANIFEST_FILE) writtenManifest = JSON.parse(text);
      else stories.set(path, text);
    }
    expect(assembleProject(writtenManifest, stories)).toEqual(story);
  });
});