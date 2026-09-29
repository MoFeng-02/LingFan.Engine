/**
 * 自定义 op 扩展契约。
 *
 * 设计红线（三不变量）：
 * 1. **状态只进 SSOT**——扩展经 `ExtensionContext.set` 写入的状态即全局状态
 *    （`ext.<extensionId>.<key>` 命名空间），随快照/存档/回溯自动随行；序列化 100% 归引擎。
 * 2. **未注册 = `unknown-op` fail-closed 不放松**——扩展只是「更多 op」，注册前与不存在无异。
 * 3. **扩展不触达 Rust/密钥/文件系统**——上下文只暴露窄接口（状态读写 + 只读故事树）。
 *
 * 键命名空间（2026-09-27 裁定）：扩展写入必须走 `ext.<extensionId>.<key>`；
 * `ExtensionContext.set/get` **物理强制**该前缀（门卫而非纪律——扩展代码写不出前缀外的键）。
 */

import type { Story, StoryCommand } from "./story";

/** 扩展写入的键命名空间前缀（`ext.<extensionId>.`） */
export const EXT_KEY_PREFIX = "ext.";

/** extensionId 形态：小写字母开头，小写字母/数字/`_`/`-`，1..32 */
export const EXTENSION_ID_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

/** 扩展执行上下文：`set/get` 物理强制 `ext.<extensionId>.` 前缀（门卫）；story 只读 */
export interface ExtensionContext {
  /** 读本扩展命名空间下的状态（等价 `get("ext.<id>.<key>")`） */
  get(key: string): unknown;
  /**
   * 写本扩展命名空间下的状态（等价 `setGlobal("ext.<id>.<key>", value)`）：
   * 值守卫复用引擎契约（JSON 安全 + 深走查），违规 = `engine.error` + 状态原样
   * （与内建写入同一纪律）；写入即进 SSOT（随快照/存档/回溯随行）。
   */
  set(key: string, value: unknown): void;
  /** 只读故事树（禁止修改——修改只能经故事命令与编辑器） */
  readonly story: Readonly<Story>;
}

/** 扩展 op 执行结果：ok = 推进到下一命令；失败 = `engine.error(code, message)` + 停在当前命令（状态原样） */
export type ExecOutcome = { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string };

/**
 * 自定义 op 文本投影：
 * 文本是 JSON 的投影——**投影不了的 op 不能假装能投影**（未注册投影器的自定义 op
 * 在文本形态整次拒绝，T2 同口径；容错路径 projectText 降级为该行 issue）。
 * 两方向都**不得抛**（同 exec 纪律——抛出由引擎兜底按失败处理）；返回 null = 失败。
 */
export interface OpTextProjection {
  /** JSON 命令 → DSL 行（**含 op 名**、不含行首缩进；null = 不可投影 → 文本形态整次拒绝） */
  readonly toText?: (cmd: Readonly<StoryCommand>) => string | null;
  /** DSL 行（含 op 名、不含缩进）→ JSON 命令（null = 该行解析失败 → 带行列 issue） */
  readonly fromText?: (text: string) => StoryCommand | null;
}

/** 自定义 op 文本投影表（op 名 → 投影器；传给 parseTextStory/generateText/projectText） */
export type CustomOpProjections = ReadonlyMap<string, OpTextProjection>;

/** 扩展 op 的编辑器声明（载体字段：引擎不解释，编辑器 mergeOpSchemas/mergeOpMeta 消费） */
export interface OpEditorSchema {
  /** 展示标签（属性面板 / 时间线 / 组件面板） */
  readonly label: string;
  /** 组件面板归组（与内建 `OP_META.group` 同语义） */
  readonly group: string;
  /**
   * 负载校验 schema（与内建 `OP_SCHEMAS` 同构：zod strictObject、**不含 op 键**）。
   * 引擎零依赖 zod，故以 `unknown` 载体声明，编辑器侧窄化为 `z.ZodType`。
   */
  readonly schema: unknown;
}

/** 单个自定义 op 的运行期定义（编辑器表单 schema 面属编辑器契约，在编辑器侧扩展） */
export interface OpDefinition {
  /** op 名（作者在 dsl/json 里写的名字）；注册期查重（禁覆盖内建/已注册） */
  readonly op: string;
  /**
   * 执行体：**不得抛**（fail-closed 返回失败结果，同引擎 op 纪律——抛出视同扩展违约，
   * 由引擎兜底转 `custom-op-threw`）；副作用只经 `ctx.set`（进 SSOT）。
   */
  readonly exec: (cmd: Readonly<Record<string, unknown>>, ctx: ExtensionContext) => ExecOutcome;
  /** 可选：文本投影——缺省 = 文本形态整次拒绝（见 OpTextProjection 注） */
  readonly project?: OpTextProjection;
  /** 可选：编辑器声明——缺省 = 编辑器按 unknown-op 口径报（与引擎一致，不假红） */
  readonly schema?: OpEditorSchema;
}

/** 扩展声明（一个扩展 = 一个 ESM 模块默认导出；宿主组合根扫描后注入引擎构造） */
export interface OpExtension {
  /** 稳定标识；注册期按 `EXTENSION_ID_PATTERN` 校验且 op 名不得与内建/其他扩展冲突；进存档依赖标记 */
  readonly id: string;
  /** 状态 schema 版本（≠ 代码版本）：存档校验的是它，代码升级不等于状态升级 */
  readonly stateVersion: number;
  /** 本扩展提供的自定义 op */
  readonly ops?: readonly OpDefinition[];
  /**
   * 可选：读档成功后重建运行期句柄（等价小游戏「重新挂载」）。
   * **不抛**（抛出视同违约，引擎兜底按失败处理）；返回 false = 不可恢复 → 整档拒绝
   * （`extension-restore`，状态原样）。
   */
  readonly restore?: (ctx: ExtensionContext) => boolean;
  /**
   * 可选：状态迁移（stateVersion 升级路径）。`state` = 本扩展命名空间内的键值
   * （**不含** `ext.<id>.` 前缀，与 ExtensionContext 门卫视角一致），返回同构对象（引擎负责重新落前缀）。
   * **不抛**；返回 null = 无法迁移 → 整档拒绝（`extension-version`，状态原样）。
   */
  readonly migrate?: (
    fromStateVersion: number,
    state: Readonly<Record<string, unknown>>,
  ) => Record<string, unknown> | null;
}
