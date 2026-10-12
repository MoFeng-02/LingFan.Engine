/**
 * state schema 降维段（C12，编排层）：约定 `lib/state.ts` 导出的 `stateSchema` 数据声明
 * 是 state 初始值唯一来源——编译期求值（const-eval）→ 递归降维成扁平点路径 defines
 * （引擎初始化通道，session 无条件 Set，零引擎改动），经 mergeDefines 并入工程 defines。
 *
 * 降维文法（与 Stories.src/lib/state-type.ts 的 InferStateSchema 一一对应）：
 * - 嵌套对象递归拼接点路径（源形态只有嵌套一种，点路径键 fail-closed）；descriptor
 *   { type, default } 取 default；
 * - descriptor type ∈ "number"|"string"|"boolean" | 枚举对象（值全为 string|number）|
 *   单元素数组 [leaf]，default 与 type 做一致性校验；
 * - 形态非法 fail-closed（一次报全部）；值形态无法保留源位置，诊断统一挂在
 *   stateSchema 声明行，以键路径上下文定位；求值诊断带 const-eval 的原始行号。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";
import { evalConstModule } from "./const-eval";
import { formatConstDiagFile } from "./const-eval-pass";
import { StoryBuildError } from "../shared";

/** 约定路径（相对源目录）：state schema 声明文件。 */
export const STATE_SCHEMA_REL = "lib/state.ts";

const STATE_SCHEMA_EXPORT = "stateSchema";
const PRIMITIVE_TYPES: ReadonlySet<string> = new Set(["number", "string", "boolean"]);

/** 求值 lib/state.ts 并把 stateSchema 降维为扁平 defines（无该文件 = 无 schema 贡献）。 */
export async function runStateSchemaPass(
  sourcesDir: string,
  sourcesDirName: string,
): Promise<Record<string, unknown>> {
  const abs = join(sourcesDir, STATE_SCHEMA_REL);
  if (!existsSync(abs)) return {};
  const result = await evalConstModule(abs);
  if ("diags" in result) {
    throw new StoryBuildError(
      `state schema 求值失败（${result.diags.length} 条）：\n${result.diags
        .map(
          (diag) =>
            `- ${formatConstDiagFile(diag.file, sourcesDir, sourcesDirName)}:${diag.line}:${diag.col} ${diag.message}`,
        )
        .join("\n")}`,
    );
  }
  const schema = result.values[STATE_SCHEMA_EXPORT];
  if (schema === undefined) {
    throw new StoryBuildError(
      `${sourcesDirName}/${STATE_SCHEMA_REL}: 缺少 ${STATE_SCHEMA_EXPORT} 导出（C12 约定：state 初始值 schema 声明于此）`,
    );
  }
  const origin = locateSchemaDecl(abs);
  const errors: string[] = [];
  const defines: Record<string, unknown> = {};
  flattenRoot(schema, defines, errors, origin);
  if (errors.length > 0) {
    throw new StoryBuildError(
      `state schema 降维失败（${errors.length} 条）：\n${errors
        .map((message) => `- ${sourcesDirName}/${STATE_SCHEMA_REL}:${origin.line}:${origin.col} ${message}`)
        .join("\n")}`,
    );
  }
  return defines;
}

function flattenRoot(
  schema: unknown,
  out: Record<string, unknown>,
  errors: string[],
  origin: { line: number; col: number },
): void {
  if (!isPlainObject(schema)) {
    errors.push("stateSchema 根必须是键集对象");
    return;
  }
  for (const [key, value] of Object.entries(schema)) {
    if (key.includes(".")) {
      errors.push(dotKeyError(key));
      continue;
    }
    flattenValue(value, key, out, errors, origin);
  }
}

/** 点路径键统一拒绝：扁平 defines 键由降维展平产生，schema 源形态只有嵌套一种。 */
const dotKeyError = (key: string): string =>
  `${key}：点路径键不支持（schema 源形态统一纯嵌套对象，扁平 defines 键由降维展平产生）`;

function flattenValue(
  value: unknown,
  path: string,
  out: Record<string, unknown>,
  errors: string[],
  origin: { line: number; col: number },
): void {
  if (isPlainObject(value)) {
    if ("type" in value || "default" in value) {
      if (validateDescriptor(value, path, errors)) out[path] = value.default;
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key.includes(".")) {
        errors.push(dotKeyError(`${path}.${key}`));
        continue;
      }
      flattenValue(child, `${path}.${key}`, out, errors, origin);
    }
    return;
  }
  if (Array.isArray(value)) {
    errors.push(`${path}：数组值请用 descriptor { type: [leaf], default: [...] }`);
    return;
  }
  if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    errors.push(`${path}：不可序列化的 schema 值`);
    return;
  }
  out[path] = value;
}

/**
 * 校验 descriptor；返回 true 表示合法（default 已随之写入 defines）。
 * 诊断文本只带路径不带行列（`lib/state.ts` 的行列在整条消息末尾统一给出），
 * 所以这里不收 origin——多一个用不上的参数只会让调用方以为它能定位。
 */
function validateDescriptor(
  descriptor: Record<string, unknown>,
  path: string,
  errors: string[],
): boolean {
  if (!("default" in descriptor)) {
    errors.push(`${path}：descriptor 缺 default`);
    return false;
  }
  const type = descriptor.type;
  const def = descriptor.default;
  if (typeof type === "string" && PRIMITIVE_TYPES.has(type)) {
    const ok =
      (type === "number" && typeof def === "number" && Number.isFinite(def)) ||
      (type === "string" && typeof def === "string") ||
      (type === "boolean" && typeof def === "boolean");
    if (!ok) errors.push(`${path}：descriptor type "${type}" 与 default 不一致`);
    return ok;
  }
  if (Array.isArray(type)) {
    if (type.length !== 1) {
      errors.push(`${path}：数组 descriptor 的 type 必须是单元素 [leaf]`);
      return false;
    }
    if (!Array.isArray(def)) {
      errors.push(`${path}：数组 descriptor 的 default 必须是数组`);
      return false;
    }
    const bad = def.filter((element) => !leafMatches(type[0], element)).length;
    if (bad > 0) errors.push(`${path}：数组 default 有 ${bad} 个元素与 leaf 类型不一致`);
    return bad === 0;
  }
  const enumValues = asEnumValues(type);
  if (enumValues !== undefined) {
    if ((typeof def !== "string" && typeof def !== "number") || !enumValues.includes(def)) {
      errors.push(`${path}：descriptor default 不在枚举值域内`);
      return false;
    }
    return true;
  }
  errors.push(`${path}：无法识别的 descriptor type`);
  return false;
}

function leafMatches(leaf: unknown, value: unknown): boolean {
  if (typeof leaf === "string" && PRIMITIVE_TYPES.has(leaf)) {
    return (
      (leaf === "number" && typeof value === "number" && Number.isFinite(value)) ||
      (leaf === "string" && typeof value === "string") ||
      (leaf === "boolean" && typeof value === "boolean")
    );
  }
  const enumValues = asEnumValues(leaf);
  return enumValues !== undefined && (typeof value === "string" || typeof value === "number") && enumValues.includes(value);
}

/** 枚举对象判定：非空普通对象且值全为 string|number（descriptor 不落此形——type 槽位专用）。 */
function asEnumValues(value: unknown): (string | number)[] | undefined {
  if (!isPlainObject(value)) return undefined;
  const values = Object.values(value);
  if (values.length === 0) return undefined;
  return values.every((v) => typeof v === "string" || typeof v === "number")
    ? (values as (string | number)[])
    : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 在源文件里定位 `export const stateSchema` 声明行（形态诊断的统一挂点）；找不到 = 1:1 兜底。 */
function locateSchemaDecl(abs: string): { line: number; col: number } {
  try {
    const sf = ts.createSourceFile(abs, readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true);
    for (const stmt of sf.statements) {
      if (!ts.isVariableStatement(stmt)) continue;
      const exported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      const decl = stmt.declarationList.declarations[0];
      if (
        exported &&
        decl !== undefined &&
        ts.isIdentifier(decl.name) &&
        decl.name.text === STATE_SCHEMA_EXPORT
      ) {
        const pos = sf.getLineAndCharacterOfPosition(stmt.getStart(sf));
        return { line: pos.line + 1, col: pos.character + 1 };
      }
    }
  } catch {
    // 文件此刻不可读时退回 1:1（求值段已读过同一文件，此处仅为诊断挂点）
  }
  return { line: 1, col: 1 };
}
