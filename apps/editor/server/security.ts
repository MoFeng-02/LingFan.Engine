/**
 * 本地服务的安全面判据（**纯函数，可测**）——照 `media_http.rs` 的信任边界抄：
 * 仅绑回环 / 端口由内核分配 / 每次启动随机 token 入路径 / 只服务白名单扩展名 /
 * 路径必须落在资源根内。
 *
 * 为什么要独立成模块并**可测**：这是本机 HTTP 服务的**唯一安全关口**，
 * 而「哪条路径合法」是最容易写错的一环（一次 `startsWith` 写松就等于任意文件读取）。
 * 判据一旦错，后果是**本机任意文件被浏览器读走** ⇒ 必须是能穷举断言的纯函数。
 *
 * ⛔ 本模块**不含**任何 IO（不 spawn、不读文件）—— 那些在 `server/host.ts`。
 */

/** 安全判定结果：OK 给出规范化相对路径；否则给出可操作原因 */
export type PathVerdict =
  | { readonly ok: true; readonly relative: string }
  | { readonly ok: false; readonly reason: string };

/** 允许外部编辑器打开的扩展名（**白名单**：不在表内一律拒绝，不做"猜测编辑器"） */
export const OPENABLE_EXTENSIONS: readonly string[] = [
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".jsonc",
  ".md", ".txt", ".html", ".css",
  ".yml", ".yaml", ".toml", ".env",
];

/** 允许「外部编辑器打开」的**目录白名单**（相对资源根）——源码面在资源根**之外**，需显式放行 */
export const OPENABLE_ROOTS: readonly string[] = ["src", "."];

/** 路径穿越检测：`..` 段、绝对路径、空段、Windows 盘符、反斜杠归一 */
export function normalizeRelativePath(input: string): PathVerdict {
  const unified = input.replace(/\\/g, "/");
  if (unified.startsWith("/")) {
    return { ok: false, reason: "拒绝绝对路径" };
  }
  if (/^[a-zA-Z]:/.test(unified)) {
    return { ok: false, reason: "拒绝带盘符的路径" };
  }
  const segments = unified.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.length === 0) {
    return { ok: false, reason: "空路径" };
  }
  if (segments.some((s) => s === "..")) {
    return { ok: false, reason: "拒绝路径穿越（..）" };
  }
  return { ok: true, relative: segments.join("/") };
}

/**
 * 路径是否落在**资源根内**（相对判据，不碰文件系统）。
 *
 * ⚠️ 注意：这是**字符串级**判定，**不等于**防住符号链接 —— 真实防护由宿主在
 * 解析后复核对「realpath 仍在根内」完成（见 `server/host.ts`）。这里先挡掉明显的越界形态。
 */
export function isInsideRoot(relative: string): boolean {
  return !relative.startsWith("..") && !relative.includes("/../");
}

/**
 * 能否用外部编辑器打开：**扩展名白名单 ∧ 目录白名单**。
 *
 * 设计取舍：为何要目录白名单而不只看扩展名 —— 因为「打开外部编辑器」等于
 * **把一个本机路径交给另一个程序**。`Saves/**` 与资源都在根内，但它们是**生成物**
 * （不该手改）；`src/**` 在根外（是作者自己的代码，正是要打开的）。
 */
export function canOpenExternal(relative: string): PathVerdict {
  const normalized = normalizeRelativePath(relative);
  if (!normalized.ok) return normalized;
  const path = normalized.relative;
  const ext = extensionOf(path);
  if (!OPENABLE_EXTENSIONS.includes(ext)) {
    return {
      ok: false,
      reason: `扩展名 ${ext === "" ? "（无）" : ext} 不在外部打开白名单内（仅代码/配置/文档类）`,
    };
  }
  const top = path.includes("/") ? path.slice(0, path.indexOf("/")) : ".";
  if (!OPENABLE_ROOTS.includes(top)) {
    return {
      ok: false,
      reason: `目录 ${top}/ 不在外部打开白名单内（只放行 ${OPENABLE_ROOTS.join("、")}）`,
    };
  }
  return { ok: true, relative: path };
}

/**
 * 取「有效扩展名」（**小写**）。
 *
 * ⚠️ 点开头文件（`.env` / `.gitignore`）的扩展名**就是整个文件名**（`path.extname(".env")`
 * 返回空串）—— 按「最后一个点之后」的朴素写法会把 `.env` 判成「无扩展名」而拒掉。
 * 正确口径：**首字符是点 ⇒ 整个文件名即扩展名**。
 */
function extensionOf(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  if (file.startsWith(".")) return file.toLowerCase();
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(dot).toLowerCase() : "";
}

/**
 * token 校验：**不符一律 404**（不区分"token 错"与"路径不存在"，避免探测）。
 * 每次启动随机 ⇒ 别的进程/别的标签页拿不到。
 */
export function tokenMatches(expected: string, received: string | null): boolean {
  if (typeof received !== "string" || received.length === 0) return false;
  // 定长比较（避免按前缀早退泄露信息）
  if (received.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * 把随机字节转成 hex token（**纯函数**）。
 *
 * 为何不直接在本模块里 `import { randomBytes } from "node:crypto"`——
 * 那会让本文件**依赖 Node 内置模块** ⇒ 纯逻辑测试跑在浏览器/vitest 环境时
 * 解析失败。**取随机数归宿主**（它已经在 Node 侧），本模块只做字节→hex。
 */
export function tokenHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}
