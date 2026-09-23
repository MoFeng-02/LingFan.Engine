/**
 * 08-U7 资源端口适配器（静态资源根）：逻辑资源路径（相对故事工程根 `Resources/`，如 `Audio/x.mp3`）
 * → 应用资源根 URL。逻辑路径与部署位置解耦，**不依赖进程工作目录**。
 * 当前实现 = WebView 源根静态资源（Vite `public/` 在开发与打包产物中同名同路径）；
 * 加密管线接入后替换为 Rust 解密适配器（decrypt → 短生命周期 Blob URL），本端口契约不变（08 §六.3）。
 */
import type { ResourcePort } from "@lingfan/engine";

/** 应用资源根（WebView 源根） */
const RESOURCE_ROOT = "/";

/**
 * 路径规范化：剥前导斜杠，拒绝空段与 `..` 逃逸——
 * 资源只能落在应用资源根之内（路径穿越在信任边界上拒绝，不靠调用方自觉）。
 */
function normalize(id: string): string {
  const trimmed = id.trim().replace(/^\/+/, "");
  if (trimmed === "") throw new Error("资源路径为空");
  if (
    trimmed.split("/").some((segment) => segment === "" || segment === "..")
  ) {
    throw new Error(`资源路径非法（越出资源根）：${id}`);
  }
  return trimmed;
}

export function createStaticResourcePort(
  root: string = RESOURCE_ROOT,
): ResourcePort {
  return {
    async resolve(id: string): Promise<string> {
      return `${root}${normalize(id)}`;
    },
    release(): void {
      // 静态 URL 无常驻句柄：空实现（Blob URL 适配器在此 revoke）
    },
  };
}
