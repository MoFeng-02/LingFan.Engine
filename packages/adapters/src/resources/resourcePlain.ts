/**
 * 资源明文 ResourcePort 原生实现：逻辑路径 → Rust `resource_url` → 自定义协议 URL。
 *
 * 为什么明文形态也要走原生：壳内没有「页面源根」这个命名空间——页面从打包产物加载，
 * 而资源落在 `resource_root()` 指向的目录（打包后即应用包内的 `Resources/`）。
 * 静态根相对路径（`/Audio/x.mp3`）在 WebView 里永远取不到那些文件，媒体元素只会判解码失败。
 * 协议段与路径编码归 Rust（平台差异不落前端），前端只做路径规范化与负载校验。
 */
import type { ResourcePort } from "@lingfan-engine/core";
import { defaultInvoke, type TauriInvoke } from "../platform";
import { normalizeResourceId } from "./resourcePort";

/** Rust `resource_url` 返回形状：明文资源的自定义协议 URL */
interface UrlPayload {
  url?: string;
}

/**
 * 造一个明文资源端口（原生形态）：每次 `resolve` 调 Rust `resource_url`，拿到自定义协议
 * URL 直接交给媒体元素。路径先规范化（空路径、空段、`..` 逃逸在信任边界上拒绝），
 * 负载不是 JSON 或缺 `url` 一律抛错（fail-closed，不返回坏 URL）。
 * 明文直读不复制临时文件，URL 非常驻句柄，因此 `release` 是空实现。
 */
export function createTauriResourcePort(
  invoke: TauriInvoke = defaultInvoke,
): ResourcePort {
  return {
    async resolve(id: string): Promise<string> {
      const path = normalizeResourceId(id);
      const raw = await invoke<string>("resource_url", { path });
      let payload: UrlPayload;
      try {
        payload = JSON.parse(raw) as UrlPayload;
      } catch {
        throw new Error(
          `resource_url 负载异常（非 JSON）：${raw.slice(0, 64)}`,
        );
      }
      if (typeof payload?.url === "string" && payload.url !== "") {
        return payload.url; // 协议段与编码由 Rust 构造（平台形态差异不落前端）
      }
      throw new Error("resource_url 负载缺 url 字段");
    },
    release(): void {
      // 协议 URL 直接指向资源根里的文件：没有临时副本要回收
    },
  };
}
