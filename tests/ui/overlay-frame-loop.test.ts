/**
 * 共享帧循环的**源级互锁**：包内只有一个实现，且 rAF 只有一个持有者。
 *
 * 帧是打字插值与每帧回调的驱动源。循环本身**中立化**：它只经注入的 `FrameSource`
 * 排帧（`frame.request` / `frame.cancel`），真正触碰窗口 rAF 的实现落在
 * `src/dom/overlay-surface.ts` —— ui 包内**唯一**允许 DOM 的目录。
 *
 * 三条互锁：
 * 1. 实现唯一：`export function createFrameLoop` 只允许出现在 `src/host/frame-loop.ts`
 *    （覆盖层与各宿主的 `startHostFrameLoop` 都建在同一份实现上，不再各写一套）；
 * 2. `overlay/**` 零 rAF 命中：中立面不得直接碰平台帧 API（否则小程序等宿主没法换）；
 * 3. 整个 `packages/ui/src/**` 里 rAF 只出现在 `src/dom/overlay-surface.ts`，
 *    且排帧/取消各一处、取消作用在已排定的同一句柄上。
 *
 * 这类缺陷（停帧后仍有帧在跑、取消错句柄、两套循环各暂停一半）只有真跑起动画才看得见，
 * 故用源文本钉住。
 */
import { describe, expect, it } from "vitest";

/** 覆盖层全部源码（中立面），键 = 打包器给的相对路径 */
const OVERLAY_SOURCES = import.meta.glob(
  "../../packages/ui/src/overlay/**/*.ts",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** ui 包全部源码：用于「实现唯一」与「rAF 只有一个持有者」的全包断言 */
const UI_SOURCES = import.meta.glob("../../packages/ui/src/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** 唯一的帧循环实现 */
const FRAME_LOOP_FILE = "packages/ui/src/host/frame-loop.ts";
/** 覆盖层的装配器（用来确认扫描面覆盖到了覆盖层目录） */
const OVERLAY_ENTRY_FILE = "packages/ui/src/overlay/create.ts";
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
function filesMatching(
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

describe("共享帧循环 · 源级互锁", () => {
  it("扫描面覆盖覆盖层全目录（非空且含装配器，防假绿）", () => {
    const paths = Object.keys(OVERLAY_SOURCES);
    expect(paths.length).toBeGreaterThanOrEqual(10);
    expect(paths.map(rel)).toContain(OVERLAY_ENTRY_FILE);
  });

  it("实现唯一：全包只有一处 `createFrameLoop` 定义", () => {
    expect(
      filesMatching(UI_SOURCES, /export function createFrameLoop/),
    ).toEqual([FRAME_LOOP_FILE]);
  });

  it("覆盖层中立：`overlay/**` 不直接触碰平台帧 API", () => {
    expect(filesMatching(OVERLAY_SOURCES, RAF)).toEqual([]);
  });

  it("rAF 只出现在 DOM 层实现里", () => {
    expect(filesMatching(UI_SOURCES, RAF)).toEqual([FRAME_SOURCE_FILE]);
  });

  it("排帧与取消各一处，取消作用在已排定的句柄上", () => {
    const source = sourceOf(UI_SOURCES, FRAME_SOURCE_FILE);
    expect(source.match(/requestAnimationFrame\(/g) ?? []).toHaveLength(1);
    expect(source.match(/cancelAnimationFrame\(/g) ?? []).toHaveLength(1);
    expect(source).toMatch(/cancelAnimationFrame\(\s*handle\s*\)/);
  });

  it("启停都在帧循环内（三处排帧 + 一处取消，语义未漂移）", () => {
    const source = sourceOf(UI_SOURCES, FRAME_LOOP_FILE);
    expect(source).toContain("createFrameLoop");
    // 启动 / 续帧 / 恢复各一处：排帧只能经注入的帧源
    expect(source.match(/options\.frame\.request\(/g) ?? []).toHaveLength(3);
    // 取消只有一处，且复用已排定的句柄（不新建、不写死 0）
    expect(source.match(/options\.frame\.cancel\(/g) ?? []).toHaveLength(1);
    expect(source).toMatch(/options\.frame\.cancel\(\s*handle\s*\)/);
  });
});
