import { isPlainObject } from "../../shared";
import { byPath, STORIES_DIR } from "./naming";
import type { ProjectFileDiff } from "../../contracts";

/**
 * 工程写回的差量：本次要写哪些文件，以及相对上次要删哪些。
 * 判定按文件文本本身（值相等即不写），不看时间戳。
 */
/** JSON 语义相等（作者手写排版不得因重排版被当成改动；任一侧非 JSON → false，照常写入） */
function sameJsonText(a: string, b: string): boolean {
  if (a === b) return true;
  let left: unknown;
  let right: unknown;
  try {
    left = JSON.parse(a);
    right = JSON.parse(b);
  } catch {
    return false;
  }
  return deepEqualJson(left, right);
}

/** JSON 值深等：数组按序逐项比较，普通对象只比键集合与各键值（与键顺序无关） */
function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, i) => deepEqualJson(item, b[i]));
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every(
    (key) => key in b && deepEqualJson(a[key], b[key]),
  );
}

/**
 * 期望文件集与打开基线的最小差量：**JSON 语义比较**（解析后深等即跳过，排版差异不算改动），
 * 非 JSON（`.story` 文本形态）退化为逐字节比较；陈旧故事文件（`Stories/**` 内不在期望集）→ 删除。
 *
 * 为何一律语义比较：工程里的故事文件与清单大多不是
 * `JSON.stringify(…, 2)` 的逐字节输出（作者手写排版，如单行内联对象）——逐字节比较会让
 * **每一次保存都重写全部文件**（热重载抖动 + 静默重排版）。语义相等即跳过，作者排版得以保留。
 */
export function diffProjectFiles(
  wanted: ReadonlyMap<string, string>,
  previous: ReadonlyMap<string, string>,
): ProjectFileDiff {
  const changes = new Map<string, string>();
  for (const [path, text] of wanted) {
    const before = previous.get(path);
    if (before === undefined || !sameJsonText(before, text)) {
      changes.set(path, text);
    }
  }
  const deletes = [...previous.keys()]
    .filter((path) => path.startsWith(`${STORIES_DIR}/`) && !wanted.has(path))
    .sort(byPath);
  return { changes, deletes };
}
