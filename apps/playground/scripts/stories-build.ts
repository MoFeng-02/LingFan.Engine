/**
 * T09-01 S2 · TS 故事源编译 CLI（`pnpm stories:build`，tsx 运行；创作期工具，Node 侧）：
 * `Stories.src/<name>.ts`（恰好一个；default 导出多列 Story，`satisfies Story` 提供编译期
 * 类型检查）→ 既有校验链 `parseStory`（带源名定位）→ `serializeProject`（单列拆分 +
 * 清单保真——与编辑器写回同一条布局规则）→ `assembleProject` 往返自检 → 差量写盘
 * `Resources/Stories/**` + `project.json`（陈旧列文件清理）。
 *
 * 零第二套规则：TS 源合法 ⇔ 其编译产物作为 JSON 合法（规约 07「TS 故事源」节）。
 * 工程清单（entry/defines/shell）不归 TS 源管——必须先有 `Resources/project.json`，
 * 编译只更新其托管键（serializeProject 既有语义）。`Stories/**` 列集由源全量管理：
 * 启用 TS 源的工程，手写列文件会被当作陈旧产物清理（报告逐条列出）。
 * 编辑器/引擎/Rust 对 TS 零感知；TS 源不进打包产物（运行期零攻击面）。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assembleProject,
  MANIFEST_FILE,
  parseStory,
  serializeProject,
  STORIES_DIR,
} from "@lingfan/engine";

export class StoryBuildError extends Error {}

export interface BuildReport {
  source: string;
  storyId: string;
  columns: number;
  written: string[];
  removed: string[];
}

/** 收集目录下全部文件（posix 相对路径 → 文本）；目录不存在 = 空集 */
function walkFiles(dir: string, rel = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const key = rel === "" ? name : `${rel}/${name}`;
    if (statSync(path).isDirectory()) {
      for (const [child, text] of walkFiles(path, key)) out.set(child, text);
    } else {
      out.set(key, readFileSync(path, "utf8"));
    }
  }
  return out;
}

/**
 * 编译 `root/Stories.src/` 下的 TS 源 → `root/Resources/`（纯编排，fs 全在参数 root 之下；
 * 测试用临时工程根直测，CLI 主守卫传真实根）。
 */
export async function buildStories(root: string): Promise<BuildReport> {
  const sourcesDir = join(root, "Stories.src");
  const resourcesDir = join(root, "Resources");
  const storiesDir = join(resourcesDir, STORIES_DIR);

  // —— 源：恰好一个 .ts（一个工程 = 一个 Story = 一个源；多故事工程形态未裁定）——
  const sources = existsSync(sourcesDir)
    ? readdirSync(sourcesDir).filter((name) => name.endsWith(".ts")).sort()
    : [];
  if (sources.length === 0) {
    throw new StoryBuildError(
      "Stories.src/ 下没有 .ts 源——TS 源工程需要一个 default 导出多列 Story 的源文件（参考规约 07「TS 故事源」）",
    );
  }
  if (sources.length > 1) {
    throw new StoryBuildError(
      `Stories.src/ 下发现 ${sources.length} 个 .ts 源（${sources.join("、")}）——一个工程 = 一个 Story = 一个源文件；多故事形态未定义，如需支持请先裁定`,
    );
  }
  const source = sources[0]!;

  // —— 校验链入口：parseStory 与 JSON 文件同一个函数（issues 自带源名定位）——
  const mod = (await import(pathToFileURL(join(sourcesDir, source)).href)) as {
    default?: unknown;
  };
  if (mod?.default === undefined) {
    throw new StoryBuildError(
      `${source}: 缺 default 导出（TS 源约定：default 导出多列 Story 值；\`satisfies Story\` 提供编译期类型检查）`,
    );
  }
  const story = parseStory(mod.default, `Stories.src/${source}`);

  // —— 工程清单：先有 project.json（defines/shell 是工程事实，不归 TS 源管）——
  const manifestPath = join(resourcesDir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    throw new StoryBuildError(
      `Resources/${MANIFEST_FILE} 不存在——工程清单（entry/defines/shell）不归 TS 源管，请先建工程清单`,
    );
  }
  const manifestText = readFileSync(manifestPath, "utf8");
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    throw new StoryBuildError(
      `Resources/${MANIFEST_FILE} 不是合法 JSON：${String(error)}`,
    );
  }

  // —— 编译：serializeProject = 编辑器写回同一条布局规则（单列拆分 + 清单托管键更新 + 非托管键保真）——
  const serialized = serializeProject(story, manifest);

  // —— 往返自检（编译期互锁）：产物重组回 story，再序列化必须逐字节幂等 ——
  const productManifestText = serialized.files.get(MANIFEST_FILE);
  if (productManifestText === undefined) {
    throw new StoryBuildError("编译产物缺 project.json（serializeProject 契约破坏）");
  }
  // assembleProject 的 files = 故事文件集（不含清单）；清单单独走 manifest 参数
  const columnFiles = new Map(serialized.files);
  columnFiles.delete(MANIFEST_FILE);
  const rebuilt = assembleProject(JSON.parse(productManifestText), columnFiles);
  const recheck = serializeProject(rebuilt, JSON.parse(productManifestText));
  for (const key of serialized.files.keys()) {
    if (recheck.files.get(key) !== serialized.files.get(key)) {
      throw new StoryBuildError(
        `编译往返自检失败（serialize → assemble → serialize 不幂等）：${key}`,
      );
    }
  }

  // —— 差量写盘：Stories/** 由源全量管理，不在产物集内的既有列文件 = 陈旧，删除 ——
  const existing = walkFiles(storiesDir);
  const written: string[] = [];
  const removed: string[] = [];
  for (const [rel, text] of serialized.files) {
    const target = join(resourcesDir, rel);
    if (existsSync(target) && readFileSync(target, "utf8") === text) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
    written.push(rel);
  }
  for (const rel of existing.keys()) {
    const logical = `${STORIES_DIR}/${rel}`;
    if (serialized.files.has(logical)) continue;
    rmSync(join(storiesDir, rel), { force: true });
    removed.push(logical);
  }

  return {
    source,
    storyId: story.id,
    columns: story.columns.length,
    written,
    removed,
  };
}

// —— 主模块守卫：仅直接执行时跑真实工程（tests 直测 buildStories 纯编排）——
// 可选位置参数 = 工程根（默认 = 本包根）；用法：`pnpm stories:build [工程根]`
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root =
    process.argv[2] !== undefined
      ? resolve(process.argv[2])
      : fileURLToPath(new URL("..", import.meta.url));
  try {
    const report = await buildStories(root);
    console.log(
      `TS 故事源编译完成：Stories.src/${report.source} → story "${report.storyId}"（${report.columns} 列）`,
    );
    if (report.written.length === 0 && report.removed.length === 0) {
      console.log("已是最新（零差量）");
    }
    if (report.written.length > 0) {
      console.log(`写入（${report.written.length}）：\n  ${report.written.join("\n  ")}`);
    }
    if (report.removed.length > 0) {
      console.log(`清理陈旧（${report.removed.length}）：\n  ${report.removed.join("\n  ")}`);
    }
  } catch (error) {
    console.error(
      `[stories:build] 失败：${error instanceof StoryBuildError ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
