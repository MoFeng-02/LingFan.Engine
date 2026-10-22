/**
 * 工程供给端口（HTTP）：一次请求取回清单与全部故事原文。
 *
 * 形态对齐「内容在服务端」的部署现实：客户端包体只装代码，故事随内容发布走接口。
 * 响应体形状 `{ manifest, stories }`——故事的键是工程内逻辑路径（`Stories/…`），
 * 值是**原始文本**（解析归引擎的组装器，本端不解释、不改写）。
 *
 * 取件面可注入：浏览器直接用全局 `fetch`，小程序用 `uni.request` 包一层最小面
 * （见 `apps/miniprogram/src/host/platform.ts`）——本文件因此不假设任何平台 API。
 */
import type { ProjectFilesPort } from "@lingfan-engine/core";

/** 取件响应面：只声明本端口用到的三件事（`Response` 结构上满足它） */
export interface HttpTextResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/** 取件面：`fetch` 的最小子集（小程序端由 `uni.request` 提供） */
export type HttpFetch = (url: string) => Promise<HttpTextResponse>;

/** 工程接口响应体：清单对象 + 逻辑路径 → 故事原始文本 */
export interface HttpProjectPayload {
  manifest: unknown;
  stories: Record<string, string>;
}

/** 工程接口端口的装配参数 */
export interface HttpProjectFilesOptions {
  /** 工程接口地址（完整 URL） */
  url: string;
  /** 取件面；缺省用全局 `fetch` */
  fetch?: HttpFetch;
}

/**
 * 造一个 HTTP 工程供给端口：一次取回并 memo，`manifest()` 与 `stories()` 共享同一次请求。
 * 失败粘滞（启动期 fail-closed：不重试、不降级成空工程——空工程会让玩家看到白屏）。
 */
export function createHttpProjectFilesPort(
  options: HttpProjectFilesOptions,
): ProjectFilesPort {
  const take = options.fetch ?? defaultHttpFetch();
  let loaded: Promise<HttpProjectPayload> | null = null;

  const load = (): Promise<HttpProjectPayload> => {
    loaded ??= readPayload(take, options.url);
    return loaded;
  };

  return {
    async manifest(): Promise<unknown> {
      return (await load()).manifest;
    },
    async stories(): Promise<Map<string, string>> {
      return new Map(Object.entries((await load()).stories));
    },
  };
}

/** 取回并校验响应体：形状不对就抛（不猜结构、不把坏数据交给组装器） */
async function readPayload(
  take: HttpFetch,
  url: string,
): Promise<HttpProjectPayload> {
  const response = await take(url);
  if (!response.ok) {
    throw new Error(`工程接口失败：HTTP ${response.status}（${url}）`);
  }
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`工程接口返回的不是 JSON（${url}）`);
  }
  return parsePayload(body, url);
}

/** 校验响应体形状：清单是对象、故事表是「路径 → 文本」的对象 */
function parsePayload(body: unknown, url: string): HttpProjectPayload {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error(`工程接口形状不对：${url}`);
  }
  const { manifest, stories } = body as {
    manifest?: unknown;
    stories?: unknown;
  };
  if (typeof manifest !== "object" || manifest === null) {
    throw new Error(`工程接口缺清单：${url}`);
  }
  if (
    typeof stories !== "object" ||
    stories === null ||
    Array.isArray(stories)
  ) {
    throw new Error(`工程接口缺故事表：${url}`);
  }
  for (const [path, text] of Object.entries(stories)) {
    if (typeof text !== "string") {
      throw new Error(`故事文本不是字符串：${path}`);
    }
  }
  return { manifest, stories: stories as Record<string, string> };
}

/** 全局 `fetch` 包成取件面（浏览器 / WebView / H5） */
function defaultHttpFetch(): HttpFetch {
  return async (url: string): Promise<HttpTextResponse> => fetch(url);
}
