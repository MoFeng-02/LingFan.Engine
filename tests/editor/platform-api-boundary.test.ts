/**
 * 编辑器内层边界：`contracts/` `domain/` `app/` `shared/` 四个目录是
 * **平台无关层**——契约、纯函数域、组合逻辑都不许直接摸 `window` / `document` /
 * 存储 / 观测器 / 网络。平台取径一律收敛到 `apps/editor/src/infra/`，
 * 再由组合根（`main.ts` + `App.vue`）注入：元素与事件由视图层（`.vue`）绑定，
 * 存储经 `KEY_VALUE_STORAGE_KEY` 提供，下载与宿主 HTTP 调 `infra` 的具名函数。
 *
 * 为什么要有这道互锁：这些触点一旦回流，DOM 就会重新长进域逻辑里，
 * 而单元测试（node 环境）不碰 DOM，回归不会被任何行为测试挡住。
 *
 * 词表口径（刻意留下的边界）：
 * - **平台全局与 DOM 元素类型**算违规；**事件类型**（`PointerEvent` / `WheelEvent` /
 *   `KeyboardEvent`）不算——它们是视图层传进来的数据形状，内层只读字段。
 * - `window` 只认取值形态（`window.` / `window[`）：中文注释与领域词里出现
 *   「窗口 / window」是常见词，裸词判据会误报（手法沿用
 *   `tests/ui/platform-neutral.test.ts`）。
 * - `document` 用整词判据：`documentId`、`documents` 这类标识符不会被误伤。
 *
 * 词法判据前先剥掉注释与字符串（沿用 `tests/playground/shell-purity.test.ts` 的手法）。
 */
import { describe, expect, it } from "vitest";

const LAYER_SOURCES = import.meta.glob(
  "../../apps/editor/src/{contracts,domain,app,shared}/**/*.ts",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** 组合根与装配点：只断言「谁负责把平台取径接进来」 */
const WIRING_SOURCES = import.meta.glob(
  ["../../apps/editor/src/main.ts", "../../apps/editor/src/App.vue"],
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** 平台取径的落点：这两个适配器必须存在（迁移不是删功能，而是换地方） */
const INFRA_SOURCES = import.meta.glob("../../apps/editor/src/infra/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** 目标层（平台无关的四层） */
const GUARDED_LAYERS = [
  "apps/editor/src/contracts/",
  "apps/editor/src/domain/",
  "apps/editor/src/app/",
  "apps/editor/src/shared/",
];

/** 平台 API 词表（只列平台无关层不该出现的） */
const PLATFORM_SYMBOLS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: "document", re: /\bdocument\b/ },
  { label: "window.<attr>", re: /\bwindow\s*[.[]/ },
  { label: "ownerDocument", re: /\bownerDocument\b/ },
  { label: "defaultView", re: /\bdefaultView\b/ },
  { label: "createElement", re: /\bcreateElement\b/ },
  { label: "localStorage", re: /\blocalStorage\b/ },
  { label: "sessionStorage", re: /\bsessionStorage\b/ },
  { label: "indexedDB", re: /\bindexedDB\b/ },
  { label: "navigator", re: /\bnavigator\b/ },
  { label: "requestAnimationFrame", re: /\brequestAnimationFrame\b/ },
  { label: "cancelAnimationFrame", re: /\bcancelAnimationFrame\b/ },
  { label: "HTMLElement", re: /\bHTMLElement\b/ },
  { label: "HTML*Element", re: /\bHTML[A-Za-z]+Element\b/ },
  { label: "SVGElement", re: /\bSVGElement\b/ },
  { label: "MutationObserver", re: /\bMutationObserver\b/ },
  { label: "IntersectionObserver", re: /\bIntersectionObserver\b/ },
  { label: "ResizeObserver", re: /\bResizeObserver\b/ },
  { label: "getBoundingClientRect", re: /\bgetBoundingClientRect\b/ },
  { label: "scrollIntoView", re: /\bscrollIntoView\b/ },
  { label: "new Blob", re: /\bnew\s+Blob\b/ },
  { label: "createObjectURL", re: /\bcreateObjectURL\b/ },
  { label: "FileReader", re: /\bFileReader\b/ },
  { label: "fetch(", re: /\bfetch\s*\(/ },
  { label: "XMLHttpRequest", re: /\bXMLHttpRequest\b/ },
];

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

/** glob 键 → 仓库相对路径 */
function rel(key: string): string {
  return key.replace(/^\.\.\/\.\.\//, "").replace(/\\/g, "/");
}

/** 该源码骨架是否出现平台 API，返回命中的符号名（无命中返回空数组） */
function platformHits(raw: string): string[] {
  const skeleton = stripToCodeSkeleton(raw);
  return PLATFORM_SYMBOLS.filter((s) => s.re.test(skeleton)).map(
    (s) => s.label,
  );
}

describe("编辑器内层平台边界（源级扫描）", () => {
  const layerFiles = Object.entries(LAYER_SOURCES);

  it("扫描面非空（glob 失配时立刻失败，不许空转通过）", () => {
    expect(layerFiles.length).toBeGreaterThanOrEqual(25);
    for (const dir of GUARDED_LAYERS) {
      expect(
        layerFiles.filter(([key]) => rel(key).startsWith(dir)).length,
        `${dir} 下没有扫到源码`,
      ).toBeGreaterThan(0);
    }
  });

  it("判据自证：合成源码能命中，注释与字符串里的不算，事件类型不算", () => {
    expect(platformHits("const a = document.body;")).toEqual(["document"]);
    expect(platformHits("localStorage.setItem(k, v);")).toEqual([
      "localStorage",
    ]);
    expect(platformHits("const r = el.getBoundingClientRect();")).toEqual([
      "getBoundingClientRect",
    ]);
    expect(platformHits("// document 只出现在注释里")).toEqual([]);
    expect(platformHits('const s = "document";')).toEqual([]);
    expect(
      platformHits("function onWheel(event: WheelEvent): void {}"),
    ).toEqual([]);
    expect(platformHits("const doc = documentId();")).toEqual([]);
  });

  it("契约/域/组合/共享四层：零平台 API（宿主能力一律经端口注入）", () => {
    const offenders = layerFiles
      .map(([key, raw]) => ({ path: rel(key), hits: platformHits(raw) }))
      .filter((entry) => entry.hits.length > 0)
      .map((entry) => `${entry.path}（${entry.hits.join(" / ")}）`);

    expect(
      offenders,
      `平台无关层出现平台触点（应收敛到 apps/editor/src/infra/ 或视图层）：${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("装配互锁：存储与下载的落点必须由组合根接入", () => {
    const main = WIRING_SOURCES["../../apps/editor/src/main.ts"] ?? "";
    const app = WIRING_SOURCES["../../apps/editor/src/App.vue"] ?? "";
    expect(main).not.toBe("");
    expect(app).not.toBe("");
    expect(stripToCodeSkeleton(main)).toContain("createBrowserStorage(");
    expect(stripToCodeSkeleton(main)).toContain("downloadJsonFile");
    expect(stripToCodeSkeleton(app)).toContain("KEY_VALUE_STORAGE_KEY");
  });

  it("平台取径有落点：存储适配器与下载适配器在 infra 层存在", () => {
    const infraKeys = Object.keys(INFRA_SOURCES).map((key) => rel(key));
    expect(infraKeys).toContain("apps/editor/src/infra/browser-storage.ts");
    expect(infraKeys).toContain("apps/editor/src/infra/download.ts");
  });
});
