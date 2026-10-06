/**
 * i18n 工具链 · **译文表行编辑判据**（纯函数，可测）。
 *
 * 存在理由：`LangView` 此前只能**改值**（增删整表靠骨架/删除文件），译者真正要的
 * 「这一行不要了」「补一个键」只能在**视图里就地做**——但视图不该持有判据。
 * 本模块是那层判据的**唯一出处**，`LangView` 只负责渲染与收集意图。
 *
 * 三条纪律（都来自本仓既有教训，不是新发明）：
 *
 * 1. **写回按语义，不按字节**：产出**规范形**（键按码元序排序 + 2 空格缩进 + 结尾换行），
 *    与 `planOverlaySkeleton` 的 `content` 同形 ⇒ 同一输入逐字节确定，不因行序抖动而全文件重写。
 * 2. **不丢作者意图**：译文值按 `unknown` **原样往返**（不把非字符串 coerce 成 `""`）。
 *    coerce 看似无害，实则**保存一次就把数字/嵌套值抹平**——静默改数据。
 * 3. **fail-closed**：空键 / 重复键 / 改键到已存在 / 删不存在的键 ⇒ 显式报错，
 *    绝不「静默忽略」或「静默覆盖」（覆盖 = 丢译文）。
 */

/** 译文表的一行（`value` 原样保留，仅 `text` 供输入框显示） */
export interface TranslationRow {
  readonly key: string;
  /** **原样往返**的值（不 coerce；写回时按此序列化） */
  readonly value: unknown;
  /** 给输入框的字符串形态（非字符串值的直读形态；`undefined` → 空串） */
  readonly text: string;
}

/** 解析结果（坏 JSON / 非对象根 ⇒ `fail-closed`，不静默当空表） */
export type TableParse =
  | { readonly ok: true; readonly rows: readonly TranslationRow[] }
  | { readonly ok: false; readonly error: string };

/** 键按码元序比较（与既有 `LangView` 排序口径一致，不引入 locale 依赖） */
function byKey(a: TranslationRow, b: TranslationRow): number {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** 把 `unknown` 值转成输入框可显示的文本（`null`/对象/数组给 JSON 形态，不给 `[object Object]`） */
function displayTextOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    // 循环引用等不可序列化形态：如实显示占位，不假装能编辑
    return "";
  }
}

/**
 * 解析译文表 JSON 文本。
 *
 * ⚠️ **不接受数组根**（译文表契约是「键 → 译文」的平面对象）；数组根此前会被
 * `Array.isArray` 拦住并报错，保持不变。
 */
export function parseTranslationTable(source: string): TableParse {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (e) {
    return { ok: false, error: `不是合法 JSON：${String(e)}` };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "译文表根节点必须是对象（键 → 译文）" };
  }
  const rows = Object.entries(value as Record<string, unknown>).map(([key, v]) => ({
    key,
    value: v,
    text: displayTextOf(v),
  }));
  rows.sort(byKey);
  return { ok: true, rows };
}

/** 序列化回规范形（**键按码元序** + 2 空格缩进 + 结尾换行；值原样往返） */
export function serializeTranslationTable(rows: readonly TranslationRow[]): string {
  const out: Record<string, unknown> = {};
  for (const row of [...rows].sort(byKey)) out[row.key] = row.value;
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** 变更结果（失败带**可展示给用户**的原因，成功带新行集） */
export type TableEdit =
  | { readonly ok: true; readonly rows: readonly TranslationRow[] }
  | { readonly ok: false; readonly error: string };

/** 空键判据（空白串、首尾空白、含控制字符一律拒绝——键要能当 JSON 键与运行期查表） */
function keyProblem(key: string): string | undefined {
  if (key === "") return "键不能为空";
  if (key !== key.trim()) return "键的首尾不能有空白";
  if (/[\u0000-\u001f]/.test(key)) return "键不能含控制字符";
  return undefined;
}

/**
 * 增行。
 *
 * ⚠️ **重复键显式拒绝**（不覆盖）：译文表里一个键只能有一条，静默覆盖 = 丢译文。
 * 新行的值恒为 `""`（未翻译）——`text` 与 `value` 同步，避免「显示空、写出 undefined」。
 */
export function addTranslationRow(
  rows: readonly TranslationRow[],
  key: string,
): TableEdit {
  const problem = keyProblem(key);
  if (problem !== undefined) return { ok: false, error: problem };
  if (rows.some((r) => r.key === key)) {
    return { ok: false, error: `键「${key}」已存在` };
  }
  return { ok: true, rows: [...rows, { key, value: "", text: "" }].sort(byKey) };
}

/** 删行（键不存在 ⇒ 显式失败，不静默noop——上层据此提示「状态已变」） */
export function removeTranslationRow(
  rows: readonly TranslationRow[],
  key: string,
): TableEdit {
  if (!rows.some((r) => r.key === key)) {
    return { ok: false, error: `键「${key}」不在表中` };
  }
  return { ok: true, rows: rows.filter((r) => r.key !== key) };
}

/** 改键（重命名）；目标已存在 ⇒ 拒绝（合并两行译文 = 静默丢数据） */
export function renameTranslationRow(
  rows: readonly TranslationRow[],
  from: string,
  to: string,
): TableEdit {
  if (!rows.some((r) => r.key === from)) {
    return { ok: false, error: `键「${from}」不在表中` };
  }
  const problem = keyProblem(to);
  if (problem !== undefined) return { ok: false, error: problem };
  if (from === to) return { ok: true, rows };
  if (rows.some((r) => r.key === to)) {
    return { ok: false, error: `键「${to}」已存在，不能合并两行` };
  }
  return {
    ok: true,
    rows: rows.map((r) => (r.key === from ? { ...r, key: to } : r)).sort(byKey),
  };
}

/**
 * 改值。
 *
 * ⚠️ **保持值的原始类型**：文本非空且原值是合法 JSON 字面量（数字/布尔/null/数组/对象）
 * 时按该类型写回——否则「译文其实想写数字」会被引号包成字符串。但**普通文本一律按字符串**
 *（译者打的 `123` 若原值是字符串，语义是文本 `123`；类型跟随**原值**，不跟随输入形态）。
 * 原值非字符串时按 JSON 解析输入，失败则回落字符串（不吞错：解析失败仍写字符串原文）。
 */
export function setTranslationValue(
  rows: readonly TranslationRow[],
  key: string,
  text: string,
): TableEdit {
  if (!rows.some((r) => r.key === key)) {
    return { ok: false, error: `键「${key}」不在表中` };
  }
  return {
    ok: true,
    rows: rows.map((r) => (r.key === key ? { ...r, value: coerceLike(r.value, text), text } : r)),
  };
}

/** 值类型跟随**原值**：原值非字符串时，把输入按 JSON 解析（失败回落字符串原文） */
function coerceLike(original: unknown, text: string): unknown {
  if (typeof original === "string") return text;
  if (text === "") return "";
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** 脏判定（**逐行比键与值**；行数不同即脏。新增/删除/改键都必须能判出脏） */
export function isTableDirty(
  rows: readonly TranslationRow[],
  base: readonly TranslationRow[],
): boolean {
  if (rows.length !== base.length) return true;
  const baseByKey = new Map(base.map((r) => [r.key, r.value]));
  for (const row of rows) {
    if (!baseByKey.has(row.key)) return true;
    if (!sameValue(baseByKey.get(row.key), row.value)) return true;
  }
  return false;
}

/** 值相等判定（**结构相等**，不用 `===`——否则对象/数组永远判脏） */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object") return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false; // 不可序列化 ⇒ 保守判脏
  }
}
