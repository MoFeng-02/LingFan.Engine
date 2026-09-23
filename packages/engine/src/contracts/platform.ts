/**
 * 08-U7 资源寻址 + 07 §三 工程文件供给端口：
 * 平台差异被限制在「供数」这一步——Desktop 与 Mobile（Tauri iOS/Android）各自实现同契约。
 */

/**
 * 资源端口：逻辑路径按**应用资源根**解析（不依赖进程工作目录），
 * 解析顺序 = 包内资源 → 用户目录 → 报错诊断（08-U7）。
 * 实现 = infra 适配器：静态根（未加密开发形态）或 Rust 解密 → 短生命周期 Blob URL（08 §六.3）。
 * **资源禁止构建期 import / 静态直引**（ESLint 强制）：加密后无静态文件可指。
 */
export interface ResourcePort {
  /** 解析失败必须抛错（不静默返回坏 URL）；调用方 fail-closed 不播放 */
  resolve(id: string): Promise<string>;
  /** 释放解析结果（Blob URL 用后 revoke；静态 URL 为空实现） */
  release(url: string): void;
}

/**
 * 工程文件供给端口：适配器只负责「取」，解析与组装归引擎——
 * **组装器是唯一解析点**（T4 混存识别与单列文件名不变量在 assembleProject 统一生效）。
 * 实现：浏览器/WebView = adapters 的 fetch 加载器；Tauri Desktop/Mobile = 资源协议或 Rust 命令（只换适配器）。
 */
export interface ProjectFilesPort {
  /** 工程清单（JSON 解析后的对象；清单格式即 ProjectManifest 契约） */
  manifest(): Promise<unknown>;
  /** 故事文件**原始文本**（JSON v1 或 .story），键 = 逻辑路径（相对资源根） */
  stories(): Promise<Map<string, string>>;
}
