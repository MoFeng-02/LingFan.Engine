import { join } from "node:path";
import { STORIES_DIR, type Story, type StoryColumn } from "@lingfan/engine";
import { TS_SOURCE_MANIFEST_KEY } from "@lingfan/editor";
import { assertKnownGuards, assertKnownOps } from "./gates";
import { scanCellSources } from "./cell-scan";
import { runConstEvalPass } from "./const-eval-pass";
import { assertRoundTrip, compileStory } from "./compile-roundtrip";
import {
  loadDefaultCompiler,
  type CompiledStoryEntry,
  type StoriesCompiler,
} from "./compiler-contract";
import { emitArtifacts } from "./emit";
import { StoryBuildError } from "./errors";
import { loadExtensions } from "./extension-load";
import { readManifest } from "./manifest-read";
import { drainBuildWarnings, type BuildReport } from "./report";
import { runStateSchemaPass, STATE_SCHEMA_REL } from "./state-schema";
import { discoverSources } from "./source-discovery";
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
  /** 编译器注入（过渡期/测试用）；缺省 = 装载 `./story-compiler` 默认实现 */
  readonly compiler?: StoriesCompiler;
}

/** 生成物文件名（唯一一份；报告里的逻辑路径由它和源/生成物目录名拼出） */
const GENERATED_FILE = "fun_register.g.ts";

/**
 * 编译 `root/Stories.src/` 下的 TS 源 → `root/Resources/`（纯编排，fs 全在参数 root 之下；
 * 测试用临时工程根直测，CLI 主守卫传真实根）。
 *
 * 十三段串行：源发现（config 布局声明 + folders 多目录 + start 全局恰一）→ cell 扫描
 * → 编译期求值（对应章节：node_modules 值导入的模块整体求值，导出常量喂给编译器内联）
 * 与 state schema 降维（C12：lib/state.ts 的 stateSchema 求值并扁平化为 defines）
 * → story-compiler 编译（诊断非空 fail-closed）→ parseStory 校验兜底 → 列归一与
 * sourcePath 回填（源文件路径 = 产物路径）→ 工程合并（id/entry 取 start 故事，
 * defines 冲突 fail-closed）→ 清单读取 → 扩展装载 → op/守卫闸门 → 编译与往返自检
 * → 差量写盘 → 生成物与警告收集。交错的顺序本身即契约（前置段的失败文案要先于
 * 后置段发出），调整即改变可观测行为。
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

  // —— 源发现：config.ts 布局声明 → folders 多目录递归 → start 全局恰一 ——
  const discovery = await discoverSources(root, sourcesDirName);

  // —— cell 声明扫描（构建期 AST 扫描）：源树（排除生成物目录，仅 .ts；机制不动）——
  const cellScan = scanCellSources(
    walkFiles(sourcesDir),
    generatedDirName,
  );

  // —— 编译期求值（对应章节）：含 node_modules 值导入的文件整体求值，导出常量值喂给
  // 编译器内联；求值诊断与 E13 确定性闸门 fail-closed，一次报全部 ——
  const constValues = await runConstEvalPass(
    sourcesDir,
    discovery.stories,
    discovery.modules,
    sourcesDirName,
  );

  // —— state schema 降维（C12）：约定 lib/state.ts 的 stateSchema 求值并扁平化为
  // defines；求值/形态诊断 fail-closed，无该文件 = 无 schema 贡献 ——
  const schemaDefines = await runStateSchemaPass(sourcesDir, sourcesDirName);

  // —— story-compiler：故事/模块清单一次性编译（诊断非空 = fail-closed，一次报全部）——
  const compiler = options.compiler ?? (await loadDefaultCompiler());
  const compiled = await compiler.compileStories({
    root,
    sourcesDir,
    stories: discovery.stories,
    modules: discovery.modules,
    constValues,
  });
  if (compiled.diags.length > 0) {
    throw new StoryBuildError(
      `故事编译失败（${compiled.diags.length} 条）：\n${compiled.diags
        .map((diag) => `- ${diag.file}:${diag.line}:${diag.col} ${diag.message}`)
        .join("\n")}`,
    );
  }

  // —— 列归一：产物路径 = 源文件路径（`Stories/<相对源路径去扩展名>.json`；
  // 文件名与列 id 解耦）。parseStory 不在链上（界面规范 对应章节③）：编译器静态产出 Story
  // 同形，形状契约由防御读取 + serialize/assemble 既有校验兜底。——
  const bySource = new Map<string, { story: Story; columns: StoryColumn[] }>();
  for (const entry of compiled.stories) {
    const { story, column } = readCompiledEntry(entry, sourcesDirName);
    const group = bySource.get(entry.sourceRelPath);
    if (group === undefined) {
      bySource.set(entry.sourceRelPath, { story, columns: [column] });
    } else {
      group.columns.push(column);
    }
  }

  // —— 工程级合并：id/entry 取 start 故事；defines 跨文件冲突 fail-closed ——
  const startGroup = bySource.get(discovery.startSource);
  if (startGroup === undefined) {
    throw new StoryBuildError(
      `${sourcesDirName}/${discovery.startSource}: 入口故事未产出任何列（compileStories 契约破坏）`,
    );
  }
  const merged = startGroup.story;
  merged.columns = [...bySource.values()].flatMap((group) => group.columns);
  merged.defines = mergeDefines(bySource, sourcesDirName, schemaDefines);

  // —— 工程清单：先有 project.json（defines/shell 是工程事实，不归 TS 源管）——
  // 标记键 `tsSource`（非托管键，serializeProject 原位保留）：编辑器据此对
  // `Stories/**` 与 `project.json` 只读（守卫判据，构建写入、编辑器不碰）。
  const manifest = readManifest(root, resourcesDirName);
  const markedManifest = {
    ...(typeof manifest === "object" && manifest !== null ? manifest : {}),
    [TS_SOURCE_MANIFEST_KEY]: true,
  };

  // —— 扩展声明装载（对齐运行期声明制：同一份 manifest.extensions、同一个装载契约）——
  const { declared, opNames } = await loadExtensions(root, manifest);

  const gateOptions = {
    resourcesDir: resourcesDirName,
    sourcesDir: sourcesDirName,
  };
  // —— op 闸门与守卫名闸门（两条 fail-early 判定，各自带定位一次报全部）——
  assertKnownOps(merged, opNames, gateOptions);
  assertKnownGuards(
    merged,
    new Set(cellScan.guards.map((guard) => guard.name)),
    gateOptions,
  );

  // —— 编译与往返自检（config.start → project.json entry 由托管键更新落地）——
  const serialized = compileStory(merged, markedManifest);
  assertRoundTrip(serialized);

  // —— 差量写盘 + 生成物（逻辑路径，相对资源根）——
  const { added, updated, removed } = emitArtifacts({
    root,
    resourcesDir,
    storiesDir,
    generatedRel: `${sourcesDirName}/${generatedDirName}/${GENERATED_FILE}`,
    serialized,
    cellScan,
  });

  return {
    source: discovery.startSource,
    storyId: merged.id,
    columns: merged.columns.length,
    added,
    updated,
    removed,
    extensions: declared,
    functions: cellScan.guards.map((guard) => guard.name),
    warnings: drainBuildWarnings(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 编译条目防御读取：取条目列（columnId 必须在产物列集中）、回填产物 sourcePath、
 * 复核 story 骨架（columns 列集 + id/entry 字符串）。更深的合法性（列 id 安全段、
 * 重复、entry 存在性等）交给 serializeProject/assembleProject 既有校验兜底。
 */
function readCompiledEntry(
  entry: CompiledStoryEntry,
  sourcesDirName: string,
): { story: Story; column: StoryColumn } {
  const sourceLabel = `${sourcesDirName}/${entry.sourceRelPath}`;
  if (!isRecord(entry.story) || !Array.isArray(entry.story.columns)) {
    throw new StoryBuildError(
      `${sourceLabel}: 编译器条目 story 缺少列集（compileStories 契约破坏）`,
    );
  }
  const column = entry.story.columns.find(
    (item) => isRecord(item) && item.id === entry.columnId,
  );
  if (column === undefined) {
    throw new StoryBuildError(
      `${sourceLabel}: 编译器条目 columnId "${entry.columnId}" 不在产物列集中（compileStories 契约破坏）`,
    );
  }
  if (typeof entry.story.id !== "string" || entry.story.id === "" || typeof entry.story.entry !== "string" || entry.story.entry === "") {
    throw new StoryBuildError(
      `${sourceLabel}: 编译器条目 story 缺少 id/entry（compileStories 契约破坏）`,
    );
  }
  const story = entry.story as unknown as Story;
  const typedColumn = column as unknown as StoryColumn;
  typedColumn.sourcePath = `${STORIES_DIR}/${entry.sourceRelPath.replace(/\.ts$/, ".json")}`;
  return { story, column: typedColumn };
}

/**
 * 跨来源的 defines 合并：同键同值收敛，同键异值 = 冲突 fail-closed（一次报全部）。
 * 来源 = state schema（C12，schema 先行）+ 各故事文件；schema 与故事同键异值同样冲突。
 */
function mergeDefines(
  bySource: ReadonlyMap<string, { story: Story; columns: StoryColumn[] }>,
  sourcesDirName: string,
  schemaDefines: Record<string, unknown> = {},
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const conflicts: string[] = [];
  const put = (key: string, value: unknown, source: string): void => {
    if (key in merged && merged[key] !== value) {
      conflicts.push(
        `- defines["${key}"] 在 ${sourcesDirName}/${source} 与先前的声明不一致（${JSON.stringify(merged[key])} ≠ ${JSON.stringify(value)}）`,
      );
      return;
    }
    merged[key] = value;
  };
  for (const [key, value] of Object.entries(schemaDefines)) {
    put(key, value, `${STATE_SCHEMA_REL}（stateSchema）`);
  }
  for (const [source, { story }] of bySource) {
    for (const [key, value] of Object.entries(story.defines ?? {})) {
      put(key, value, source);
    }
  }
  if (conflicts.length > 0) {
    throw new StoryBuildError(
      `跨故事文件的 defines 冲突（工程级 defines 只有一份，请统一到工程清单或消除同名异值）：\n${conflicts.join("\n")}`,
    );
  }
  return merged;
}
