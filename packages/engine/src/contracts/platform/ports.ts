/**
 * 平台供给端口：资源寻址 + 工程文件读写。
 * 平台差异被限制在「供数」这一步——Desktop 与 Mobile（Tauri iOS/Android）各自实现同契约。
 * 数据形态见同目录 `entities.ts`。
 */
import type {
  DegradedOpen,
  ProjectFileHandle,
  ProjectWriteReport,
} from "./entities";

/**
 * 资源端口：逻辑路径按**应用资源根**解析（不依赖进程工作目录），
 * 解析顺序 = 包内资源 → 用户目录 → 报错诊断。
 * 实现 = infra 适配器：静态根（未加密开发形态）或 Rust 解密 → 短生命周期临时地址。
 * **资源禁止构建期 import / 静态直引**（ESLint 强制）：加密后无静态文件可指。
 */
export interface ResourcePort {
  /** 解析失败必须抛错（不静默返回坏地址）；调用方 fail-closed 不播放 */
  resolve(id: string): Promise<string>;
  /** 释放解析结果（临时地址用后 revoke；静态地址为空实现） */
  release(url: string): void;
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

/**
 * 工程文件写回端口：期望文件全集（引擎 `serializeProject` 产出）交给适配器，
 * 由适配器与**打开基线**求最小差量后落盘（只写变化、删陈旧）。
 * `writable = false` = 只读取径（目录 input 快照等）→ 宿主必须禁用保存。
 * 实现：浏览器 = 目录选择器给出的目录句柄；Tauri 桌面 = Rust 命令（同一契约，只换适配器）。
 */
export interface ProjectWriterPort {
  readonly writable: boolean;
  apply(files: ReadonlyMap<string, string>): Promise<ProjectWriteReport>;
}

/**
 * 目录取径的统一供给面：逻辑路径 → 原始文本 / 文件内容。
 * 两类取径各一实现（目录句柄 / 目录 input 的文件表），端口构造只依赖此面。
 */
export interface ProjectFileSource {
  /** 资源根名（诊断与界面显示；句柄取径 = 句柄名，文件表取径 = 路径前缀末段） */
  readonly name: string;
  /** 资源根内全部文件逻辑路径（`/` 分隔、字典序确定、已跳点文件） */
  paths(): Promise<readonly string[]>;
  /** 按逻辑路径读原始文本（UTF-8；不存在/不可读必须抛错，不静默降级） */
  text(path: string): Promise<string>;
  /** 按逻辑路径取文件内容（生成临时地址用；不存在必须抛错） */
  file(path: string): Promise<ProjectFileHandle>;
}

/**
 * 上次工程句柄的持久化（浏览器形态：IndexedDB）。目录句柄是可结构化克隆对象，
 * IDB 原生支持存取；下次启动据此提供「重新打开上次工程」一键，免开目录选择器。
 * **任何存储失败一律静默**（隐私模式 / 配额 / 不支持）——功能退化为不存在，编辑器不受影响。
 *
 * 契约层只用语言核心类型表达，因此句柄在这里是不透明值（`unknown`）：形状校验由实现方
 * 在存取时做掉，取用方拿到的是**已经校验过**的句柄，收窄回自己运行环境的目录类型即可。
 */
export interface LastProjectHandleStore {
  /** 未存过、或存的东西不是目录形状时返回 `undefined` */
  load(): Promise<unknown>;
  save(handle: unknown): Promise<void>;
}
