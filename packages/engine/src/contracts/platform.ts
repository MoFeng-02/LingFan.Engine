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
 * 降级打开回执：资源根**缺 `project.json`** 时按确定性规则
 * 合成清单打开 —— 降级必须**显式告知**（状态栏/横幅），不做静默处理。
 * 结构损坏（清单存在但坏 JSON / 字段非法 / 故事解析失败）**仍 fail-closed**，
 * 可降级的只有「清单缺失」这一种。
 */
export interface DegradedOpen {
  /** 给人看的原因与口径（含「入口=列 id」），直接可上状态栏 title */
  readonly reason: string;
  /** 合成清单采用的入口列 id（确定性 = 路径码元序第一个列） */
  readonly entry: string;
}

/**
 * 工程文件供给端口：适配器只负责「取」，解析与组装归引擎——
 * **组装器是唯一解析点**（混存识别与单列文件名不变量在 assembleProject 统一生效）。
 * 实现：浏览器/WebView = adapters 的 fetch 加载器；Tauri Desktop/Mobile = 资源协议或 Rust 命令（只换适配器）。
 */
export interface ProjectFilesPort {
  /** 工程清单（JSON 解析后的对象；清单格式即 ProjectManifest 契约）。**缺清单 = 合成的降级清单**（见 `degraded`） */
  manifest(): Promise<unknown>;
  /** 故事文件**原始文本**（JSON v1 或 .story），键 = 逻辑路径（相对资源根） */
  stories(): Promise<Map<string, string>>;
  /**
   * 降级打开回执；resolve 为 `undefined` = 正常打开（清单存在）。
   * 缺省实现（Tauri / fetch 等）可不提供 —— 不提供即「无降级」。
   * 与 `manifest()` 共享同一次装载（实现方 memo），故为异步。
   */
  degraded?(): Promise<DegradedOpen | undefined>;
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
