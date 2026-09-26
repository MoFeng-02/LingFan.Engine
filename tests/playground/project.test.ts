/**
 * 示例工程防腐：playground 的 `Resources/` 是可跑的工程内容——
 * 清单 + 故事必须能被组装器接受，且故事引用的媒体必须在资源根内真实存在（08-U7）。
 * 用 `?raw` 与 `import.meta.glob`（不碰 fs：前端禁 Node，规约 00 §3.2）。
 *
 * 锚点: resource-root-resolution / story-manifest-lock
 */
import { describe, expect, it } from "vitest";
import manifestRaw from "../../apps/playground/Resources/project.json?raw";
import mainSource from "../../apps/playground/src/main.ts?raw";
import type { Story, StoryCommand } from "@lingfan/engine";
import { assembleProject, parseStoryFile } from "@lingfan/engine";

/** 磁盘真实存在的故事文件（glob 键即文件清单）→ `Stories/<file>` 逻辑路径 */
const STORY_MODULES = import.meta.glob(
  "../../apps/playground/Resources/Stories/*.json",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

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

describe("示例工程防腐（锚点: resource-root-resolution）", () => {
  it("清单 + 全部故事文件可组装；入口与分支列齐全", () => {
    const story = assemble();
    expect(story.entry).toBe("start");
    // 组装通过即断言了：单列文件名 = 列 id、columnId 唯一（F1）；
    // 列序 = 文件路径码元序（组装器确定性排序）
    expect(story.columns.map((c) => c.id)).toEqual([
      "end",
      "inn",
      "square",
      "stage_demo",
      "start",
    ]);
  });

  it("main.ts 的浏览器故事清单 ↔ 磁盘文件（回归锚定：新增故事文件必须同步）", () => {
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
      collectResources(
        parseStoryFile(text, "story").columns[0]?.commands ?? [],
        referenced,
      );
    }
    expect(referenced.size).toBeGreaterThan(0); // 防止断言空转
    for (const resource of referenced) {
      expect(available).toContain(resource);
    }
  });
});