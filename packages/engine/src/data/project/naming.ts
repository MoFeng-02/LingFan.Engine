/**
 * 工程文件的命名与路径判据：清单名、故事目录名、路径码元序、文件名安全段。
 * 组装、写回、差量与冲突检测都依赖同一套判据，这里只声明一份。
 */
/** 确定性文件顺序（路径码元序）——defines 覆盖与列序不随 Map 构造顺序漂移 */
export function byPath(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 清单文件名（清单必须在资源根内——dev/prod 同机制） */
export const MANIFEST_FILE = "project.json";

/** 故事目录名（Rust `STORIES_DIR` 同名） */
export const STORIES_DIR = "Stories";

/**
 * 点文件/点目录判据（`.gitkeep` / `.gitignore` …）—— **任何一段**以 `.` 开头即是。
 *
 * 为什么按「段」而不是整路径：工程里有 `Live2D/.gitkeep`、
 * `Media/BGM/.gitkeep` 之类嵌套占位文件（版本控制需要空目录），
 * 也有 `Lang/en-US/...`（**名字含点但不是点文件**）⇒ 只看整路径开头会漏掉嵌套的。
 */
export function isDotPath(path: string): boolean {
  return path
    .split("/")
    .some((segment) => segment.startsWith(".") && segment.length > 0);
}

/** Windows/APFS 上非法的文件名字符（`: * ? " < > |` + 路径分隔符） */
const UNSAFE_FILE_CHARS = /[\\/:*?"<>|]/;
const MAX_FILE_NAME_SEGMENT = 200;

/**
 * 列 id 能否直接作文件名段（单列文件名 = 列 id 不变量要求）。
 * 比组装层更严：写不出合法文件就不写（fail-closed）。
 */
export function isSafeFileNameSegment(id: string): boolean {
  if (id === "" || id.length > MAX_FILE_NAME_SEGMENT) return false;
  if (id === "." || id === "..") return false; // 目录跳转
  if (id.startsWith(".")) return false; // 点文件会被枚举跳过（写下去等于自删）
  if (UNSAFE_FILE_CHARS.test(id)) return false;
  for (const ch of id) {
    if ((ch.codePointAt(0) ?? 0) < 0x20) return false; // 控制字符（不用正则，避开 no-control-regex）
  }
  if (id.endsWith(" ") || id.endsWith(".")) return false; // Windows 会静默去掉
  return true;
}
