/**
 * 已退场概念的**源级防回归互锁**：引擎不再有「屏幕」这一层。
 *
 * 引擎只回答一件事：当前列 id 是不是空串（空串＝普通页面，非空＝对局内）。
 * 「启动界面 / 游戏界面」是宿主的页面，不是引擎的状态；一旦让它以「屏幕态」
 * 的身份回到源码里，宿主就又要按引擎的屏幕值去挂整屏组件，普通页面与引擎
 * 的边界随之重新糊掉。所以判据落在**源码文本**上，不 import 任何实现——
 * 实现已经不存在了，能守住的只有「它不许被写回来」。
 *
 * 扫描面 = `template/**` + `apps/**` + `packages/ui/src/**` 里的源文件
 * （`.ts` / `.vue` / `.tsx` / `.html` / `.css`），跳过 `node_modules` / `dist` /
 * `target` / `.vite` / `coverage` 这类产物目录。命中即失败，失败信息**逐条给出
 * 文件:行号、命中词与那一行原文**——只说「有违规」等于让人从头翻仓。
 */
import { describe, expect, it } from "vitest";

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** 退场符号表：任一词出现在源文件里即视为「屏幕域回来了」 */
const RETIRED = [
  "screenStore",
  "screenViewOf",
  "hostScreenOf",
  "sameScreenView",
  "ScreenView",
  "HostScreen",
  "createScreenSwitch",
  "StartScreen",
  "screen-start",
  "onScreen",
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

const ROOTS = ["template", "apps", join("packages", "ui", "src")].map((name) =>
  join(process.cwd(), name),
);

describe("退场实现 · 防回归互锁", () => {
  it("template/ 、apps/ 与 packages/ui/src/ 的源码里不出现屏幕域那套符号", () => {
    const files = ROOTS.flatMap((root) => collectSources(root));
    // 扫描面本身不能是空的：目录改名或搬走后，这条判据必须响，而不是「零命中所以通过」
    expect(files.length).toBeGreaterThan(50);

    const hits = findHits(files);
    // 逐条列出 文件:行号 —— 命中词与那一行原文一起给，省掉二次定位
    const report = hits
      .map((hit) => `${hit.file}:${hit.line}  ${hit.token}  ${hit.text}`)
      .join("\n");
    expect(hits, `已退场的屏幕域被写回来了：\n${report}`).toEqual([]);
  });
});
