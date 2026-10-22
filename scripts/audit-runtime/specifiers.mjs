import { builtinModules } from "node:module";

/**
 * Node 内建模块全集。取自运行中 Node 的 `builtinModules` 而非手写清单——
 * 手写清单会随 Node 版本漂移，漏一个名字就是一条静默放行的通道。
 */
const NODE_BUILTINS = new Set();
for (const name of builtinModules) {
  NODE_BUILTINS.add(name);
  NODE_BUILTINS.add(`node:${name}`);
}

/** `fs/promises` 这类子路径按根段判定 */
function builtinRootOf(spec) {
  const withoutPrefix = spec.startsWith("node:") ? spec.slice(5) : spec;
  return withoutPrefix.split("/")[0];
}

/**
 * 判定一个导入说明符。
 *
 * 返回 `kind`：
 * - `violation`：Node 专属，运行期产物里出现即失败；
 * - `relative` / `workspace`：需要继续遍历（图要跟着走）；
 * - `external`：第三方包，不遍历（它自身是否 Node 专属不归本门禁管，归打包器报错）；
 * - `asset`：带扩展名的资源引用，不遍历。
 */
export function classifySpecifier(spec) {
  if (spec.startsWith("node:")) {
    return { kind: "violation", reason: `Node 专属说明符 ${spec}` };
  }
  if (!spec.startsWith(".") && !spec.startsWith("/") && !spec.startsWith("@")) {
    if (NODE_BUILTINS.has(builtinRootOf(spec))) {
      return { kind: "violation", reason: `Node 内建模块 ${spec}` };
    }
  }
  if (spec.startsWith(".")) return { kind: "relative" };
  if (spec.startsWith("@lingfan-engine/")) return { kind: "workspace" };
  if (
    /\.(png|jpe?g|gif|webp|svg|ico|mp3|ogg|wav|m4a|flac|mp4|webm|json|css)$/.test(
      spec,
    )
  ) {
    return { kind: "asset" };
  }
  return { kind: "external", name: spec };
}

/** Node 运行期全局的成员名：`process` 本身在 WebView 里不存在，取它的常见成员做证据 */
const PROCESS_MEMBER_RE =
  /\bprocess\s*\.\s*(env|argv|platform|cwd|exit|stdout|stderr|stdin|versions|nextTick|on|once|hrtime|memoryUsage)\b/g;

/** 返回 `process.*` 命中列表，元素形如 `{ line, text }` */
export function scanProcessUsage(text) {
  const hits = [];
  PROCESS_MEMBER_RE.lastIndex = 0;
  let match;
  while ((match = PROCESS_MEMBER_RE.exec(text)) !== null) {
    hits.push({ line: lineAt(text, match.index), text: match[0] });
  }
  return hits;
}

/** 1 基行号：供报错定位 */
export function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}
