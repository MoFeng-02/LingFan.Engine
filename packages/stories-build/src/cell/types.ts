/** 提取产出（书写序；已按（注册面, 名字）+ 实现文本指纹去重） */
export interface CellScan {
  guards: ReadonlyArray<{ readonly name: string; readonly implText: string }>;
  /** 生成物头部的 import 语句（说明符已按 gen/ 位置重写；跨文件去重，保序） */
  importStatements: readonly string[];
}

/** 单条问题（origin = "相对路径:行"） */
export interface CellIssue {
  readonly message: string;
  readonly origin: string;
}

/** cell 所在文件的 import 上下文：绑定名 + 重写后的语句文本 */
export interface FileImports {
  readonly bindingNames: ReadonlySet<string>;
  readonly statements: ReadonlyArray<{
    readonly adjustedText: string;
    readonly bindings: readonly string[];
  }>;
}

/** `scanCells` 的可配置项（整项缺省 = 内建默认值，调用方只给要覆盖的那一项） */
export interface ScanCellsOptions {
  /** 允许在内联实现里直接引用的全局名（缺省 = 标准全局白名单 16 项） */
  readonly globalWhitelist?: ReadonlySet<string>;
  /**
   * 生成物目录回到源根的相对前缀（缺省 `".."` = 生成物在源根内恰深一层）。
   * 生成物挪到源根之外的同级目录时传 `"../Stories.src"` 这类值。
   */
  readonly rootPrefix?: string;
  /**
   * 判断某条 import 是否由别的通道处置（家例：UI 句柄导入）。命中的语句既不搬进
   * 生成物、也不算问题——它压根不是生成注册物的运行期依赖，越界与否由那条通道自己判。
   */
  readonly isForeignImport?: (fromRel: string, specifier: string) => boolean;
}
