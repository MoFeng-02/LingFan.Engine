/**
 * 覆盖层帧循环的**源级互锁**：rAF 只有一个持有者，且它在 DOM 层。
 *
 * 帧是覆盖层的驱动源——打字插值与每帧回调都靠它推进。覆盖层自身**中立化**：
 * `overlay/frame-loop.ts` 只经注入的 `FrameSource` 排帧（`frame.request`
 * / `frame.cancel`），真正触碰窗口 rAF 的实现落在 `src/dom/overlay-surface.ts`
 * —— ui 包内**唯一**允许 DOM 的目录。
 *
 * 两条互锁：
 * 1. `overlay/**` 零 rAF 命中：中立面不得直接碰平台帧 API（否则小程序等宿主没法换）；
 * 2. 整个 `packages/ui/src/**` 里 rAF 只出现在 `src/dom/overlay-surface.ts`，
 *    且排帧/取消各一处、取消作用在已排定的同一句柄上。
 *
 * 这类缺陷（停帧后仍有帧在跑、取消错句柄）只有真跑起动画才看得见，故用源文本钉住。
 */
import { describe, expect, it } from "vitest";

/** 覆盖层全部源码（中立面），键 = 打包器给的相对路径 */
const OVERLAY_SOURCES = import.meta.glob(
  "../../packages/ui/src/overlay/**/*.ts",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** ui 包全部源码：用于「rAF 只有一个持有者」的全包断言 */
const UI_SOURCES = import.meta.glob("../../packages/ui/src/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** 中立帧循环（只经注入的帧源排帧） */
const FRAME_LOOP_FILE = "packages/ui/src/overlay/frame-loop.ts";
/** DOM 层帧源实现（唯一允许触碰 rAF 的文件） */
const FRAME_SOURCE_FILE = "packages/ui/src/dom/overlay-surface.ts";

/** 平台帧 API 判据 */
const RAF = /requestAnimationFrame|cancelAnimationFrame/;

/** 去注释（注释里提到 rAF 不算调用） */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'\w])\/\/.*$/gm, "$1");
}

/** glob 键 → 仓库相对路径（与 package 内位置无关的稳定标识） */
function rel(path: string): string {
  return path.replace(/^\.\.\/\.\.\//, "").replace(/\\/g, "/");
}

/** 命中给定模式的文件（仓库相对路径，已去注释） */
function filesCalling(
  sources: Record<string, string>,
  pattern: RegExp,
): string[] {
  return Object.keys(sources)
    .sort()
    .filter((path) => pattern.test(stripComments(sources[path] ?? "")))
    .map(rel);
}

function sourceOf(sources: Record<string, string>, path: string): string {
  return stripComments(sources[`../../${path}`] ?? "");
}

describe("覆盖层帧循环 · 源级互锁（rAF 单一持有者）", () => {
  it("扫描面覆盖覆盖层全目录（非空且含帧循环实现，防假绿）", () => {
    const paths = Object.keys(OVERLAY_SOURCES);
    expect(paths.length).toBeGreaterThanOrEqual(11);
    expect(paths.map(rel)).toContain(FRAME_LOOP_FILE);
  });

  it("覆盖层中立：`overlay/**` 不直接触碰平台帧 API", () => {
    expect(filesCalling(OVERLAY_SOURCES, RAF)).toEqual([]);
  });

  it("rAF 只出现在 DOM 层实现里", () => {
    expect(filesCalling(UI_SOURCES, RAF)).toEqual([FRAME_SOURCE_FILE]);
  });

  it("排帧与取消各一处，取消作用在已排定的句柄上", () => {
    const source = sourceOf(UI_SOURCES, FRAME_SOURCE_FILE);
    expect(source.match(/requestAnimationFrame\(/g) ?? []).toHaveLength(1);
    expect(source.match(/cancelAnimationFrame\(/g) ?? []).toHaveLength(1);
    expect(source).toMatch(/cancelAnimationFrame\(\s*handle\s*\)/);
  });

  it("启停都在帧循环内（三处排帧 + 一处取消，语义未漂移）", () => {
    const source = sourceOf(OVERLAY_SOURCES, FRAME_LOOP_FILE);
    expect(source).toContain("createFrameLoop");
    // 启动 / 续帧 / 恢复各一处：排帧只能经注入的帧源
    expect(source.match(/deps\.frame\.request\(/g) ?? []).toHaveLength(3);
    // 取消只有一处，且复用已排定的句柄（不新建、不写死 0）
    expect(source.match(/deps\.frame\.cancel\(/g) ?? []).toHaveLength(1);
    expect(source).toMatch(/deps\.frame\.cancel\(\s*rafId\s*\)/);
  });
});
