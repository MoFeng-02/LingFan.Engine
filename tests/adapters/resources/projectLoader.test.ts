/**
 * 07 §三 工程加载器测试（浏览器/WebView 平台适配器）：
 * 混存识别（T4）/ 逻辑路径拼接 / fail-closed（HTTP 失败与非法清单必须抛错，不静默降级）。
 * fetch 为平台 API：按契约以内存映射替换（不 Mock 引擎实现）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadProjectFromFetch } from "@lingfan/adapters";

const MANIFEST = JSON.stringify({
  formatVersion: 1,
  id: "demo",
  entry: "start",
});

/** 内存站点：逻辑路径（去源根）→ 响应体 */
function serve(files: Record<string, string>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const path = String(input).replace(/^https?:\/\/[^/]+/, "");
      const body = files[path.replace(/^\//, "")];
      if (body === undefined) {
        return new Response("not found", { status: 404 });
      }
      return new Response(body, { status: 200 });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("07 §三 工程加载器（loadProjectFromFetch）", () => {
  it("混存识别（T4）：JSON 投影与文本 .story 同载并组装", async () => {
    serve({
      "project.json": MANIFEST,
      "Stories/start.json": JSON.stringify({
        formatVersion: 1,
        id: "start",
        kind: "flow",
        commands: [{ op: "say", text: "甲" }],
      }),
      "Stories/next.story": 'label next:\n  say "乙"\n',
    });
    const story = await loadProjectFromFetch({
      manifest: "project.json",
      stories: ["Stories/start.json", "Stories/next.story"],
    });
    expect(story.id).toBe("demo");
    // 列序 = 文件路径码元序（组装器确定性排序，不随加载顺序漂移）
    expect(story.columns.map((c) => c.id)).toEqual(["next", "start"]);
  });

  it("逻辑路径按资源根前缀请求（08-U7：与部署位置解耦）", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const path = String(input).replace(/^\/sub\//, "");
      const body =
        path === "project.json"
          ? MANIFEST
          : JSON.stringify({
              formatVersion: 1,
              id: "start",
              kind: "flow",
              commands: [],
            });
      return new Response(body, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await loadProjectFromFetch({
      manifest: "project.json",
      stories: ["Stories/start.json"],
      root: "/sub/",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/sub/project.json");
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/sub/Stories/start.json");
  });

  it("资源缺失（404）→ 抛错，绝不静默返回空工程", async () => {
    serve({ "project.json": MANIFEST });
    await expect(
      loadProjectFromFetch({
        manifest: "project.json",
        stories: ["Stories/ghost.json"],
      }),
    ).rejects.toThrow("Stories/ghost.json 加载失败：HTTP 404");
  });

  it("清单非法 → 组装器 fail-closed 冒泡（整次拒绝）", async () => {
    serve({
      "project.json": JSON.stringify({ formatVersion: 2 }),
      "Stories/start.json": JSON.stringify({
        formatVersion: 1,
        id: "start",
        kind: "flow",
        commands: [],
      }),
    });
    await expect(
      loadProjectFromFetch({
        manifest: "project.json",
        stories: ["Stories/start.json"],
      }),
    ).rejects.toThrow("工程组装失败");
  });

  it("单列文件名 ≠ 列 id → 组装器拒绝（F1 不变量经加载路径仍然生效）", async () => {
    serve({
      "project.json": MANIFEST,
      "Stories/wrong.json": JSON.stringify({
        formatVersion: 1,
        id: "start",
        kind: "flow",
        commands: [],
      }),
    });
    await expect(
      loadProjectFromFetch({
        manifest: "project.json",
        stories: ["Stories/wrong.json"],
      }),
    ).rejects.toThrow("单列文件名");
  });
});
