/**
 * TS 故事源编译 CLI（`pnpm stories:build`，tsx 运行；创作期工具，Node 侧）：
 * `Stories.src/<name>.ts`（恰好一个；default 导出多列 Story，`satisfies Story` 提供编译期
 * 类型检查）→ 既有校验链 `parseStory`（带源名定位）→ `serializeProject`（单列拆分 +
 * 清单保真——与编辑器写回同一条布局规则）→ `assembleProject` 往返自检 → 差量写盘
 * `Resources/Stories/**` + `project.json`（陈旧列文件清理）。
 *
 * 本文件是**入口与呈现**：流水线在 `./build`（唯一出口），这里只做三件事——解析可选的
 * 位置参数工程根、跑一次编译、把 `BuildReport` 打印成人读的几段（完成行 / 零差量 /
 * 写入 / 清理陈旧 / 词汇层提示）。失败一律打到 stderr 并以退出码 1 结束，便于脚本链中断。
 *
 * 用法：`pnpm stories:build [工程根]`；缺省工程根 = 本脚本所在包根（`scripts/` 的上一级）。
 * 测试不经这里——它们直接调 `buildStories`（纯编排，fs 全在参数 root 之下）。
 */
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_SOURCES_DIR, StoryBuildError, buildStories } from "./build";

export { StoryBuildError, buildStories, type BuildReport } from "./build";

// —— 主模块守卫：仅直接执行时跑真实工程（tests 直测 buildStories 纯编排）——
// 可选位置参数 = 工程根（默认 = 脚本所在包根）
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root =
    process.argv[2] !== undefined
      ? resolve(process.argv[2])
      : fileURLToPath(new URL("..", import.meta.url));
  try {
    const report = await buildStories(root);
    console.log(
      `TS 故事源编译完成：${DEFAULT_SOURCES_DIR}/${report.source} → story "${report.storyId}"（${report.columns} 列）`,
    );
    if (report.written.length === 0 && report.removed.length === 0) {
      console.log("已是最新（零差量）");
    }
    if (report.written.length > 0) {
      console.log(
        `写入（${report.written.length}）：\n  ${report.written.join("\n  ")}`,
      );
    }
    if (report.removed.length > 0) {
      console.log(
        `清理陈旧（${report.removed.length}）：\n  ${report.removed.join("\n  ")}`,
      );
    }
    if (report.warnings.length > 0) {
      console.warn(
        `词汇层类型提示（${report.warnings.length} 条，不拦构建——引擎求值时将 type-error）：\n${report.warnings
          .map((w) => `  - ${w.expression}：${w.message}`)
          .join("\n")}`,
      );
    }
  } catch (error) {
    console.error(
      `[stories:build] 失败：${error instanceof StoryBuildError ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
