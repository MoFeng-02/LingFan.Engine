import { MANIFEST_FILE, STORIES_DIR } from "@lingfan/engine";

/**
 * TS 源工程只读守卫：启用 `Stories.src/` 的工程，其 JSON 产物（`Stories/**` 与
 * `project.json`）由构建管线全量管理（`pnpm stories:build`），编辑器不得写回。
 *
 * 判据 = 清单标记键（非托管键，`serializeProject` 原位保留）：构建编排写入
 * `tsSource: true`，编辑器只读不动——浏览侧 FSA 取径拿不到 `Stories.src/` 的
 * 探测能力（资源根外无父句柄），清单标记是两侧唯一的通信通道。
 */

/** 清单标记键（构建写入 / 编辑器读取；非托管键跨 `serializeProject` 保真） */
export const TS_SOURCE_MANIFEST_KEY = "tsSource";

/** TS 源工程的统一拒绝文案（编辑器三个写回入口共用） */
export const TS_SOURCE_READONLY_HINT =
  "TS 源工程（Stories.src/）的产物归构建管线管理——请改 .ts 源后运行 pnpm stories:build，编辑器不写回 Stories/** 与 project.json";

/** 工程清单是否标记为 TS 源工程 */
export function isTsSourceProject(manifest: unknown): boolean {
  return (
    typeof manifest === "object" &&
    manifest !== null &&
    (manifest as Record<string, unknown>)[TS_SOURCE_MANIFEST_KEY] === true
  );
}

/** 在候选写回路径里挑出 TS 源工程禁写项（`Stories/**` 与清单；空数组 = 全部可写） */
export function tsSourceWriteBlockers(paths: readonly string[]): string[] {
  return paths.filter(
    (path) => path === MANIFEST_FILE || path.startsWith(`${STORIES_DIR}/`),
  );
}

/** fail-closed：TS 源工程下命中禁写路径即抛（含操作指引） */
export function assertTsSourceWritable(paths: readonly string[]): void {
  const blocked = tsSourceWriteBlockers(paths);
  if (blocked.length === 0) return;
  throw new Error(`${TS_SOURCE_READONLY_HINT}（命中：${blocked.join("、")}）`);
}
