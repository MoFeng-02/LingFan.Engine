/**
 * DOM 层边界：`packages/ui/src/dom/` 是 ui 包内**唯一**允许
 * 出现 DOM 的目录——Web 物化器、`RenderPort` 实现、覆盖层 `OverlaySurface` 实现都在那里。
 * 覆盖层自身（`overlay/**`）是纯模型构造，层骨架与事件绑定
 * 全部下沉到 `src/dom/overlay-surface.ts`，故这里不再有例外清单。
 *
 * `UI_DOM_TIER` 的语义是命中集合与清单**逐项相等**；迁移完成后清单为空，
 * 判据收敛为「除 `src/dom/` 外零命中」。
 *
 * 词法判据前先剥掉注释与字符串（沿用 `tests/playground/shell-purity.test.ts` 的手法），
 * 否则文档注释里出现的 `document` 会误报。
 */
import { describe, expect, it } from "vitest";

const engineSources = import.meta.glob("../../packages/core/src/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const uiSources = import.meta.glob("../../packages/ui/src/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** 剥掉行/块注释、字符串/模板字面量与正则字面量，只留代码骨架 */
function stripToCodeSkeleton(source: string): string {
  let out = "";
  let i = 0;
  const prevSignificant = (): string => {
    for (let j = out.length - 1; j >= 0; j -= 1) {
      if (!/\s/.test(out.charAt(j))) return out.charAt(j);
    }
    return "";
  };
  while (i < source.length) {
    const ch = source.charAt(i);
    const next = i + 1 < source.length ? source.charAt(i + 1) : "";
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      out += " ";
      continue;
    }
    if (ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i += 1;
      while (i < source.length && source.charAt(i) !== ch) {
        if (source.charAt(i) === "\\") i += 1;
        i += 1;
      }
      i += 1;
      out += " ";
      continue;
    }
    if (ch === "/" && "([{,;=:!&|?+-*%~^".includes(prevSignificant())) {
      i += 1;
      while (i < source.length && source.charAt(i) !== "/") {
        if (source.charAt(i) === "\\") i += 1;
        i += 1;
      }
      i += 1;
      while (i < source.length && /[a-z]/i.test(source.charAt(i))) i += 1;
      out += " ";
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * 平台 API 词表（只列内核不该出现的）。
 * `window` 只认**取值形态**（`window.` / `window[`）：元素类型名里就有 `window`
 * （`packages/core/src/contracts/element.ts:68`）与 `window:` 键
 * （`element/renderers/register.ts:47`），裸词判据会把这些误报成 DOM 触点。
 * `HTML*Element` 要求 HTML 与 Element 之间至少一个字母，故 `HTMLElement` 不会双命中。
 */
const DOM_SYMBOLS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: "document", re: /\bdocument\b/ },
  { label: "window.<attr>", re: /\bwindow\s*[.[]/ },
  { label: "ownerDocument", re: /\bownerDocument\b/ },
  { label: "defaultView", re: /\bdefaultView\b/ },
  { label: "createElement", re: /\bcreateElement\b/ },
  { label: "navigator", re: /\bnavigator\b/ },
  { label: "localStorage", re: /\blocalStorage\b/ },
  { label: "HTMLElement", re: /\bHTMLElement\b/ },
  { label: "HTML*Element", re: /\bHTML[A-Za-z]+Element\b/ },
  { label: "SVGElement", re: /\bSVGElement\b/ },
  { label: "new Audio", re: /\bnew\s+Audio\b/ },
];

/** ui 包内唯一允许出现 DOM 的目录（Web 适配层） */
const DOM_DIR = "packages/ui/src/dom/";

/** glob 键 → 仓库相对路径 */
function rel(key: string): string {
  return key.replace(/^\.\.\/\.\.\//, "").replace(/\\/g, "/");
}

/** 该源码骨架是否出现平台 API，返回命中的符号名（无命中返回空数组） */
function domHits(raw: string): string[] {
  const skeleton = stripToCodeSkeleton(raw);
  return DOM_SYMBOLS.filter((s) => s.re.test(skeleton)).map((s) => s.label);
}

describe("平台中立面（源级扫描）", () => {
  const engineFiles = Object.entries(engineSources);
  const uiFiles = Object.entries(uiSources);

  it("扫描面非空（glob 失配时立刻失败，不许空转通过）", () => {
    expect(engineFiles.length).toBeGreaterThanOrEqual(50);
    expect(uiFiles.length).toBeGreaterThanOrEqual(20);
  });

  it("判据自证：合成源码能命中 document，注释与字符串里的不算", () => {
    expect(domHits("const a = document.body;")).toEqual(["document"]);
    expect(domHits("// document 只出现在注释里")).toEqual([]);
    expect(domHits('const s = "document";')).toEqual([]);
    expect(domHits("const c: HTMLElement = el;")).toEqual(["HTMLElement"]);
  });

  it("engine：零平台 API（宿主能力一律经端口注入）", () => {
    for (const [key, raw] of engineFiles) {
      const hits = domHits(raw);
      expect(hits, `${rel(key)} 出现平台 API：${hits.join(" / ")}`).toEqual([]);
    }
  });

  it("ui：DOM 只允许在 src/dom/ 内（其余源文件零平台 API）", () => {
    const offenders = uiFiles
      .filter(([, raw]) => domHits(raw).length > 0)
      .map(([key]) => rel(key))
      .filter((path) => !path.startsWith(DOM_DIR));

    expect(
      offenders,
      `平台中立目录出现 DOM 触点（DOM 只许放 ${DOM_DIR}）：${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
