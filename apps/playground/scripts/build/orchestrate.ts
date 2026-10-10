import { join } from "node:path";
import { parseStory, STORIES_DIR } from "@lingfan/engine";
import { assertKnownGuards, assertKnownOps } from "./gates";
import { scanCellSources } from "./cell-scan";
import { assertRoundTrip, compileStory } from "./compile-roundtrip";
import { emitArtifacts } from "./emit";
import { loadExtensions } from "./extension-load";
import { applyLayout, loadLayoutDeclaration } from "./layout-declaration";
import { readManifest } from "./manifest-read";
import { drainBuildWarnings, type BuildReport } from "./report";
import { discoverSource } from "./source-discovery";
import { walkFiles } from "./walk-files";

/** 构建产物的目录名与生成物文件名（默认值 = 参考宿主的现状目录名） */
export const DEFAULT_SOURCES_DIR = "Stories.src";
/** 资源目录名（相对工程根）：清单与 `Stories/**` 产物落在这下面。 */
export const DEFAULT_RESOURCES_DIR = "Resources";
/** 生成物目录名（相对源目录）：`fun_register.g.ts` 落在这里。 */
export const DEFAULT_GENERATED_DIR = "gen";

/**
 * 构建的可配置项：只列目录名这类工程布局事实（把同一工程挪到别的目录名只改这里）。
 * 整项缺省 = 现状布局；这些名字同时进失败文案，故改值即改文案，默认下逐字不变。
 */
export interface StoryBuildOptions {
  /** 源目录名（相对工程根） */
  readonly sourcesDir?: string;
  /** 资源目录名（相对工程根；清单与 `Stories/**` 都住在它下面） */
  readonly resourcesDir?: string;
  /** 生成物目录名（相对源目录；`fun_register.g.ts` 落在这里） */
  readonly generatedDir?: string;
}

/** 生成物文件名（唯一一份；报告里的逻辑路径由它和源/生成物目录名拼出） */
const GENERATED_FILE = "fun_register.g.ts";

/**
 * 编译 `root/Stories.src/` 下的 TS 源 → `root/Resources/`（纯编排，fs 全在参数 root 之下；
 * 测试用临时工程根直测，CLI 主守卫传真实根）。
 *
 * 十二段串行：源发现 → cell 扫描 → 布局声明 → parse → 布局回填 → 清单读取 → 扩展装载
 * → op 闸门 → 守卫闸门 → 编译与往返自检 → 差量写盘 → 生成物与警告收集。
 * 交错的顺序本身即契约（前置段的失败文案要先于后置段发出），调整即改变可观测行为。
 */
export async function buildStories(
  root: string,
  options: StoryBuildOptions = {},
): Promise<BuildReport> {
  const sourcesDirName = options.sourcesDir ?? DEFAULT_SOURCES_DIR;
  const resourcesDirName = options.resourcesDir ?? DEFAULT_RESOURCES_DIR;
  const generatedDirName = options.generatedDir ?? DEFAULT_GENERATED_DIR;

  const sourcesDir = join(root, sourcesDirName);
  const resourcesDir = join(root, resourcesDirName);
  const storiesDir = join(resourcesDir, STORIES_DIR);

  // —— 源：恰好一个 .ts（一个工程 = 一个 Story = 一个源；多故事工程形态未支持）——
  const source = discoverSource(root, sourcesDirName);

  // —— cell 声明扫描（构建期 AST 扫描）：源树（排除生成物目录，仅 .ts）——
  const cellScan = scanCellSources(
    walkFiles(sourcesDir),
    generatedDirName,
  );

  // —— 布局声明（构建期配置）与源模块导入 ——
  const { mod, layout } = await loadLayoutDeclaration(sourcesDir, source);

  // —— 校验链入口：parseStory 与 JSON 文件同一个函数（issues 自带源名定位）——
  const story = parseStory(mod.default, `${sourcesDirName}/${source}`);
  applyLayout(story, layout);

  // —— 工程清单：先有 project.json（defines/shell 是工程事实，不归 TS 源管）——
  const manifest = readManifest(root, resourcesDirName);

  // —— 扩展声明装载（对齐运行期声明制：同一份 manifest.extensions、同一个装载契约）——
  const { declared, opNames } = await loadExtensions(root, manifest);

  const gateOptions = {
    resourcesDir: resourcesDirName,
    sourcesDir: sourcesDirName,
  };
  // —— op 闸门与守卫名闸门（两条 fail-early 判定，各自带定位一次报全部）——
  assertKnownOps(story, opNames, gateOptions);
  assertKnownGuards(
    story,
    new Set(cellScan.guards.map((guard) => guard.name)),
    gateOptions,
  );

  // —— 编译与往返自检 ——
  const serialized = compileStory(story, manifest);
  assertRoundTrip(serialized);

  // —— 差量写盘 + 生成物（逻辑路径，相对资源根）——
  const { written, removed } = emitArtifacts({
    root,
    resourcesDir,
    storiesDir,
    generatedRel: `${sourcesDirName}/${generatedDirName}/${GENERATED_FILE}`,
    serialized,
    cellScan,
  });

  return {
    source,
    storyId: story.id,
    columns: story.columns.length,
    written,
    removed,
    extensions: declared,
    functions: cellScan.guards.map((guard) => guard.name),
    warnings: drainBuildWarnings(),
  };
}
