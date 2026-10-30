/**
 * 已退场实现的**源级防回归互锁**：`PageRegistry` 那一整套不得回来。
 *
 * 上一批曾发明 `PageContext` / `PageFactory` / `PageRegistry` 三件套，让引擎与宿主
 * 凭空多出「页面」概念——引擎只是进了某一列，宿主却要按列 id 注册整屏页面。
 * 裁定是整体删除、不留改名复用与过渡层，因为「我们还没有用户和老工程」。
 *
 * 删除本身不会自己保持：这类东西最容易被以「反正很便宜」的理由重新长回来，
 * 而重新长回来时编译得过、跑起来也「像在工作」。所以判据落在**源码文本**上，
 * 不 import 任何实现——实现已经不存在了，能守住的只有「它不许被写回来」。
 *
 * 扫描面 = `template/**` 与 `apps/**` 里的源文件（`.ts` / `.vue` / `.tsx` / `.html` / `.css`），
 * 跳过 `node_modules` / `dist` / `target` 这类产物目录。命中即失败，失败信息**逐条给出
 * 文件:行号与命中词**——只说「有违规」等于让人从头翻仓。
 */
import { describe, expect, it } from "vitest";

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** 退场符号表：任一词出现在源文件里即视为「那套东西回来了」 */
const RETIRED = [
  "PageRegistry",
  "PageFactory",
  "PageContext",
  "createPageRegistry",
  "createPageMounter",
  "createTitlePage",
  "createHudPanel",
  "pages.register",
  "pageContainer",
];

/** 只扫源码，不扫产物与依赖（Windows 路径安全：不用 forward-slash 过滤） */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "target",
  ".vite",
  "coverage",
]);
const SOURCE_EXT = /\.(ts|vue|tsx|html|css)$/;

/**
 * 递归收集待扫文件（返回绝对路径）。
 *
 * 用 `withFileTypes` 读目录项类型，而不是对每个路径再 `statSync` 一次：
 * `apps/playground/src-tauri/gen/android/.../jniLibs/*.so` 是**指向 Rust target 目录的符号链接**，
 * 目标不存在时 `statSync` 直接抛 ENOENT，整个扫描会因此崩掉——而这不是本判据要管的事。
 * 同理 `isSymbolicLink()` 的目录项一律跳过：链接目标可能在仓外，也可能根本没构建过。
 */
function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...collectSources(path));
    } else if (entry.isFile() && SOURCE_EXT.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

interface Hit {
  /** 相对仓库根的路径，斜杠统一成 `/`（报告里可直接粘进编辑器） */
  file: string;
  line: number;
  token: string;
  text: string;
}

/** 逐行找命中：行号是给人定位用的，所以按行切而不是整篇 indexOf */
function findHits(files: string[]): Hit[] {
  const hits: Hit[] = [];
  for (const path of files) {
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    lines.forEach((text, index) => {
      for (const token of RETIRED) {
        if (text.includes(token)) {
          hits.push({
            file: relative(process.cwd(), path).split(sep).join("/"),
            line: index + 1,
            token,
            text: text.trim(),
          });
        }
      }
    });
  }
  return hits;
}

const ROOTS = ["template", "apps"].map((name) => join(process.cwd(), name));

describe("退场实现 · 防回归互锁", () => {
  it("template/ 与 apps/ 的源码里不出现 PageRegistry 那套符号", () => {
    const files = ROOTS.flatMap((root) => collectSources(root));
    // 扫描面本身不能是空的：目录改名或搬走后，这条判据必须响，而不是「零命中所以通过」
    expect(files.length).toBeGreaterThan(50);

    const hits = findHits(files);
    // 逐条列出 文件:行号 —— 命中词与那一行原文一起给，省掉二次定位
    const report = hits
      .map((hit) => `${hit.file}:${hit.line}  [${hit.token}]  ${hit.text}`)
      .join("\n");
    expect(hits, `已退场的页面注册表实现被写回来了：\n${report}`).toEqual([]);
  });
});
