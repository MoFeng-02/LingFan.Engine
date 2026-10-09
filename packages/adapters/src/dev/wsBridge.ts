/**
 * 开发期 WS 桥：让浏览器（Vite 页面）复用 Tauri 宿主能力——
 * 读工程 / 存档 / 平台信息三类（白名单在 Rust 侧 ws_dev.rs，最小暴露面）。
 * 协议 = JSON 文本帧 RPC：请求 `{id, cmd, args}` → 响应 `{id, ok, data | error}`。
 *
 * 仅 `import.meta.env.DEV` 的浏览器形态使用；宿主未运行 = 连接超时快速失败，
 * 由组合根回退 web 端口（现状不变，尽力而为）。socket 工厂可注入（测试替身
 * 不依赖真实 WS 服务器）。
 */
import type { ProjectFilesPort, SavePort } from "@lingfan/engine";

/** 最小 WS 契约（浏览器 WebSocket 结构性满足；测试替身按此实现） */
export interface WsSocketLike {
  addEventListener(type: string, listener: (ev: { data?: unknown }) => void): void;
  send(data: string): void;
  close(): void;
}

/** 已连接的 WS 桥：按白名单命令调用宿主（负载形状与 invoke 契约一致） */
export interface WsBridge {
  call<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  close(): void;
}

/** dev 通道缺省地址（紧邻 Vite 1420；Rust 侧 LFEN_WS_PORT 可改，改端口经 options.url） */
export const DEFAULT_WS_BRIDGE_URL = "ws://127.0.0.1:1421";

/**
 * `connectWsBridge` 的装配参数：`url` 换端口（Rust 侧 `LFEN_WS_PORT` 改了才需要）、
 * `timeoutMs` 控连接超时（宿主没起来就快速失败，让组合根回退 web 端口）、
 * `makeSocket` 注入测试替身，缺省用浏览器原生 `WebSocket`。
 */
export interface ConnectWsBridgeOptions {
  url?: string;
  /** 连接超时（宿主未运行 = 快速失败，组合根回退 web 端口） */
  timeoutMs?: number;
  /** socket 工厂（测试替身注入点；缺省 = 浏览器原生 WebSocket） */
  makeSocket?: (url: string) => WsSocketLike;
}

/** 连接 WS dev 通道：open 带超时；后续调用按 id 路由 */
export async function connectWsBridge(
  options?: ConnectWsBridgeOptions,
): Promise<WsBridge> {
  const url = options?.url ?? DEFAULT_WS_BRIDGE_URL;
  const timeoutMs = options?.timeoutMs ?? 2000;
  const makeSocket =
    options?.makeSocket ??
    ((u: string) => new WebSocket(u) as unknown as WsSocketLike);
  const socket = makeSocket(url);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`WS dev 通道连接超时：${url}`));
    }, timeoutMs);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error(`WS dev 通道不可用：${url}`));
    });
  });

  let seq = 0;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  socket.addEventListener("message", (ev) => {
    let payload: {
      id?: number | string;
      ok?: boolean;
      data?: unknown;
      error?: string;
    };
    try {
      payload = JSON.parse(String(ev.data));
    } catch {
      return; // 非 JSON 帧忽略（dev 通道协议外流量）
    }
    if (typeof payload.id !== "number") return; // 无 id / 非数字 id 的帧无法路由
    const entry = pending.get(payload.id);
    if (entry === undefined) return;
    pending.delete(payload.id);
    if (payload.ok === true) entry.resolve(payload.data);
    else entry.reject(new Error(payload.error ?? "WS dev 通道调用失败"));
  });

  return {
    call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
      const id = ++seq;
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: (v) => resolve(v as T), reject });
        socket.send(JSON.stringify({ id, cmd, args: args ?? {} }));
      });
    },
    close(): void {
      socket.close();
    },
  };
}

/** 命令负载（Rust `project_files` 返回：清单 + 逻辑路径 → 故事原始文本） */
interface WsProjectFiles {
  manifest: unknown;
  stories: Record<string, string>;
}

/** ProjectFilesPort 的 WS dev 实现（与 Tauri 适配器同形：memo + Record → Map） */
export function createWsProjectFilesPort(bridge: WsBridge): ProjectFilesPort {
  let loaded: Promise<WsProjectFiles> | null = null;
  const load = (): Promise<WsProjectFiles> => {
    loaded ??= bridge.call<WsProjectFiles>("project_files");
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

/** Rust `save_list` 行（snake_case，与 Tauri 适配器同形映射） */
interface WsSlotSummary {
  slot: string;
  save_count: number;
  timestamp: number;
  mode: string;
}

/** SavePort 的 WS dev 实现（命令名/参数键与 invoke 契约一致） */
export function createWsSavePort(bridge: WsBridge): SavePort {
  return {
    async write(slot, payload, mode): Promise<void> {
      await bridge.call("save_write", { slot, payload, mode });
    },
    async read(slot): Promise<string> {
      return bridge.call<string>("save_read", { slot });
    },
    async remove(slot): Promise<void> {
      await bridge.call("save_delete", { slot }); // 删档不动高水位
    },
    async list() {
      const rows = await bridge.call<WsSlotSummary[]>("save_list");
      return rows.map((r) => ({
        slot: r.slot,
        saveCount: r.save_count,
        timestamp: r.timestamp,
        mode: r.mode,
      }));
    },
  };
}

/** 平台事实经 WS 问宿主（与 readTauriPlatform 同语义；createHostPort 的 platform 供值） */
export function createWsHostPlatform(bridge: WsBridge): Promise<string> {
  return bridge.call<string>("host_platform");
}
