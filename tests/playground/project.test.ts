/**
 * 示例工程防腐：playground 的 `Resources/` 是可跑的工程内容——
 * 清单 + 故事必须能被组装器接受，且故事引用的媒体必须在资源根内真实存在（08-U7）。
 * 用 `?raw` 与 `import.meta.glob`（不碰 fs：前端禁 Node，规约 00 §3.2）。
 */
import { describe, expect, it } from "vitest";
import manifestRaw from "../../apps/playground/Resources/project.json?raw";
import startRaw from "../../apps/playground/Resources/Stories/start.json?raw";
import innRaw from "../../apps/playground/Resources/Stories/inn.json?raw";
import squareRaw from "../../apps/playground/Resources/Stories/square.json?raw";
import endRaw from "../../apps/playground/Resources/Stories/end.json?raw";
import type { Story, StoryCommand } from "@lingfan/engine";
import { assembleProject, parseStoryFile } from "@lingfan/engine";

const FILES: Record<string, string> = {
  "Stories/start.json": startRaw,
  "Stories/inn.json": innRaw,
  "Stories/square.json": squareRaw,
  "Stories/end.json": endRaw,
};

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
  it("清单 + 四个故事文件可组装；入口与分支列齐全", () => {
    const story = assemble();
    expect(story.entry).toBe("start");
    // 组装通过即断言了：单列文件名 = 列 id、columnId 唯一（F1）；
    // 列序 = 文件路径码元序（组装器确定性排序）
    expect(story.columns.map((c) => c.id)).toEqual([
      "end",
      "inn",
      "square",
      "start",
    ]);
  });

  it("故事引用的媒体在资源根内真实存在（不存在 = 运行期 fail-closed 诊断）", () => {
    // import.meta.glob 的键即资源根内真实存在的文件（无需 fs，也不真正加载）；
    // glob 必须是静态字面量（Vite 编译期展开），三个类型目录各写一条
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
