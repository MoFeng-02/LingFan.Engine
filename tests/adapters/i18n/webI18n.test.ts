/**
 * Web/HTTP 形态 I18nPort 的判据：构建期语言清单 + 静态根前缀取件。
 *
 * 取件面用契约替身注入（`HttpFetch`），不依赖网络；语义与 Tauri/Rust 侧对齐——
 * 非法语言段抛错、HTTP 失败抛错不静默降级、坏文件整文件跳过（少报不误报）、
 * 供给全零抛「供给为空」、单文件降级映射 main.json、供给序码元序（合并序归引擎）。
 */
import { describe, expect, it } from "vitest";
import {
  createFetchI18nPort,
  createHttpI18nPort,
  type HttpFetch,
  type HttpTextResponse,
  type I18nLangEntry,
} from "@lingfan-engine/adapters";

/** 契约替身：路径→响应表；记录取件顺序（供给序可断言） */
function fakeFetch(table: Record<string, { status?: number; body?: string }>): {
  fetch: HttpFetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fetch: HttpFetch = async (url) => {
    calls.push(url);
    const hit = table[url];
    const response: HttpTextResponse = hit
      ? {
          ok: (hit.status ?? 200) < 400,
          status: hit.status ?? 200,
          text: async () => hit.body ?? "",
        }
      : { ok: false, status: 404, text: async () => "" };
    return response;
  };
  return { fetch, calls };
}

const LANGS: readonly I18nLangEntry[] = [
  {
    lang: "zh-CN",
    files: ["Lang/zh-CN/main.json", "Lang/zh-CN/chapter/a.json"],
  },
  { lang: "en", files: ["Lang/en.json"] },
];

describe("createHttpI18nPort（可注入取件面）", () => {
  it("按清单取件：剥 Lang/{lang}/ 前缀，供给序码元序", async () => {
    const { fetch, calls } = fakeFetch({
      "/Lang/zh-CN/main.json": { body: '{"title":"标题"}' },
      "/Lang/zh-CN/chapter/a.json": { body: '{"a":"甲"}' },
    });
    const port = createHttpI18nPort({ langs: LANGS, fetch });
    const files = await port.loadOverlayFiles("zh-CN");
    expect(files).toEqual([
      { path: "chapter/a.json", entries: { a: "甲" } },
      { path: "main.json", entries: { title: "标题" } },
    ]);
    expect(calls).toEqual([
      "/Lang/zh-CN/chapter/a.json",
      "/Lang/zh-CN/main.json",
    ]);
  });

  it("单文件形态：路径映射 main.json（Rust 降级同语义）", async () => {
    const { fetch } = fakeFetch({
      "/Lang/en.json": { body: '{"title":"Title"}' },
    });
    const port = createHttpI18nPort({ langs: LANGS, fetch });
    expect(await port.loadOverlayFiles("en")).toEqual([
      { path: "main.json", entries: { title: "Title" } },
    ]);
  });

  it("路径前缀可配：URL = root + 逻辑路径", async () => {
    const { fetch, calls } = fakeFetch({
      "/app/Lang/en.json": { body: '{"k":"v"}' },
    });
    const port = createHttpI18nPort({ langs: LANGS, root: "/app/", fetch });
    await port.loadOverlayFiles("en");
    expect(calls).toEqual(["/app/Lang/en.json"]);
  });

  it("非法语言段抛错（fail-closed，不发请求）", async () => {
    const { fetch, calls } = fakeFetch({});
    const port = createHttpI18nPort({ langs: LANGS, fetch });
    await expect(port.loadOverlayFiles("../zh")).rejects.toThrow(
      "非法语言段：../zh",
    );
    expect(calls).toEqual([]);
  });

  it("HTTP 失败抛错，不静默降级", async () => {
    const { fetch } = fakeFetch({
      "/Lang/zh-CN/main.json": { status: 500 },
      "/Lang/zh-CN/chapter/a.json": { body: '{"a":"甲"}' },
    });
    const port = createHttpI18nPort({ langs: LANGS, fetch });
    // 实现按码元序取件（chapter/a.json 先、main.json 后），报错点名实际 500 的文件
    await expect(port.loadOverlayFiles("zh-CN")).rejects.toThrow(
      "Lang/zh-CN/main.json 加载失败：HTTP 500",
    );
  });

  it("坏 JSON / 根非对象 / 非字符串值 ⇒ 整文件跳过，其余照常供给", async () => {
    const { fetch } = fakeFetch({
      "/Lang/zh-CN/main.json": { body: '{"title":"标题"}' },
      "/Lang/zh-CN/bad.json": { body: "{oops" },
      "/Lang/zh-CN/array.json": { body: '["a"]' },
      "/Lang/zh-CN/mixed.json": { body: '{"k":1}' },
    });
    const langs: readonly I18nLangEntry[] = [
      {
        lang: "zh-CN",
        files: [
          "Lang/zh-CN/main.json",
          "Lang/zh-CN/bad.json",
          "Lang/zh-CN/array.json",
          "Lang/zh-CN/mixed.json",
        ],
      },
    ];
    const port = createHttpI18nPort({ langs, fetch });
    expect(await port.loadOverlayFiles("zh-CN")).toEqual([
      { path: "main.json", entries: { title: "标题" } },
    ]);
  });

  it("全部文件无效 ⇒ 抛「供给为空」（与 Rust 同文案）", async () => {
    const { fetch } = fakeFetch({ "/Lang/en.json": { body: "{oops" } });
    const port = createHttpI18nPort({ langs: LANGS, fetch });
    await expect(port.loadOverlayFiles("en")).rejects.toThrow(
      "I18N 译文供给为空：Lang/en/ 目录与 Lang/en.json 单文件均无有效译文",
    );
  });

  it("清单无该语言 ⇒ 同样抛「供给为空」", async () => {
    const { fetch, calls } = fakeFetch({});
    const port = createHttpI18nPort({ langs: LANGS, fetch });
    await expect(port.loadOverlayFiles("ja")).rejects.toThrow(
      "I18N 译文供给为空",
    );
    expect(calls).toEqual([]);
  });

  it("listLanguages：zh-CN 恒含居首，其余码元序", async () => {
    const { fetch } = fakeFetch({});
    const langs: readonly I18nLangEntry[] = [
      { lang: "ja", files: [] },
      { lang: "en", files: [] },
    ];
    const port = createHttpI18nPort({ langs, fetch });
    expect(await port.listLanguages?.()).toEqual(["zh-CN", "en", "ja"]);
  });

  it("加密 .json.enc 浏览器解不开 ⇒ 解析失败走同一宽容跳过", async () => {
    const { fetch } = fakeFetch({
      "/Lang/en.json": { body: '{"k":"v"}' },
      "/Lang/en/secret.json.enc": { body: "\u0000\u0001cipher" },
    });
    const langs: readonly I18nLangEntry[] = [
      { lang: "en", files: ["Lang/en.json", "Lang/en/secret.json.enc"] },
    ];
    const port = createHttpI18nPort({ langs, fetch });
    expect(await port.loadOverlayFiles("en")).toEqual([
      { path: "main.json", entries: { k: "v" } },
    ]);
  });
});

describe("createFetchI18nPort（全局 fetch 形态）", () => {
  it("走全局 fetch：URL 拼前缀，语义与注入面一致", async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      return new Response('{"k":"v"}', { status: 200 });
    }) as typeof fetch;
    try {
      const port = createFetchI18nPort({ langs: LANGS, root: "/static/" });
      expect(await port.loadOverlayFiles("en")).toEqual([
        { path: "main.json", entries: { k: "v" } },
      ]);
      expect(calls).toEqual(["/static/Lang/en.json"]);
    } finally {
      globalThis.fetch = original;
    }
  });
});
