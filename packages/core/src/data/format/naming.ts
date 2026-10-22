/**
 * 文件名工具：去目录去扩展名。
 * 组装层用它校验「单列文件名 = 列 id」不变量；文本投影的反向派生（id ← 源文件名）也用它。
 */
export function baseName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const file = normalized.slice(normalized.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}
