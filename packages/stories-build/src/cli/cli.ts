/**
 * TS 故事源编译 CLI（`pnpm stories:build`，tsx 运行；创作期工具，Node 侧）：
 * `Stories.src/config.ts`（布局声明：folders 多目录 + start 入口故事，全局恰一）→
 * 源发现（default 具名故事函数 = 故事文件，仅具名导出 = 模块，覆盖外 default = 报错）→
 * story-compiler（`compileStories` 契约，诊断非空 fail-closed）→ `serializeProject`
 * （单列拆分 + 清单托管键更新——与编辑器写回同一条布局规则；`config.start` →
 * `project.json` entry）→ `assembleProject` 往返自检 → 差量写盘
 * `Resources/Stories/**` + `project.json`（陈旧列文件清理；产物路径 = 源文件路径镜像）。
 *
 * 本文件是**入口与呈现**：流水线在 `./index`（唯一出口），这里只做三件事——解析可选的
 * 位置参数工程根、跑一次编译、把 `BuildReport` 打印成人读的几段（完成行 / 零差量 /
 * 新增 / 更新 / 清理陈旧 / 词汇层提示）。失败一律打到 stderr 并以退出码 1 结束，
 * 便于脚本链中断。
 *
 * 用法：`pnpm stories:build [工程根]`；缺省工程根 = 进程工作目录（调用方脚本已 cd 到
 * 宿主工程根，或经 DSH_STORIES_ROOT 指明——包内没有「谁在调我、宿主工程在哪」这件事实）。
 * 测试不经这里——它们直接调 `buildStories`（纯编排，fs 全在参数 root 之下）。
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_SOURCES_DIR, StoryBuildError, buildStories } from "../index";

export { StoryBuildError, buildStories, type BuildReport } from "../index";

// —— 主模块守卫：仅直接执行时跑真实工程（tests 直测 buildStories 纯编排）——
// 可选位置参数 = 工程根（默认 = 工作目录，可由 DSH_STORIES_ROOT 覆盖）
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const envRoot = process.env.DSH_STORIES_ROOT;
  const root = resolve(
    process.argv[2] ??
      (envRoot !== undefined && envRoot !== "" ? envRoot : process.cwd()),
  );
  try {
    const report = await buildStories(root);
    console.log(
      `TS 故事源编译完成：${DEFAULT_SOURCES_DIR}/${report.source} → story "${report.storyId}"（${report.columns} 列）`,
    );
    if (
      report.added.length === 0 &&
      report.updated.length === 0 &&
      report.removed.length === 0
    ) {
      console.log("已是最新（零差量）");
    }
    if (report.added.length > 0) {
      console.log(
        `新增（${report.added.length}）：\n  ${report.added.join("\n  ")}`,
      );
    }
    if (report.updated.length > 0) {
      console.log(
        `更新（${report.updated.length}）：\n  ${report.updated.join("\n  ")}`,
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
