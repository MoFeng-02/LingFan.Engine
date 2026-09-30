/**
 * 资源寻址 + 工程文件供给端口：
 * 平台差异被限制在「供数」这一步——Desktop 与 Mobile（Tauri iOS/Android）各自实现同契约。
 */

/**
 * 资源端口：逻辑路径按**应用资源根**解析（不依赖进程工作目录），
 * 解析顺序 = 包内资源 → 用户目录 → 报错诊断。
 * 实现 = infra 适配器：静态根（未加密开发形态）或 Rust 解密 → 短生命周期 Blob URL。
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
 * **组装器是唯一解析点**（混存识别与单列文件名不变量在 assembleProject 统一生效）。
 * 实现：浏览器/WebView = adapters 的 fetch 加载器；Tauri Desktop/Mobile = 资源协议或 Rust 命令（只换适配器）。
 */
export interface ProjectFilesPort {
  /** 工程清单（JSON 解析后的对象；清单格式即 ProjectManifest 契约） */
  manifest(): Promise<unknown>;
  /** 故事文件**原始文本**（JSON v1 或 .story），键 = 逻辑路径（相对资源根） */
  stories(): Promise<Map<string, string>>;
}

/** 一次写回的实际结果（供界面提示；路径均为逻辑路径，码元序） */
export interface ProjectWriteReport {
  readonly written: readonly string[];
  readonly deleted: readonly string[];
}

/**
 * 工程文件写回端口：期望文件全集（引擎 `serializeProject` 产出）交给适配器，
 * 由适配器与**打开基线**求最小差量后落盘（只写变化、删陈旧）。
 * `writable = false` = 只读取径（目录 input 快照等）→ 宿主必须禁用保存。
 * 实现：浏览器 = File System Access 目录句柄；Tauri 桌面 = Rust 命令（同一契约，只换适配器）。
 */
export interface ProjectWriterPort {
  readonly writable: boolean;
  apply(files: ReadonlyMap<string, string>): Promise<ProjectWriteReport>;
}
