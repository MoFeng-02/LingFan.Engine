/**
 * 覆盖层帧循环的**源级互锁**：rAF 只有一个持有者。
 *
 * 覆盖层是帧的宿主——打字插值与每帧回调都靠 rAF 推进。启停与取消必须成对出现在
 * 同一处：一旦分散到别的文件，就会出现「停帧后仍有帧在跑」或「取消错句柄」，
 * 这类缺陷只有真跑起动画才看得见。本测试用源码文本把约束钉住：除帧循环实现外，
 * 覆盖层其余文件不得直接触碰 rAF。
 *
 * 扫描面 = 覆盖层全目录（新增文件自动纳入）。
 */
import { describe, expect, it } from "vitest";

/** 覆盖层全部源码，键 = 仓库相对路径（前端不碰文件系统，改用打包器读取） */
const OVERLAY_SOURCES = import.meta.glob(
  "../../packages/ui/src/overlay/**/*.ts",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** 唯一允许触碰 rAF 的文件 */
const FRAME_LOOP_FILE = "frame-loop.ts";

/** 去注释（注释里提到 rAF 不算调用） */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'\w])\/\/.*$/gm, "$1");
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** 命中给定模式的文件名（先去注释） */
function filesCalling(pattern: RegExp): string[] {
  return Object.keys(OVERLAY_SOURCES)
    .sort()
    .filter((path) => pattern.test(stripComments(OVERLAY_SOURCES[path] ?? "")))
    .map(basename);
}

function frameLoopSource(): string {
  const entry = Object.entries(OVERLAY_SOURCES).find(([path]) =>
    path.endsWith(`/${FRAME_LOOP_FILE}`),
  );
  return stripComments(entry?.[1] ?? "");
}

describe("覆盖层帧循环 · 源级互锁（rAF 单一持有者）", () => {
  it("扫描面覆盖覆盖层全目录（非空且含帧循环实现，防假绿）", () => {
    const paths = Object.keys(OVERLAY_SOURCES);
    expect(paths.length).toBeGreaterThanOrEqual(12);
    expect(paths.map(basename)).toContain(FRAME_LOOP_FILE);
  });

  it("`requestAnimationFrame` 只出现在 frame-loop.ts", () => {
    expect(filesCalling(/requestAnimationFrame/)).toEqual([FRAME_LOOP_FILE]);
  });

  it("`cancelAnimationFrame` 只出现在 frame-loop.ts", () => {
    expect(filesCalling(/cancelAnimationFrame/)).toEqual([FRAME_LOOP_FILE]);
  });

  it("启停与取消都在帧循环内（三处启动 + 一处取消，语义未漂移）", () => {
    const source = frameLoopSource();
    expect(source).toContain("createFrameLoop");
    expect(source.match(/requestAnimationFrame/g) ?? []).toHaveLength(3);
    expect(source.match(/cancelAnimationFrame/g) ?? []).toHaveLength(1);
    // 取消必须作用在已排定的同一句柄上（不新建、不写死 0）
    expect(source).toMatch(/cancelAnimationFrame\(\s*rafId\s*\)/);
  });
});
