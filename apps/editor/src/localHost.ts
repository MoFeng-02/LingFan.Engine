/**
 * 本地宿主能力探测（**浏览器侧**，零 Node 依赖）。
 *
 * 约束：探测**只影响「有哪些动作可做」，不改布局、不分叉组件**——
 * 有宿主 ⇒ 完整体验（外部打开 / 原生枚举）；无 ⇒ 降级为浏览器形态（这是**正常**路径）。
 *
 * 端点形状与 `server/host.ts` 对齐：`GET /__editor_host__/ping`。
 * 前端**不假设**宿主在：探测失败一律当「无宿主」，不抛错、不重试刷屏。
 */
import type { WatchStatus } from "./contracts";

/** 宿主端点（探测结果）；`baseUrl` 为 `undefined` 表示无宿主 */
export interface LocalHostEndpoint {
  /** 环回基址（含端口），如 `http://127.0.0.1:62251` */
  readonly baseUrl: string;
  /** 本次启动的访问令牌（后续调用必须带；ping 不回任何路径） */
  readonly token: string;
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
): Promise<LocalHostEndpoint | undefined> {
  for (const candidate of PROBE_CANDIDATES) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(candidate, { signal: controller.signal });
      if (res.ok) {
        // 令牌缺失 ⇒ 不是本编辑器宿主（别的服务恰好 200）⇒ 当未命中，继续试下一个
        const token = await readTokenOf(res);
        if (token === undefined || token === "") continue;
        // 候选是绝对地址 ⇒ 取其 origin（去掉 `/__editor_host__/ping`）；相对地址 ⇒ 同源代理
        if (candidate.startsWith("http")) {
          const at = candidate.lastIndexOf("/__editor_host__");
          const baseUrl = at > 0 ? candidate.slice(0, at) : undefined;
          return baseUrl === undefined ? undefined : { baseUrl, token };
        }
        return typeof location === "undefined" ? undefined : { baseUrl: location.origin, token };
      }
    } catch {
      // 该候选不可用 ⇒ 试下一个（**不视为错误**）
    } finally {
      clearTimeout(timer);
    }
  }
  return undefined;
}

/** 从 ping 响应里取令牌（**容错**：非 JSON / 无 token ⇒ undefined，不抛） */
async function readTokenOf(res: Response): Promise<string | undefined> {
  try {
    const body: unknown = await res.clone().json();
    if (typeof body !== "object" || body === null || !("token" in body)) return undefined;
    const token = (body as { token: unknown }).token;
    return typeof token === "string" && token !== "" ? token : undefined;
  } catch {
    return undefined;
  }
}

/** 外部打开请求；**白名单判据在宿主侧还会再做一遍**（前端只负责传，不做安全判断） */
export async function openExternal(
  host: LocalHostEndpoint,
  path: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await fetchImpl(`${host.baseUrl}/__editor_host__/${host.token}/open`, {
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
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<readonly string[] | undefined> {
  try {
    const res = await fetchImpl(`${host.baseUrl}/__editor_host__/${host.token}/list`);
    if (!res.ok) return undefined;
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null || !("files" in body)) return undefined;
    const files = (body as { files: unknown }).files;
    return Array.isArray(files) ? (files.filter((f): f is string => typeof f === "string") as string[]) : undefined;
  } catch {
    return undefined; // 无宿主 / 出错 ⇒ "没有这个能力"（不是错误）
  }
}

/* ——— 热重载（轮询 revision；不引入 SSE，避免回环服务留长连接） ——— */

/** 读一次监视状态（失败 ⇒ `undefined`，按"无此能力"处理，不抛） */
export async function fetchWatchStatus(
  host: LocalHostEndpoint,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<WatchStatus | undefined> {
  try {
    const res = await fetchImpl(`${host.baseUrl}/__editor_host__/${host.token}/watch`);
    if (!res.ok) return undefined;
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null) return undefined;
    const o = body as { revision?: unknown; watching?: unknown; root?: unknown };
    if (typeof o.revision !== "number" || typeof o.watching !== "boolean") return undefined;
    return {
      revision: o.revision,
      watching: o.watching,
      ...(typeof o.root === "string" ? { root: o.root } : {}),
    };
  } catch {
    return undefined; // 宿主不在 / 端点无此能力
  }
}

/**
 * 轮询监视状态并在**计数变化**时回调（热重载的心跳）。
 *
 * 返回停止函数；**页面卸载时必须调**（否则定时器泄漏）。
 * `revision` 用**首次读到的值**作基线 —— 不拿它当"是否变过"，
 * 否则刚打开编辑器就会因基线为 0 而误判成"有变更"。
 */
export function pollWatch(
  host: LocalHostEndpoint,
  onChange: (status: WatchStatus) => void,
  intervalMs = 1500,
  fetchImpl: typeof fetch = globalThis.fetch,
): () => void {
  let stopped = false;
  let baseline: number | undefined;
  const tick = async (): Promise<void> => {
    if (stopped) return;
    const status = await fetchWatchStatus(host, fetchImpl);
    if (stopped || status === undefined) return;
    if (baseline === undefined) baseline = status.revision;
    else if (status.revision !== baseline) {
      baseline = status.revision;
      onChange(status);
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  void tick(); // 立刻取基线
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
