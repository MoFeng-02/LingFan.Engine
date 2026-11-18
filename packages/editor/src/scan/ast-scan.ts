/**
 * 构建期扫描域 · 宿主面 AST 扫描器。
 *
 * 宿主文案不在任何 JSON 里，只能从源码发现：用仓内 typescript 编译器 API
 * `createSourceFile` **只解析不类型检查**，收集显式包在 `t("字面量")` 里的原文键。
 * 全部纯函数（输入 = 源码文本 + 文件路径字符串）：读盘归 CLI/IO 层，本模块不碰平台 API。
 * typescript 属构建期依赖：本域独立于 i18n/ 运行期域，包根与 i18n 出口都不值转发
 * 本模块（运行期出口可达图不得触达 typescript），创作期 CLI 经 ./index.ts 取用。
 *
 * 口径（与故事面 `extractStoryKeys` 互补，故事键走编译产物、不扫源码）：
 * - 只认登记过的函数名（裸调用 `t(...)` 与成员调用 `i18n.t(...)`），别名清单显式配置，
 *   不做隐式猜测——防止把日志/诊断/第三方字符串卷进译文表；
 * - 首参必须是字符串字面量；变量/拼接/模板串等动态调用**跳过并报告**（防漏翻被静默）；
 * - 默认只收含 CJK 的字面量（`all` 收全部非空字面量）；
 * - 注释与字符串内部天然不是调用节点；模板串内嵌表达式整棵跳过；
 * - 同文件同键去重、键集合稳定排序（确定性是骨架/对账/快照对比的前提）。
 *
 * 另提供未标记静态文案检测（`findUnmarkedHostTexts`）：含 CJK 但未包登记调用的
 * 字面量不进键集合，只进诊断——显式报告，不静默吞。
 */

import * as ts from "typescript";

export interface AstScanOptions {
  /**
   * `t()` 别名显式清单（如 `["t", "tr"]`）；缺省 `["t"]`。
   * 空清单属配置错误，fail-closed 抛错（静默扫不到任何键比报错更危险）。
   */
  functions?: readonly string[];
  /** 收全部非空字符串字面量（默认只收含 CJK 的） */
  all?: boolean;
}

/** 动态调用点：首参不是字符串字面量的登记函数调用（报告用，不中断扫描） */
export interface DynamicCallSite {
  /** 1 基行号 */
  line: number;
  /** 1 基列号 */
  column: number;
  /** 命中的函数名（别名清单里的名字） */
  callee: string;
}

export interface AstScanResult {
  /** 原文键集合（去重、稳定排序；空串字面量不收） */
  keys: string[];
  /** 动态调用点（源码出现序，确定性） */
  dynamic: DynamicCallSite[];
}

/**
 * CJK 判定范围：统一表意文字（含扩展 A）+ 兼容表意文字。
 * 只用于字符分类，不用于识别调用（调用识别一律走 AST）。
 */
const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/** 取被调函数名：裸标识符 `t` 或成员访问 `i18n.t` 的末段名；其余形态不认 */
function calleeNameOf(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

/**
 * 别名清单校验（键扫描与未标记检测共用）：空清单/含空名 fail-closed 抛错。
 * 导出给 CLI IO 层在装载上下文时先验一次——零源文件工程也要在配置错误处报错，
 * 而不是静默扫出空集。
 */
export function functionNamesOf(options: AstScanOptions): Set<string> {
  const functions = options.functions ?? ["t"];
  if (functions.length === 0) {
    throw new Error("i18n.functions 别名清单不能为空（至少登记一个函数名，如 t）");
  }
  if (functions.some((name) => typeof name !== "string" || name === "")) {
    throw new Error("i18n.functions 别名清单含空函数名");
  }
  return new Set(functions);
}

/**
 * 扫描单个宿主源文件。`fileName` 只用于解析器诊断与扩展名推断，不读盘。
 * 别名清单为空或含空名 fail-closed 抛错；其余输入（含语法残缺源码）尽力扫描。
 */
export function scanHostSource(
  text: string,
  fileName: string,
  options: AstScanOptions = {},
): AstScanResult {
  const names = functionNamesOf(options);
  const all = options.all === true;
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const keys = new Set<string>();
  const dynamic: DynamicCallSite[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = calleeNameOf(node.expression);
      if (callee !== undefined && names.has(callee)) {
        const first = node.arguments[0];
        if (first !== undefined && ts.isStringLiteral(first)) {
          // 空串不是有效键（与故事面抽取同口径）；多参调用只认首参
          if (first.text !== "" && (all || CJK_PATTERN.test(first.text))) {
            keys.add(first.text);
          }
        } else {
          const { line, character } = source.getLineAndCharacterOfPosition(
            node.getStart(source),
          );
          dynamic.push({ line: line + 1, column: character + 1, callee });
        }
      }
    }
    // 模板串内嵌表达式整棵跳过：内嵌调用不是稳定的翻译声明点
    if (ts.isTemplateExpression(node)) return;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { keys: [...keys].sort(), dynamic };
}

/**
 * 扫描范围谓词（供 IO 层枚举文件时过滤）：只收 `.ts` 源文件，
 * 排除依赖/构建/生成物目录（`node_modules`、`dist`、`gen`）、测试与声明文件。
 * 输入 = 工程内相对路径（`/` 或 `\` 分隔均可）；扫描根目录本身由调用方决定。
 */
export function isScannableSourcePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.length === 0) return false;
  if (segments.some((s) => s === "node_modules" || s === "dist" || s === "gen")) {
    return false;
  }
  const file = segments[segments.length - 1];
  if (!file.endsWith(".ts")) return false;
  if (file.endsWith(".test.ts") || file.endsWith(".d.ts")) return false;
  return true;
}

/** 未标记静态文案点：含 CJK 但未包登记调用的字符串字面量（1 基坐标，与 DynamicCallSite 同款） */
export interface UnmarkedTextSite {
  line: number;
  column: number;
  text: string;
}

/**
 * 检测单个宿主源文件里未标记的静态文案（诊断数据，不进键集合）：
 * - 只报含 CJK 的字符串字面量（纯 ASCII 文案不属翻译面，避免噪声）；
 * - 登记函数调用的**任意参位**字面量都算已声明（`t("键", "上下文")` 第二参不误报）；
 * - import/export 模块指定符不是用户文案，跳过；
 * - 模板串内嵌表达式整棵跳过（与键扫描同口径：不是稳定的翻译声明点）。
 * 别名清单校验与键扫描共用（空清单/含空名 fail-closed）。
 */
export function findUnmarkedHostTexts(
  text: string,
  fileName: string,
  options: AstScanOptions = {},
): UnmarkedTextSite[] {
  const names = functionNamesOf(options);
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const sites: UnmarkedTextSite[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTemplateExpression(node)) return;
    if (ts.isStringLiteral(node) && CJK_PATTERN.test(node.text)) {
      const parent = node.parent;
      const isModuleSpecifier =
        (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
        parent.moduleSpecifier === node;
      let isRegisteredArgument = false;
      if (ts.isCallExpression(parent) && parent.arguments.includes(node)) {
        const callee = calleeNameOf(parent.expression);
        isRegisteredArgument = callee !== undefined && names.has(callee);
      }
      if (!isModuleSpecifier && !isRegisteredArgument) {
        const { line, character } = source.getLineAndCharacterOfPosition(
          node.getStart(source),
        );
        sites.push({ line: line + 1, column: character + 1, text: node.text });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}