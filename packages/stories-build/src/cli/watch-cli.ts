/**
 * TS 故事源增量监听 CLI（`pnpm stories:watch`，tsx 运行；创作期工具，Node 侧）：
 * 常驻进程入口——首轮全量构建，之后监听源目录递归变更，防抖合并后进程内重跑构建。
 *
 * 本文件是入口与呈现：监听实现在 `../pipeline/watch.ts`。失败轮不退出——
 * 创作期半成品是常态，修复后保存即重试。
 *
 * 用法：`pnpm stories:watch [工程根]`；缺省工程根 = 进程工作目录（或 DSH_STORIES_ROOT）。
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { watchStories } from "../pipeline/watch.ts";

// —— 主模块守卫：仅直接执行时常驻（tests 直测 watchStories / affectedStories）——
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const envRoot = process.env.DSH_STORIES_ROOT;
  const root = resolve(
    process.argv[2] ??
      (envRoot !== undefined && envRoot !== "" ? envRoot : process.cwd()),
  );
  const stop = await watchStories(root);
  process.on("SIGINT", () => {
    stop();
    process.exit(0);
  });
}
