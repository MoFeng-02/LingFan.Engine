/**
 * 编辑器集中文案表（contract 层只放类型 + 缺省实现，与 engine 的 contracts/messages.ts 同形）。
 *
 * 规则：
 * - 所有面向用户的中文文案都从这里走；缺省串即编辑器的既有文案（只搬位置，不改文案）。
 * - 消费方经函数参数可选注入 `texts?: Partial<EditorTexts>`，缺省 `defaultEditorTexts`；
 *   禁止模块级可变全局或注册表 setter。
 */

/** 编辑器集中文案表：每个方法对应一条已迁移的用户可见文案（方法名即文案身份）。 */
export interface EditorTexts {
  /** diagnostics：columnId 重复（columnId 全局唯一）。 */
  duplicateColumn(columnId: string): string;
  /** diagnostics：入口列不存在。 */
  missingEntryColumn(entry: string): string;
  /** diagnostics：跳转目标列不存在。 */
  missingJumpTargetColumn(target: string): string;
  /** diagnostics：调用未注册的函数。 */
  unknownFunction(target: string): string;
  /** diagnostics：调用目标既不是 func 也不是列。 */
  missingCallTarget(target: string): string;
  /** diagnostics：表达式里使用未定义变量。 */
  undefinedVariableExpression(name: string): string;
  /** diagnostics：插值里使用未定义变量。 */
  undefinedVariableInterpolation(name: string): string;
  /** diagnostics：资源路径不存在。 */
  missingResource(path: string): string;
  /** diagnostics：未使用的译文键。 */
  unusedTranslationKey(key: string): string;
  /** diagnostics：原文未有任何译文。 */
  missingTranslationOriginal(original: string): string;
  /** diagnostics：元素属性已声明但无渲染语义。 */
  unimplementedElementAttr(attr: string): string;
  /** diagnostics：元素动作序列里不可用的动作。 */
  elementOpsBlockedOp(op: string): string;

  /** schema/validate：命令带未知负载字段（编辑期 fail-closed）。 */
  unknownPayloadFields(op: string, keys: string): string;
  /** schema/validate：必填字段缺失（path 为空时无点段）。 */
  missingRequired(op: string, path: string): string;
  /** schema/validate：字段值不合法（localized 是 zod issue 的中文翻译）。 */
  invalidValue(op: string, path: string, localized: string): string;
  /** schema/validate：命令必须为对象。 */
  commandMustBeObject(): string;
  /** schema/validate：命令必须含非空 op 字符串。 */
  commandMustHaveOp(): string;
  /** schema/validate：未知或未实现的命令。 */
  unknownCommand(op: string): string;
  /** schema/validate：资源路径不能为空。 */
  resourcePathEmpty(): string;
  /** schema/validate：资源路径不能为空（要停止该通道请用 ${stopOp}）。 */
  resourcePathEmptyStop(stopOp: string): string;
  /** schema/validate：数值太小。 */
  valueTooSmall(at: string, min: number): string;
  /** schema/validate：值太小（无数值上下文）。 */
  valueTooSmallBare(at: string): string;
  /** schema/validate：数值太大。 */
  valueTooBig(at: string, max: number): string;
  /** schema/validate：值太大（无数值上下文）。 */
  valueTooBigBare(at: string): string;
  /** schema/validate：类型不对（expected 缺省时无括注）。 */
  invalidType(at: string, expected: string): string;
  /** schema/validate：格式不对（format 缺省时无括注）。 */
  invalidFormat(at: string, format: string): string;

  /** i18n/table：译文表不是合法 JSON。 */
  invalidJson(error: string): string;
  /** i18n/table：译文表根节点必须是对象。 */
  tableRootMustBeObject(): string;
  /** i18n/table：键不能为空。 */
  keyEmpty(): string;
  /** i18n/table：键的首尾不能有空白。 */
  keySurroundingWhitespace(): string;
  /** i18n/table：键不能含控制字符。 */
  keyControlChars(): string;
  /** i18n/table：键已存在。 */
  keyAlreadyExists(key: string): string;
  /** i18n/table：目标键不在表中。 */
  keyNotInTable(key: string): string;
  /** i18n/table：改名目标键已存在，不能合并两行。 */
  renameConflict(key: string): string;

  /** i18n/skeleton：语言码不合法。 */
  invalidLangCode(lang: string): string;
  /** i18n/skeleton：故事路径不合法。 */
  invalidStoryPath(storyPath: string): string;

  /** i18n/reconcile：某语言缺译 0 条（覆盖完整）。 */
  missingZero(lang: string): string;
  /** i18n/reconcile：某语言缺译 N 条。 */
  missingCount(lang: string, count: number): string;
  /** i18n/reconcile：多译 0 条（无冗余译文键）。 */
  unusedZero(): string;
  /** i18n/reconcile：多译 N 条。 */
  unusedCount(count: number): string;

  /** script/expr：未 defineVars 就使用 expr。 */
  exprRequiresDefineVars(): string;
  /** script/expr：不支持的插值类型。 */
  unsupportedInterpolationType(type: string): string;
  /** script/expr 警告：插值落在字符串字面量内部。 */
  interpolationInsideString(): string;
  /** script/expr 警告：未闭合的字符串字面量。 */
  unclosedStringLiteral(): string;
  /** script/expr：变量句柄路径非法。 */
  invalidVarHandlePath(prop: string, prefix: string): string;
  /** script/expr：未注册的变量。 */
  unregisteredVariable(key: string): string;
  /** script/expr 审计：操作数类型不匹配。 */
  operandKindMismatch(op: string, side: string, want: string, described: string, note: string): string;
  /** script/expr 审计：三元条件必须为 boolean。 */
  ternaryCondNotBool(described: string): string;
  /** script/expr 审计：不支持跨类型比较。 */
  crossTypeComparison(op: string, left: string, right: string): string;
  /** script/expr 审计：未知类型的操作数标签。 */
  unknownOperandKind(): string;

  /** schema/surface：扩展 op 归组不合法。 */
  invalidOpGroup(extensionId: string, op: string, declaredGroup: string, validGroups: string): string;
}

/** 缺省文案表：即编辑器的既有文案（只搬位置，不改文案）。 */
export const defaultEditorTexts: EditorTexts = {
  duplicateColumn: (columnId) => `columnId 重复：${columnId}（columnId 全局唯一）`,
  missingEntryColumn: (entry) => `入口列 ${entry} 不存在`,
  missingJumpTargetColumn: (target) => `跳转目标列不存在：${target}`,
  unknownFunction: (target) => `调用未注册的函数：${target}`,
  missingCallTarget: (target) => `调用目标不存在：${target}（既不是 func 也不是列）`,
  undefinedVariableExpression: (name) =>
    `未定义变量：${name}（表达式里使用，求值会失败并**停机**——请先用 set/define 定义它）`,
  undefinedVariableInterpolation: (name) =>
    `未定义变量：${name}（插值失败将按原文保留——若它应是变量请先定义，若只是普通文字请去掉花括号）`,
  missingResource: (path) => `资源路径不存在：${path}`,
  unusedTranslationKey: (key) =>
    `未使用的译文键：${key}（say / menu / input / notify 四个翻译面均未命中原文——该键运行期不会生效；若这段文字只用于元素文本或宿主界面，本条可忽略）`,
  missingTranslationOriginal: (original) =>
    `原文未有任何译文：${original}（所有语言的 overlay 均未命中——运行期回退原文；专有名词等有意保留原文的可忽略）`,
  unimplementedElementAttr: (attr) => `元素属性 ${attr} 已声明但当前无渲染语义（写入不生效）`,
  elementOpsBlockedOp: (op) =>
    `元素动作序列里的 ${op} 不可用（等待/位置/存档类会打断当前叙事流）；跳列请用 nav 属性`,

  unknownPayloadFields: (op, keys) => `${op} 未知负载字段：${keys}（编辑期 fail-closed）`,
  missingRequired: (op, path) => `${op}${path ? `.${path}` : ""} 必填`,
  invalidValue: (op, path, localized) => `${op}${path ? `.${path}` : ""}：${localized}`,
  commandMustBeObject: () => "命令必须为对象",
  commandMustHaveOp: () => "命令必须为含非空 op 字符串的命令对象",
  unknownCommand: (op) => `未知或未实现的命令：${op}`,
  resourcePathEmpty: () => "资源路径不能为空",
  resourcePathEmptyStop: (stopOp) => `资源路径不能为空（要**停止**该通道请用 \`${stopOp}\`）`,
  valueTooSmall: (at, min) => `${at}不能小于 ${min}`,
  valueTooSmallBare: (at) => `${at}值太小`,
  valueTooBig: (at, max) => `${at}不能大于 ${max}`,
  valueTooBigBare: (at) => `${at}值太大`,
  invalidType: (at, expected) =>
    expected === "" ? `${at}类型不对` : `${at}类型不对（需要 ${expected}）`,
  invalidFormat: (at, format) =>
    format === "" ? `${at}格式不对` : `${at}格式不对（要求 ${format}）`,

  invalidJson: (error) => `不是合法 JSON：${error}`,
  tableRootMustBeObject: () => "译文表根节点必须是对象（键 → 译文）",
  keyEmpty: () => "键不能为空",
  keySurroundingWhitespace: () => "键的首尾不能有空白",
  keyControlChars: () => "键不能含控制字符",
  keyAlreadyExists: (key) => `键「${key}」已存在`,
  keyNotInTable: (key) => `键「${key}」不在表中`,
  renameConflict: (key) => `键「${key}」已存在，不能合并两行`,

  invalidLangCode: (lang) => `语言码不合法：${lang}（须为单段安全文件名）`,
  invalidStoryPath: (storyPath) =>
    `故事路径不合法：${storyPath}（须为相对 Stories/ 的段级安全路径，如 chapter1/tavern）`,

  missingZero: (lang) => `[${lang}] 缺译 0 条（覆盖完整）`,
  missingCount: (lang, count) => `[${lang}] 缺译 ${count} 条（运行期回退原文）：`,
  unusedZero: () => "多译 0 条（无冗余译文键）",
  unusedCount: (count) => `多译 ${count} 条（未使用 = 冗余）：`,

  exprRequiresDefineVars: () => "expr 需要先 defineVars（变量注册是表达式句柄的前提）",
  unsupportedInterpolationType: (type) =>
    `expr 不支持的插值类型：${type}——若是变量句柄，请确认已在 defineVars 注册`,
  interpolationInsideString: () =>
    "插值落在字符串字面量内部（引号未闭合）——插值文本会被并进字面量，不会成为表达式操作数",
  unclosedStringLiteral: () => "表达式存在未闭合的字符串字面量（引擎将 parse-error）",
  invalidVarHandlePath: (prop, prefix) => `变量句柄路径非法：${prop}（前缀 ${prefix}）`,
  unregisteredVariable: (key) => `未注册的变量：${key}——请在 defineVars 清单中声明后再引用`,
  operandKindMismatch: (op, side, want, described, note) =>
    `'${op}' ${side}操作数必须为 ${want}——${described}（引擎 type-error${note}）`,
  ternaryCondNotBool: (described) =>
    `三元 '?' 条件必须为 boolean（引擎 type-error）——条件${described}`,
  crossTypeComparison: (op, left, right) =>
    `'${op}' 不支持跨类型比较（${left} vs ${right}）——引擎仅同类型标量相等`,
  unknownOperandKind: () => "未知类型",

  invalidOpGroup: (extensionId, op, declaredGroup, validGroups) =>
    `扩展「${extensionId}」的 op「${op}」归组不合法：${declaredGroup}（须为 ${validGroups} 之一）`,
};

/**
 * 把调用方可选注入的部分文案合并成完整表：`{ ...defaultEditorTexts, ...texts }`。
 * 各消费函数内部用它把 `texts?: Partial<EditorTexts>` 归一成 `EditorTexts`。
 * （契约层只放类型：以 const 箭头函数形态导出——export function 违反包结构互锁测试。）
 */
export const resolveEditorTexts = (
  texts?: Partial<EditorTexts>,
): EditorTexts => ({ ...defaultEditorTexts, ...texts });
