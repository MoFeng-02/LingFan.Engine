/**
 * registry 版本查询的判据。
 *
 * 只测本模块自己的逻辑：网络用替身，不真的连 registry。要断言的是三件事——
 * 拿不到时不阻断生成、只改清单里已有的键、并发分批不漏包。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyResolvedVersions,
  fetchLatestVersion,
  resolveVersions,
} from "../../packages/create/src/registry/versions.ts";

interface FetchCall {
  readonly url: string;
}

/** 用一张「名字 → 版本」表造 fetch 替身，未登记的名字回 404 */
function stubRegistry(table: Readonly<Record<string, string>>): FetchCall[] {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (input: string) => {
    calls.push({ url: input });
    const name = input
      .replace("https://registry.npmjs.org/", "")
      .replace(/\/latest$/, "");
    const version = table[name];
    if (version === undefined) {
      return { ok: false, json: async () => ({}) } as unknown as Response;
    }
    return {
      ok: true,
      json: async () => ({ version }),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchLatestVersion", () => {
  it("查到就返回版本号", async () => {
    stubRegistry({ vite: "8.3.5" });
    await expect(fetchLatestVersion("vite")).resolves.toBe("8.3.5");
  });

  it("包不存在时返回 undefined，而不是抛错", async () => {
    stubRegistry({});
    await expect(fetchLatestVersion("no-such-package")).resolves.toBe(
      undefined,
    );
  });

  it("请求 url 带 /latest，不拉整份文档", async () => {
    const calls = stubRegistry({ vite: "8.3.5" });
    await fetchLatestVersion("vite");
    expect(calls[0]?.url).toBe("https://registry.npmjs.org/vite/latest");
  });

  it("网络异常时返回 undefined，不把异常抛给调用方", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      }),
    );
    await expect(fetchLatestVersion("vite")).resolves.toBe(undefined);
  });

  it("往返响应体里没有 version 字段时返回 undefined", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return { ok: true, json: async () => ({}) } as unknown as Response;
      }),
    );
    await expect(fetchLatestVersion("vite")).resolves.toBe(undefined);
  });
});

describe("resolveVersions", () => {
  it("多个包一次查完，查不到的不进结果表", async () => {
    stubRegistry({ vite: "8.3.5", typescript: "7.0.2" });
    const resolved = await resolveVersions(["vite", "typescript", "missing"]);
    expect([...resolved.entries()]).toEqual([
      ["vite", "8.3.5"],
      ["typescript", "7.0.2"],
    ]);
  });

  it("包数量超过分批上限时也一个不漏", async () => {
    const table: Record<string, string> = {};
    const names = ["a", "b", "c", "d", "e", "f", "g"];
    for (const [index, name] of names.entries()) {
      table[name] = `1.0.${String(index)}`;
    }
    stubRegistry(table);
    const resolved = await resolveVersions(names);
    expect(resolved.size).toBe(names.length);
    expect(resolved.get("g")).toBe("1.0.6");
  });

  it("空清单直接返回空表，不发请求", async () => {
    const calls = stubRegistry({});
    const resolved = await resolveVersions([]);
    expect(resolved.size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe("applyResolvedVersions", () => {
  it("查到的换成 caret 区间", () => {
    const out = applyResolvedVersions(
      { vite: "^8.0.16", typescript: "~6.0.3" },
      new Map([["vite", "8.3.5"]]),
    );
    expect(out).toEqual({ vite: "^8.3.5", typescript: "~6.0.3" });
  });

  it("只改已有的键：查到但没有的依赖不会凭空出现", () => {
    const out = applyResolvedVersions(
      { vite: "^8.0.16" },
      new Map([
        ["vite", "8.3.5"],
        ["react", "19.3.1"],
      ]),
    );
    expect(Object.keys(out)).toEqual(["vite"]);
  });

  it("仓库内依赖的 workspace 区间被换成真实版本号", () => {
    const out = applyResolvedVersions(
      { "@lingfan-engine/core": "workspace:*" },
      new Map([["@lingfan-engine/core", "0.1.3"]]),
    );
    expect(out).toEqual({ "@lingfan-engine/core": "^0.1.3" });
  });

  it("模板里原有的范围写法被 registry 版本整体取代，不是叠加", () => {
    const out = applyResolvedVersions(
      { vite: "~8.0.16" },
      new Map([["vite", "8.3.5"]]),
    );
    expect(out).toEqual({ vite: "^8.3.5" });
  });
});
