/**
 * 宿主层**不得硬编码**列名 / 工程名 / 槽名的源级互锁。
 *
 * 为什么要守这三类字面量：宿主是「读工程、照着画」的一方，它手里的列名来自
 * `Stories.src` 的目录清单、工程名来自 `project.json`、槽名来自 `shell.saves.slots`
 * 经 `slotIds()` 生成。任何一处写死都只在**当前这一个工程**里看着能用——
 * 换个工程就指向不存在的列 / 不存在的槽，症状不是报错，是「点继续没反应」。
 *
 * 扫描面 = `template/**` 与 `apps/**` 的源码（`.ts` / `.vue` / `.tsx`）。
 * `.html` / `.json` 里的 `__PROJECT__` 是**脚手架占位符**（由 `@lingfan-engine/create`
 * 的 `replacePlaceholders` 在生成时替换，见 `packages/create/src/generate/replace.ts`），
 * 属合法形态，不在本判据范围。
 *
 * 判据是**双向**的，不只拦新增：
 * - 出现「不收清单」之外的命中 → 失败，逐条报 `文件:行号 [词] 原文`；
 * - 「不收清单」里的条目在源码里已找不到 → 同样失败。理由：清单只增不减会慢慢烂成
 *   一张「反正它绿着」的豁免表，而它存在的唯一意义是**每一行都还对应一处真实的正当用途**。
 */
import { describe, expect, it } from "vitest";

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** 三类禁写字面量：列名 / 工程名 / 槽名 */
const FORBIDDEN = ["__PROJECT__", "chapter1", "auto"] as const;

/** 只扫源码，不扫产物与依赖 */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "target",
  ".vite",
  "coverage",
]);
const SOURCE_EXT = /\.(ts|vue|tsx)$/;

/** 字符串字面量的三种引号形态：模板字符串写死列名与写死字符串一样有害 */
const QUOTES = ['"', "'", "`"];

interface Hit {
  /** 相对仓库根的路径，斜杠统一成 `/`（报告里可直接粘进编辑器） */
  file: string;
  line: number;
  token: string;
  text: string;
}

/**
 * 「不收」清单：每一处都是**真语义值**，不是我们这三个概念。
 *
 * `count` 是**期望命中次数**——只按文件名豁免等于给整个文件开白条，那里再多写一处
 * 硬编码就查不出来了。改了这个文件就跟着改数字，改动会在评审里显形。
 */
const ALLOWED: readonly {
  file: string;
  token: string;
  count: number;
  reason: string;
}[] = [
  {
    file: "apps/editor/src/shared/sample.ts",
    token: "auto",
    count: 1,
    reason: '`window` op 的 mode 取值（"auto" | "show" | "hide"），不是槽名',
  },
  {
    file: "apps/playground/src/App/SettingsPanels.vue",
    token: "auto",
    count: 1,
    reason: "屏幕方向 OrientationMode 的取值（跟随系统），不是槽名",
  },
  {
    file: "apps/playground/src/diag/probe.ts",
    token: "auto",
    count: 1,
    reason: 'CSS 计算样式里 zIndex 的默认值 "auto"，浏览器语义，非本仓概念',
  },
  {
    file: "apps/playground/src/Stories.src/config.ts",
    token: "chapter1",
    count: 1,
    reason:
      "示例故事源的 folders 创作内容——作者自己写的列清单，正是硬编码的对立面",
  },
  {
    file: "apps/editor/src/App.vue",
    token: "chapter1",
    count: 1,
    reason: "文档注释里举例章节名（反引号包住的说明文字），不是可执行字符串",
  },
];

/**
 * 递归收集待扫文件（返回绝对路径）。
 *
 * 用 `withFileTypes` 读目录项类型，并跳过符号链接：`src-tauri/gen/.../jniLibs/*.so`
 * 是指向 Rust target 目录的符号链接，目标不存在时 `statSync` 直接抛 ENOENT。
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

/** 逐行找命中：行号是给人定位用的，所以按行切而不是整篇 indexOf */
function findHits(files: string[]): Hit[] {
  const hits: Hit[] = [];
  for (const path of files) {
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    lines.forEach((text, index) => {
      for (const token of FORBIDDEN) {
        for (const quote of QUOTES) {
          if (text.includes(`${quote}${token}${quote}`)) {
            hits.push({
              file: relative(process.cwd(), path).split(sep).join("/"),
              line: index + 1,
              token,
              text: text.trim(),
            });
            break;
          }
        }
      }
    });
  }
  return hits;
}

/** 命中计数：键是 `文件::词`，值是次数 */
function countByKey(hits: readonly Hit[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const hit of hits) {
    const key = `${hit.file}::${hit.token}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

const ROOTS = ["template", "apps"].map((name) => join(process.cwd(), name));

describe("宿主层硬编码名 · 防回归互锁", () => {
  it("template/ 与 apps/ 里不出现写死的列名 / 工程名 / 槽名", () => {
    const files = ROOTS.flatMap((root) => collectSources(root));
    // 扫描面本身不能是空的：目录改名或搬走后，这条判据必须响，而不是「零命中所以通过」
    expect(files.length).toBeGreaterThan(50);

    const hits = findHits(files);
    const counts = countByKey(hits);

    // ① 清单之外的新命中，以及「同一文件里多写了几处」多出来的那几处
    const seen = new Map<string, number>();
    const unexpected = hits.filter((hit) => {
      const key = `${hit.file}::${hit.token}`;
      const ordinal = (seen.get(key) ?? 0) + 1;
      seen.set(key, ordinal);
      const allowed = ALLOWED.find(
        (entry) => entry.file === hit.file && entry.token === hit.token,
      );
      return allowed === undefined || ordinal > allowed.count;
    });
    const unexpectedReport = unexpected
      .map((hit) => `${hit.file}:${hit.line}  [${hit.token}]  ${hit.text}`)
      .join("\n");
    expect(
      unexpected,
      `宿主层写死了列名 / 工程名 / 槽名（换成别的工程就会指向不存在的东西）：\n${unexpectedReport}`,
    ).toEqual([]);

    // ② 清单条目已失效（源码里找不到那处用途）——豁免表不许只增不减
    const stale = ALLOWED.filter(
      (entry) => counts.get(`${entry.file}::${entry.token}`) !== entry.count,
    ).map(
      (entry) =>
        `${entry.file}  [${entry.token}]  期望 ${entry.count} 处，实得 ${counts.get(`${entry.file}::${entry.token}`) ?? 0} 处`,
    );
    expect(
      stale,
      `「不收」清单与实际源码不符（用途消失了就删掉条目，次数变了就改数字）：\n${stale.join("\n")}`,
    ).toEqual([]);
  });
});
