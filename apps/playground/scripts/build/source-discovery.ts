import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { StoryBuildError } from "./errors";

/**
 * 发现该工程的唯一源（`<root>/<sourcesDir>/` 下恰好一个 `.ts`；一个工程 = 一个 Story = 一个源）。
 * 零源与多源都 fail-closed：文案用实际的源目录名，多源还列出文件名，便于定位。
 */
export function discoverSource(root: string, sourcesDir: string): string {
  const dir = join(root, sourcesDir);
  const sources = existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith(".ts"))
        .sort()
    : [];
  if (sources.length === 0) {
    throw new StoryBuildError(
      `${sourcesDir}/ 下没有 .ts 源——TS 源工程需要一个 default 导出多列 Story 的源文件`,
    );
  }
  if (sources.length > 1) {
    throw new StoryBuildError(
      `${sourcesDir}/ 下发现 ${sources.length} 个 .ts 源（${sources.join("、")}）——一个工程 = 一个 Story = 一个源文件；多故事形态未定义，如需支持请先确认`,
    );
  }
  return sources[0]!;
}
