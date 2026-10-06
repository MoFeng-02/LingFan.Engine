/**
 * 故事格式契约 + 工程清单。
 * op 全集渐进补齐；契约只增不改。
 */
import type { ProjectShellConfig } from "./shell";
import type { ElementNode } from "./element";

/** 命令：已知 op 的负载由解析器/执行器窄化校验，未知字段/未知 op fail-closed */
export interface StoryCommand {
  op: string;
  [field: string]: unknown;
}

/**
 * 列的**运行语义类型**—— 决定存档 / 回溯 / 自动推进行为。
 *
 * ⚠️ **与 `kind` 正交，两根轴各管一件事**（老引擎 `SceneType` 的语义，本仓此前缺）：
 * - `kind`（scene/flow）= **内容形态**：有没有 `elements[]` / `commands[]`
 * - `type`（game/menu/ui）= **运行语义**：进不进历史与存档、菜单是否自动推进
 *
 * 权威语义对齐老引擎 `LingFanEngine.Abstractions/Entities/Enums/SceneType.cs`：
 * - `game`：实际游戏场景 —— **存档、进历史、建立检查点**
 * - `menu`：菜单 / 标题 / 设置 —— 不存档、不进历史、不建检查点（**可覆盖**）
 * - `ui`：覆盖层 / 弹窗 —— 同上，且**不改变历史游标**
 *
 * **缺省 = `game`**（对齐老引擎 `SceneType.Game = 0` 的默认）⇒ 既有工程零改动。
 */
export type SceneType = "game" | "menu" | "ui";

/** 场景类型判据（非法值由解析层 fail-closed，此处只做窄化） */
export function isSceneType(value: unknown): value is SceneType {
  return value === "game" || value === "menu" || value === "ui";
}

/** 两类列：scene（空间层）与 flow（纯流程） */
export interface StoryColumn {
  id: string;
  kind: "scene" | "flow";
  /**
   * 运行语义类型（**缺省 `game`**，对齐老引擎 `SceneType.Game`）。
   * 决定该列是否进历史/存档/检查点，以及菜单态能否自动推进。
   * ⚠️ **与 `kind` 正交**：`kind: "flow" + type: "menu"`（纯流程的菜单）是合法组合。
   */
  type?: SceneType;
  /**
   * **来源文件路径**（逻辑路径，相对资源根，如 `Stories/chapter1/chapter1.story`）。
   *
   * 🔴 **治根字段（2026-10-05）**：写回必须**写回同一个文件**。
   * 此前写回凭 `id` 重算路径（`Stories/<id>.json`）⇒ 保存一次就把作者的
   * **章节目录编排**与 **`.story` 文本形态**抹平，且原文件被判「陈旧」删除
   * （探针实测：3/3 子目录文件全被删）。自我良好工程不接受这种行为。
   *
   * 语义纪律：
   * - **只记来源，不参与语义**：`kind` / `type` / 命令面都不读它（换路径不改行为）。
   * - **由组装器回填**（`assembleProject` 从实际文件路径回填，不猜）。
   * - **缺省 = 新建列**，走 `Stories/<id>.json`（编辑器新建的列没有来源文件）。
   * - **不序列化进故事文件本身**（它是编辑期元数据，见 `columnFileText` 的剥离）。
   */
  sourcePath?: string;
  /** scene 专有：舞台元素声明（类型与属性全集 fail-closed）。
   *  进入列时由引擎装载为 `SYS.elements`（声明式空间层，不走命令流） */
  elements?: ElementNode[];
  /** scene 专有：入口命令，元素后按序执行 */
  entry?: StoryCommand[];
  /** flow 专有：纯流程命令 */
  commands?: StoryCommand[];
}

/** 该列是否参与历史/存档（`type` 缺省 = game ⇒ 参与）。**单一判定点**——引擎守卫与编辑器分组共用。 */
export function isReplayableColumn(column: Pick<StoryColumn, "type">): boolean {
  return (column.type ?? "game") === "game";
}

/** 故事 = 列的集合（多文件组装后的运行时形态）；formatVersion 自 v1 起版本化 */
export interface Story {
  formatVersion: 1;
  id: string;
  /** 入口列：project.json entry 字段；单文件故事默认首列 */
  entry: string;
  columns: StoryColumn[];
  /** 顶层结构化定义：无条件 Set，后加载覆盖先加载 */
  defines?: Record<string, unknown>;
  /** 信封语言声明（多版本列文件 `{id}_{lang}` 的文件内声明；缺省 = 默认语言） */
  lang?: string;
  /**
   * 扩展声明透传（来自工程清单 `extensions`；组装器校验后原样携带）——
   * 宿主组合根据此装载扩展（`loadDeclaredExtensions`）并注入引擎构造与编辑器合并面。
   */
  extensions?: string[];
}

/** 工程清单（project.json）：结构化/原子化多文件工程的组装契约 */
export interface ProjectManifest {
  formatVersion: 1;
  id: string;
  /** 入口列（story.start 导航至入口列） */
  entry: string;
  /** 工程显示名（可选） */
  name?: string;
  /** 默认语言（I18N overlay 机制） */
  lang?: string;
  /**
   * 资源加密形态声明：true = 资源根为 `.enc` 加密包（LFEN2/LFEN），
   * 组合根据此装配加密 ResourcePort 与 Rust 供给密钥（清单恒明文——形态判定的前提）。
   */
  resourceEncryption?: boolean;
  /**
   * 工程级壳配置：作品默认屏幕方向（缺省 = auto）。玩家偏好可覆盖，
   * 方向不进存档/快照（壳配置非叙事语义）。
   */
  shell?: ProjectShellConfig;
  /**
   * 扩展声明（声明制）：宿主模块说明符列表（如 `"ext/demo.ts"`）。
   * 组合根按声明装载（`loadDeclaredExtensions`）——扫描器对未声明的扩展文件零感知
   * （不扫盘、不猜测，避免任意代码执行面）；缺席/为空 = 无扩展（unknown-op 口径不变）。
   */
  extensions?: string[];
  /** 工程级 defines：无条件 Set，先于故事文件应用（后加载覆盖） */
  defines?: Record<string, unknown>;
}

/** overlay 译文文件：overlay 根内相对路径（`/` 分隔；`main.json` = 全局兜底，最先合并）
 *  → 原文→译文映射。非字符串值 = 文件整体无效（供给侧跳过）。 */
export interface I18nOverlayFile {
  path: string;
  entries: Record<string, string>;
}

/**
 * I18N overlay 供给端口（按需加载；组合根经 EngineOptions 注入；缺省 = 原文直出）。
 * 文件列举/解密归供给侧（Rust `load_i18n_overlay`：目录 `Lang/{lang}/` 递归收集 +
 * 降级单文件 `Lang/{lang}.json` 以 `main.json` 供给）；main.json 兜底合并序归引擎
 * （mergeOverlayFiles——叙事语义，引擎侧可测）。返回列表顺序必须确定（适配器保证）；
 * Promise 拒绝 = 载入失败（引擎 fail-closed 保持原语言不变）。
 */
export interface I18nPort {
  loadOverlayFiles(lang: string): Promise<I18nOverlayFile[]>;
  /**
   * 可用语言列表（扫描 `Lang/` 子目录与单文件，恒含默认语言 zh-CN）。
   * 可选——缺省 = ["zh-CN"]（组合根未实现时语言选择器只显默认语言）。
   */
  listLanguages?(): Promise<string[]>;
}

/** 坐标：故事流唯一位置 `(columnId, index)` */
export interface ColumnCoordinate {
  columnId: string;
  index: number;
}
