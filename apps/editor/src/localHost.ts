/**
 * 本地宿主能力探测（**浏览器侧**，零 Node 依赖）。
 *
 * 纪律：探测**只影响「有哪些动作可做」，不改布局、不分叉组件**——
 * 有宿主 ⇒ 完整体验（外部打开 / 原生枚举）；无 ⇒ 降级为浏览器形态（这是**正常**路径）。
 *
 * 端点形状与 `server/host.ts` 对齐：`GET /__editor_host__/ping`。
 * ⚠️ 前端**不假设**宿主在：探测失败一律当「无宿主」，不抛错、不重试刷屏。
 */

/** 宿主端点（探测结果）；`baseUrl` 为 `undefined` 表示无宿主 */
export interface LocalHostEndpoint {
  /** 环回基址（含端口），如 `http://127.0.0.1:62251` */
  readonly baseUrl: string;
}

/** 探测入口（Vite dev 走同源代理；生产由构建期注入或固定端口） */
const PROBE_CANDIDATES: readonly string[] = [
  "/__editor_host__/ping",
  "http://127.0.0.1:14250/__editor_host__/ping",
];

/**
 * 逐个候选探测，命中即返回基址。
 *
 * @param fetchImpl 注入的 fetch（可测；默认 `globalThis.fetch`）
 * @param timeoutMs 单候选超时（宿主卡住时不死等）
 */
export async function detectLocalHost(
  fetchImpl: typeof fetch = globalThis.fetch,
  timeoutMs = 1500,
): Promise<string | undefined> {
  for (const candidate of PROBE_CANDIDATES) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(candidate, { signal: controller.signal });
      if (res.ok) {
        // 候选是绝对地址 ⇒ 取其 origin（去掉 `/__editor_host__/ping`）；相对地址 ⇒ 同源代理
        if (candidate.startsWith("http")) {
          const at = candidate.lastIndexOf("/__editor_host__");
          return at > 0 ? candidate.slice(0, at) : undefined;
        }
        return typeof location === "undefined" ? undefined : location.origin;
      }
    } catch {
      // 该候选不可用 ⇒ 试下一个（**不视为错误**）
    } finally {
      clearTimeout(timer);
    }
  }
  return undefined;
}

/** 外部打开请求；**白名单判据在宿主侧还会再做一遍**（前端只负责传，不做安全判断） */
export async function openExternal(
  host: LocalHostEndpoint,
  token: string,
  path: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await fetchImpl(`${host.baseUrl}/${token}/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) return { ok: false, reason: `宿主返回 ${res.status}` };
    return (await res.json()) as { ok: boolean; reason?: string };
  } catch (error: unknown) {
    return {
      ok: false,
      reason: `无法联系本地宿主：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** 列出工程文件（宿主侧枚举；浏览器形态下此能力不存在） */
export async function listHostFiles(
  host: LocalHostEndpoint,
  token: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<readonly string[] | undefined> {
  try {
    const res = await fetchImpl(`${host.baseUrl}/${token}/list`);
    if (!res.ok) return undefined;
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null || !("files" in body)) return undefined;
    const files = (body as { files: unknown }).files;
    return Array.isArray(files) ? (files.filter((f): f is string => typeof f === "string") as string[]) : undefined;
  } catch {
    return undefined; // 无宿主 / 出错 ⇒ "没有这个能力"（不是错误）
  }
}
