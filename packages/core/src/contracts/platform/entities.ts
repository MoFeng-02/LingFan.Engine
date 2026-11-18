/**
 * 平台契约的数据形态：资源与工程文件在引擎与平台之间传递时用的描述性类型。
 *
 * 端口（平台要实现的方法集合）见同目录 `ports.ts`。
 */

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

/** 一次写回的实际结果（供界面提示；路径均为逻辑路径，码元序） */
export interface ProjectWriteReport {
  readonly written: readonly string[];
  readonly deleted: readonly string[];
}

/**
 * 资源文件句柄：按逻辑路径取到的文件内容，供宿主生成临时地址用的中立形态。
 *
 * 契约层只用语言核心类型表达，因此这里只承诺一个事实：它是一份有字节长度的文件内容。
 * 宿主在自己的运行环境里把它收窄回真实文件对象（浏览器形态下就是文件对象本身）再使用，
 * 收窄只发生在宿主侧——供给方给出的就是该环境的真实实现。
 */
export interface ProjectFileHandle {
  /** 字节长度（真实文件对象天然满足） */
  readonly size: number;
}

/**
 * 编辑器诊断的供给侧数据：资源根实际文件集合 + overlay 译文键（并集与逐语言两种口径）。
 * 由平台供给方装载后交给诊断分析（诊断的可选入参形态即此）。
 */
export interface DiagnosticSupply {
  /** 资源根内实际文件的**逻辑路径**集合（相对资源根，原样） */
  resourceFiles: ReadonlySet<string>;
  /** overlay 译文键并集（`Lang/**` 全部语言；无 `Lang/` = 空集） */
  overlayKeys: ReadonlySet<string>;
  /**
   * **按语言分组**的 overlay 键（本地化工作台用）。
   *
   * 为何与 `overlayKeys` 并存而不替换：诊断的「多余译文」判据要的是**并集**口径
   * （任一语言多译即报），而工作台要的是**逐语言**口径（每个语言各自缺哪些）
   * ⇒ 两种口径都是对的，合成一个会毁掉其中一个。
   *
   * 键 = 语言码（目录形态 `Lang/{lang}/**` 取 `{lang}`；单文件 `Lang/{lang}.json` 取文件名）。
   */
  overlayKeysByLang: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * **按语言分组**的 overlay 文件表（本地化工作台反映真实 per-story 布局用）。
   *
   * 语言码 → overlay 真实逻辑路径（相对资源根，原样：单文件形态就是 `Lang/{lang}.json`）
   * → 该文件的译文键集。解析失败的文件（坏 JSON / 根非对象 / 非字符串值）整文件跳过
   * 不进表；有效但零键的文件仍出现（空键集）——工作台要看见文件本身的存在。
   * 可选字段：供给方缺席时消费方按旧口径（单文件假设）回落，双轨并存。
   */
  overlayFilesByLang?: ReadonlyMap<
    string,
    ReadonlyMap<string, ReadonlySet<string>>
  >;
  /**
   * 布局冲突：同一语言内同键出现在 ≥2 个文件且取值 ≥2 种（跨语言不比）。
   * 全部语言合并一张列表；`sites.path` 为含语言段的真实逻辑路径。
   * 解析失败的文件不参与。可选字段：供给方缺席 = 该诊断族跳过。
   */
  layoutConflicts?: readonly {
    readonly key: string;
    readonly sites: readonly {
      readonly path: string;
      readonly value: string;
    }[];
  }[];
  /**
   * 宿主源码里未标记的静态文案（含 CJK 未包 t()）。仅能读源码的供给方
   * （Node/CLI 形态）可填；浏览器形态扫不了源码 ⇒ 缺席 = 该诊断族跳过。
   */
  unmarkedHostTexts?: readonly {
    readonly file: string;
    readonly line: number;
    readonly column: number;
    readonly text: string;
  }[];
}
