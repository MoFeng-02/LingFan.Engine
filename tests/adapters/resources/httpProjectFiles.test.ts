/**
 * 工程供给端口（HTTP）测试：一次取回、memo 共享、fail-closed
 * （HTTP 失败 / 非 JSON / 形状不对都必须抛错，绝不降级成空工程）。
 *
 * 取件面是注入的 `HttpFetch`：按契约以内存替身替换，不碰真实网络、也不 Mock 引擎实现。
 */
import { describe, expect, it } from "vitest";
import { createHttpProjectFilesPort, type HttpFetch } from "@lingfan/adapters";

const MANIFEST = { formatVersion: 1, id: "demo", entry: "start" };
const STORIES = {
  "Stories/chapter1/start.json": '{"formatVersion":1,"id":"start"}',
  "Stories/chapter2/next.story": 'label next:\n  say "乙"\n',
};

/** 内存接口：固定响应体，顺带记账请求了几次 */
function serve(
  body: unknown,
  status = 200,
): { fetch: HttpFetch; calls: string[] } {
  const calls: string[] = [];
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  const fetch: HttpFetch = async (url) => {
    calls.push(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => payload,
    };
  };
  return { fetch, calls };
}

describe("工程供给端口（createHttpProjectFilesPort）", () => {
  it("一次取回清单与故事原文：manifest 与 stories 共享同一次请求", async () => {
    const { fetch, calls } = serve({ manifest: MANIFEST, stories: STORIES });
    const port = createHttpProjectFilesPort({
      url: "https://cdn.test/project",
      fetch,
    });
    await expect(port.manifest()).resolves.toEqual(MANIFEST);
    const stories = await port.stories();
    expect(Object.fromEntries(stories)).toEqual(STORIES);
    expect(calls).toEqual(["https://cdn.test/project"]);
  });

  it("故事原文照原样交回：解析归引擎的组装器，端口不改写", async () => {
    const { fetch } = serve({ manifest: MANIFEST, stories: STORIES });
    const port = createHttpProjectFilesPort({
      url: "https://cdn.test/project",
      fetch,
    });
    const stories = await port.stories();
    expect(stories.get("Stories/chapter2/next.story")).toBe(
      STORIES["Stories/chapter2/next.story"],
    );
  });

  it("HTTP 失败 → 抛错，不静默返回空工程", async () => {
    const { fetch } = serve({ manifest: MANIFEST }, 503);
    const port = createHttpProjectFilesPort({
      url: "https://cdn.test/project",
      fetch,
    });
    await expect(port.manifest()).rejects.toThrow(
      "工程接口失败：HTTP 503（https://cdn.test/project）",
    );
  });

  it("返回不是 JSON → 抛错", async () => {
    const { fetch } = serve("<html>网关错误</html>");
    const port = createHttpProjectFilesPort({
      url: "https://cdn.test/project",
      fetch,
    });
    await expect(port.manifest()).rejects.toThrow(
      "工程接口返回的不是 JSON（https://cdn.test/project）",
    );
  });

  it("缺清单 / 缺故事表 / 故事不是字符串 → 三种形状问题都抛错", async () => {
    for (const [body, message] of [
      [{ stories: STORIES }, "工程接口缺清单"],
      [{ manifest: MANIFEST }, "工程接口缺故事表"],
      [
        { manifest: MANIFEST, stories: { "Stories/x.json": 1 } },
        "故事文本不是字符串",
      ],
    ] as const) {
      const { fetch } = serve(body);
      const port = createHttpProjectFilesPort({
        url: "https://cdn.test/project",
        fetch,
      });
      await expect(port.stories()).rejects.toThrow(message);
    }
  });

  it("失败粘滞：同一端口不重试（启动期 fail-closed，重试由组合根决定）", async () => {
    const { fetch, calls } = serve(
      { manifest: MANIFEST, stories: STORIES },
      500,
    );
    const port = createHttpProjectFilesPort({
      url: "https://cdn.test/project",
      fetch,
    });
    await expect(port.manifest()).rejects.toThrow("HTTP 500");
    await expect(port.stories()).rejects.toThrow("HTTP 500");
    expect(calls).toHaveLength(1);
  });
});
