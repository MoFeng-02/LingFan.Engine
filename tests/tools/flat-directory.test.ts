/**
 * 平铺目录互锁（源级扫描，不跑构建）：包、应用与模板的作者源码目录要么只放两个以内的文件，
 * 要么按子职责分出子目录并给出唯一出口（`index.ts` / `index.vue`）。同族并列的分片
 * 若各占一个文件又没有出口，调用方只能逐文件深引，目录这一层边界就不存在了。
 *
 * 扫描面只取目录路径，不读文件内容——判据看的是目录形状，与文件体量无关。
 */
import { describe, expect, it } from "vitest";

const SOURCES = import.meta.glob(
  [
    "../../packages/*/src/**/*.{ts,vue}",
    "../../apps/*/src/**/*.{ts,vue}",
    // 模板是交付物，和包与应用一样是「要有人读的源码」：它的目录形状同样决定
    // 调用方是逐文件深引还是走一个出口。`.tsx` 单列——React 叠加层的组件就是它。
    "../../template/v1/**/*.{ts,tsx,vue}",
    // 故事源不是本仓的「模块/功能域」：它是作者手写的创作目录（每个子目录 = 一个章节，
    // 由 config.ts 的 folders 声明），自带 tsconfig、只归 stories-build 处理。往章节目录
    // 塞 index.ts 还会被故事发现当成一个新故事列，故不纳入平铺判据。
    "!../../apps/*/src/Stories.src/**",
    "!../../template/v1/__PROJECT__/src/Stories.src/**",
  ],
  { eager: false },
);

/**
 * 待完成白名单：目录 → 待办项（完成后逐项删除，清空即本判据达标）。
 *
 * 模板叠加层是生成器的**事实素材**而不是本仓的模块：每个层目录是「一层覆盖」的完整
 * 文件集，`vue` / `react` 的 `src/` 是「组合根 + 视图 + 挂载层组件」三件并列，`miniprogram`
 * 的 `src/components/` 是按页面区块切分的并列组件——它们的目录形状由生成器与各框架的
 * 惯例决定，不归本仓的模块边界管。骨架 `__PROJECT__/src/` 不在白名单里：那是交付给
 * 使用者的起点，必须自己先达标。
 */
const PENDING: Record<string, string> = {
  "template/v1/overlays/vue/src":
    "框架层的组合根、视图与挂载层组件三件并列，形状由生成器决定",
  "template/v1/overlays/react/src":
    "框架层的组合根、视图与挂载层组件三件并列，形状由生成器决定",
  "template/v1/overlays/miniprogram/src/components":
    "小程序页面区块的并列组件，形状由视图分层决定",
};

const IGNORED_SEGMENTS = new Set(["node_modules", "dist", "gen"]);

/** glob 键（相对本文件）转仓库相对路径 */
function repoPath(key: string): string {
  return key.replace(/^(\.\.\/)+/, "");
}

/** 目录 → 该目录下的作者源码文件名 */
function authorDirs(
  keys: readonly string[] = Object.keys(SOURCES),
): Map<string, string[]> {
  const dirs = new Map<string, string[]>();
  for (const key of keys) {
    const path = repoPath(key);
    if (/\.d\.ts$/.test(path)) continue;
    const segments = path.split("/");
    if (segments.some((segment) => IGNORED_SEGMENTS.has(segment))) continue;
    const dir = segments.slice(0, -1).join("/");
    dirs.set(dir, [...(dirs.get(dir) ?? []), segments[segments.length - 1]]);
  }
  return dirs;
}

/** 平铺目录：≥3 个源文件且没有唯一出口 */
function flatDirs(dirs: Map<string, string[]>): string[] {
  const flat: string[] = [];
  for (const [dir, files] of dirs) {
    if (files.length < 3) continue;
    if (files.includes("index.ts") || files.includes("index.vue")) continue;
    flat.push(dir);
  }
  return flat.sort();
}

describe("平铺目录（源级扫描）", () => {
  const dirs = authorDirs();

  it("扫描面自检：命中包与应用源码目录（glob 失配时立刻失败）", () => {
    const files = [...dirs.values()].reduce(
      (sum, group) => sum + group.length,
      0,
    );
    expect(files).toBeGreaterThanOrEqual(500);
    for (const known of [
      "packages/core/src/data/format/validate",
      "packages/stories-build/src/compiler/story-compiler/translate/stmt",
      "apps/playground/src/host/panels",
      "template/v1/__PROJECT__/src/host/mount",
      "template/v1/overlays/react/src",
    ]) {
      expect([...dirs.keys()], `扫描面缺 ${known}`).toContain(known);
    }
  });

  it("判据自检：无出口的 ≥3 文件目录判红，有出口或不足 3 文件判绿", () => {
    const sample = authorDirs([
      "../../packages/x/src/a.ts",
      "../../packages/x/src/b.ts",
      "../../packages/x/src/c.ts",
      "../../packages/x/src/sub/a.ts",
      "../../packages/x/src/sub/b.ts",
      "../../packages/x/src/sub/c.ts",
      "../../packages/x/src/sub/index.ts",
      "../../packages/x/src/pair/a.ts",
      "../../packages/x/src/pair/b.ts",
      "../../packages/x/src/ignored/gen/a.ts",
      "../../packages/x/src/ignored/gen/b.ts",
      "../../packages/x/src/ignored/gen/c.ts",
    ]);
    expect(flatDirs(sample)).toEqual(["packages/x/src"]);
  });

  it("每个目录都有唯一出口（白名单外不得平铺）", () => {
    const offenders = flatDirs(dirs).map(
      (dir) => `${dir} —— ${PENDING[dir] ?? "未完成"}`,
    );
    expect(offenders, "平铺目录（应补 index.ts 或按子职责分子目录）").toEqual(
      Object.keys(PENDING)
        .sort()
        .map((dir) => `${dir} —— ${PENDING[dir]}`),
    );
  });
});
