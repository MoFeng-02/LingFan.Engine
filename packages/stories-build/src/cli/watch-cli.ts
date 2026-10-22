/**
 * TS 故事源增量监听 CLI（`pnpm stories:watch`，tsx 运行；创作期工具，Node 侧）：
 * 常驻进程入口——首轮全量构建，之后监听源目录递归变更，防抖合并后进程内重跑构建。
 *
 * 本文件是入口与呈现：监听实现在 `../pipeline/watch.ts`。失败轮不退出——
 * 创作期半成品是常态，修复后保存即重试。
 *
 * 与 `./cli.ts` 同一套两路触发：仓内 `pnpm stories:watch` 经主模块守卫直接跑本文件；
 * 装了本包的工程经 `bin` 里 `.mjs` 垫片用 tsx 装载本文件后调 `startWatchCli`。
 *
 * 用法：`<工程根可省略>`；缺省工程根 = 进程工作目录（或 DSH_STORIES_ROOT）。
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { watchStories } from "../pipeline/watch.ts";

/** 工程根：位置参数优先，其次 `DSH_STORIES_ROOT`，最后进程工作目录 */
export function resolveWatchRoot(argv: readonly string[]): string {
  const envRoot = process.env.DSH_STORIES_ROOT;
  return resolve(
    argv[0] ??
      (envRoot !== undefined && envRoot !== "" ? envRoot : process.cwd()),
  );
}

/** 起常驻监听并绑定 SIGINT 优雅退出；返回 `watchStories` 给的停止函数 */
export async function startWatchCli(
  argv: readonly string[] = process.argv.slice(2),
): Promise<() => void> {
  const root = resolveWatchRoot(argv);
  const stop = await watchStories(root);
  process.on("SIGINT", () => {
    stop();
    process.exit(0);
  });
  return stop;
}

// —— 主模块守卫：仅直接执行时常驻（tests 直测 watchStories / affectedStories）——
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await startWatchCli();
}
