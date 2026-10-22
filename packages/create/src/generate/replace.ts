/**
 * 占位符替换。
 *
 * 模板里的占位符有两套大小写形态：`__PROJECT__`（清单 id/name、页面标题、目录名）与
 * `__project__`（`package.json` 的 name，npm 要求小写）。工程名本身只允许小写，
 * 因此两者最终得到同一个字符串；分开列出来是为了让「哪里用了哪种形态」一眼可查，
 * 而不是靠一次全量替换把不该动的字节也改了。
 *
 * 替换面只覆盖**文本文件**：模板里有字体、图片这类二进制资源，逐字节做字符串替换
 * 会把它们改坏（一旦命中就整块错位），所以先判类型再决定是否处理。
 */

/** 模板二进制资源的扩展名；命中即按字节原样复制，不做文本替换 */
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
  ".mp3",
  ".ogg",
  ".wav",
  ".m4a",
  ".flac",
  ".mp4",
  ".webm",
  ".zip",
  ".gz",
  ".wasm",
]);

/** 已知的模板占位符形态 → 说明（生成时全部替换为工程名） */
export const PLACEHOLDERS = ["__PROJECT__", "__project__"] as const;

/** 按扩展名判是否文本；未知扩展名一律当文本（模板里的无扩展名文件都是文本） */
export function isTextPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return true;
  return !BINARY_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

/**
 * 在文本里替换全部占位符。
 *
 * `placeholder` 是模板声明的权威占位符（当前为 `__PROJECT__`）；同时替换它的小写形态，
 * 因为 `package.json` 的 name 必须小写，模板里就写成 `__project__`——只替换大写形态
 * 会让新工程的包名仍然是占位符。
 */
export function replacePlaceholders(
  text: string,
  placeholder: string,
  projectName: string,
): string {
  const forms = new Set([placeholder, placeholder.toLowerCase()]);
  let out = text;
  for (const form of forms) {
    out = out.split(form).join(projectName);
  }
  return out;
}

/**
 * 对一份文件内容做占位符替换：文本走替换，二进制原样返回。
 *
 * 返回 `Buffer` 是为了让调用方写盘时不必关心来源是文本还是字节。
 */
export function replaceInFile(
  path: string,
  content: Buffer,
  placeholder: string,
  projectName: string,
): Buffer {
  if (!isTextPath(path)) return content;
  return Buffer.from(
    replacePlaceholders(content.toString("utf8"), placeholder, projectName),
    "utf8",
  );
}
