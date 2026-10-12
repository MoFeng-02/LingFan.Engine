import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** 收集目录下全部文件（posix 相对路径 → 文本）；目录不存在 = 空集 */
export function walkFiles(dir: string, rel = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const key = rel === "" ? name : `${rel}/${name}`;
    if (statSync(path).isDirectory()) {
      for (const [child, text] of walkFiles(path, key)) out.set(child, text);
    } else {
      out.set(key, readFileSync(path, "utf8"));
    }
  }
  return out;
}
