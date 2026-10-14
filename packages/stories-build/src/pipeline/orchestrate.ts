import { join } from "node:path";
import { STORIES_DIR, type Story, type StoryColumn } from "@lingfan/engine";
import { TS_SOURCE_MANIFEST_KEY } from "@lingfan/editor";
import { assertKnownGuards, assertKnownOps } from "./gates.ts";
import { scanCellSources } from "../compiler/index.ts";
import { runConstEvalPass } from "../const-eval/index.ts";
import { assertRoundTrip, compileStory } from "../emit/index.ts";
import {
  loadDefaultCompiler,
  type CompiledStoryEntry,
  type StoriesCompiler,
} from "../compiler/index.ts";
import { emitArtifacts } from "../emit/index.ts";
import { StoryBuildError } from "../shared/index.ts";
import { loadExtensions } from "../compiler/index.ts";
import { readManifest, CONFIG_FILE } from "../config/index.ts";
import { drainBuildWarnings, type BuildReport } from "../emit/index.ts";
import {
  collectModuleDefines,
  evalConfigModule,
  mergeDefineCallsInto,
  runStateSchemaPass,
  type LocatedDefineCall,
} from "../const-eval/index.ts";
import { discoverSources } from "../discovery/index.ts";
import {
  FONTS_DIR_NAME,
  fontNameSet,
  scanFontRegistry,
} from "../fonts/index.ts";
import {
  collectDeclaredNames,
  collectEnumTypeSlotsForBuild,
  renderFontTypegen,
  renderScriptTypegen,
  renderStateTypegen,
  renderTypegen,
} from "../typegen/index.ts";
import { walkFiles } from "../shared/index.ts";

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
  /** 编译器注入（过渡期/测试用）；缺省 = 装载 `compiler` 域的默认实现 */
  readonly compiler?: StoriesCompiler;
}

/** 生成物文件名（唯一一份；报告里的逻辑路径由它和源/生成物目录名拼出） */
const GENERATED_FILE = "fun_register.g.ts";
/** 类型面生成物文件名（列名与插值键的字面量收窄面，供 IDE 与 typecheck 用） */
const TYPEGEN_FILE = "stories.gen.d.ts";
/** state 类型面生成物文件名（StoryState 精确类型，形态 B 的 ambient 桥引它） */
const STATE_TYPEGEN_FILE = "state.gen.d.ts";
/** script 命名空间 ambient 声明文件名（免导入直呼的类型面，内容恒定） */
const SCRIPT_TYPEGEN_FILE = "script.gen.d.ts";
/** font 字面量类型面文件名（字体名注册表的键=值收窄面，内容随注册表） */
const FONT_TYPEGEN_FILE = "font.gen.d.ts";

/**
 * 编译 `root/Stories.src/` 下的 TS 源 → `root/Resources/`（纯编排，fs 全在参数 root 之下；
 * 测试用临时工程根直测，CLI 主守卫传真实根）。
 *
 * 十四段串行：config.ts 单次求值（named exports 四导出 folders/start/vars/state +
 * 形态 B define 累积，读取/校验统一在此）→ 源发现（folders 多目录 + start 全局恰一）
 * → cell 扫描 → 编译期求值（node_modules 值导入的模块整体求值，导出常量喂给
 * 编译器内联）→ 模块层构建期 define 收集汇入（顶层 define 语句与 config 树同源合并，
 * 互斥/冲突 fail-closed）与 state 降维（config.state/define 合并树走同一降维文法
 * 扁平化为 defines）→ 字体名注册表扫描（Resources/Fonts 文件名去扩展名，编译期字体
 * 引用检查对照源）→ story-compiler 编译（诊断非空 fail-closed）→ parseStory 校验兜底 →
 * 列归一与 sourcePath 回填（源文件路径 = 产物路径）→ 工程合并（id/entry 取 start 故事，
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

  // —— config.ts 单次求值：named exports 四导出（folders/start/vars/state）+ 形态 B
  // define 累积一并取出；布局校验（parseFolders/parseStart）、define 合并冲突与
  // 形态 A/B 互斥全部 fail-closed（读取统一走本通道，图谱层不再解析 config）——
  const evaluated = await evalConfigModule(root, sourcesDirName);

  // —— 源发现：config 布局声明 → folders 多目录递归 → start 全局恰一 ——
  const discovery = await discoverSources(root, sourcesDirName, evaluated.config);

  // —— cell 声明扫描（构建期 AST 扫描）：源树（排除生成物目录，仅 .ts；机制不动）。
  // 源树同时是模块层 define 收集与枚举槽位回收的输入（只读复用，不重扫）——
  const sourceTree = walkFiles(sourcesDir);
  const cellScan = scanCellSources(sourceTree, generatedDirName);

  // —— 编译期求值：含 node_modules 值导入的文件整体求值，导出常量值喂给
  // 编译器内联；求值诊断与双求值确定性闸门 fail-closed，一次报全部 ——
  const constValues = await runConstEvalPass(
    sourcesDir,
    discovery.stories,
    discovery.modules,
    sourcesDirName,
  );

  // —— 模块层构建期 define 收集与汇入：源模块顶层 define 语句（函数体外）AST 折叠，
  // 与 config 的 define 树汇入同一棵合并树（形态 B 的 define 域放宽）。形态 A
  // （state 导出）与模块层 define 互斥；跨文件同键/形状冲突 fail-closed 一次报
  // 全部（落点带 源文件:行:列）——
  const moduleDefineCalls = collectModuleDefines({
    sourcesDir,
    files: sourceTree,
    generatedDirName,
  });
  if (evaluated.state !== undefined && moduleDefineCalls.length > 0) {
    throw new StoryBuildError(
      [
        `${sourcesDirName}/${CONFIG_FILE}: 形态 A（state 导出）与模块层构建期 define 互斥——形态 A/B 二选一：`,
        ...moduleDefineCalls.map((call) => `- ${call.origin}${defineLabel(call)}`),
      ].join("\n"),
    );
  }
  const moduleDefineConflicts = mergeDefineCallsInto(
    evaluated.defineTree,
    moduleDefineCalls,
  );
  if (moduleDefineConflicts.length > 0) {
    throw new StoryBuildError(
      `模块层构建期 define 冲突（${moduleDefineConflicts.length} 条）：\n${moduleDefineConflicts
        .map((conflict) => `- ${conflict}`)
        .join("\n")}`,
    );
  }

  // —— state 降维：config.state（形态 A）与 define 合并树（形态 B，二选一）
  // 走同一降维文法扁平化为 defines；文法诊断 fail-closed，皆缺省 = 空 schema 贡献 ——
  const schemaDefines = runStateSchemaPass(
    evaluated.state,
    evaluated.defineTree,
    sourcesDirName,
  );

  // —— 字体名注册表：Resources/Fonts 下的字体文件名去扩展名（目录缺失/为空 = 空注册表，
  // 引用字体名的工程 fail-closed，未引用的零打扰）；喂给编译器做 {font=} 标签与角色
  // 字体的构建期检查，宿主侧由 Vite 扫描同目录注入 @font-face ——
  const fontEntries = scanFontRegistry(join(resourcesDir, FONTS_DIR_NAME));
  const fontNames = fontNameSet(fontEntries);

  // —— story-compiler：故事/模块清单一次性编译（诊断非空 = fail-closed，一次报全部）——
  const compiler = options.compiler ?? (await loadDefaultCompiler());
  const compiled = await compiler.compileStories({
    root,
    sourcesDir,
    config: evaluated.config,
    stories: discovery.stories,
    modules: discovery.modules,
    constValues,
    fontNames,
  });
  if (compiled.diags.length > 0) {
    throw new StoryBuildError(
      `故事编译失败（${compiled.diags.length} 条）：\n${compiled.diags
        .map(
          (diag) => `- ${diag.file}:${diag.line}:${diag.col} ${diag.message}`,
        )
        .join("\n")}`,
    );
  }

  // —— 列归一：产物路径 = 源文件路径（`Stories/<相对源路径去扩展名>.json`；
  // 文件名与列 id 解耦）。parseStory 不在链上：编译器静态产出 Story
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
  // 故事版本（作者声明，缺省不写）：进存档 storyVersion；托管键更新把声明写进 project.json
  merged.version = evaluated.config.version;

  // —— 工程清单：先有 project.json（defines/shell 是工程事实，不归 TS 源管）——
  // 标记键 `tsSource`（非托管键，serializeProject 原位保留）：编辑器据此对
  // `Stories/**` 与 `project.json` 只读（守卫判据，构建写入、编辑器不碰）。
  const manifest = readManifest(root, resourcesDirName);
  const markedManifest = {
    ...(typeof manifest === "object" && manifest !== null ? manifest : {}),
    [TS_SOURCE_MANIFEST_KEY]: true,
  };

  // —— 扩展声明装载（对齐运行期声明制：同一份 manifest.extensions、同一个装载契约）——
  const { declared, opNames, ids } = await loadExtensions(root, manifest);

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

  // —— 类型面生成物：字符串域全部取上面已算好的结果，不重跑任何一段 ——
  // 列 id 取编译产物、state 键取 schemaDefines、变量键取 config.vars 导出的键集
  // （config.ts 求值通道；图谱层的 defineVars 扫描已退役为守卫），声明名从列的
  // 命令流里收（let/for/input 这类运行期变量名只存在于产物里），
  // 扩展 id 取扩展装载段的装载结果（装载在写盘之前，数据现成）。
  const typegenContent = renderTypegen({
    columns: merged.columns.map((column) => column.id),
    schemaKeys: Object.keys(schemaDefines),
    defineKeys: [...evaluated.vars],
    declaredNames: collectDeclaredNames(merged.columns),
    extensionPrefixes: ids,
  });

  // —— state 类型面生成物（形态 B gen 类型面）：树取求值段结果（形态 A state 树 /
  // 形态 B define 合并树——模块层 define 已在前置段汇入同一棵树）；枚举 type 槽位
  // 从 config.ts 与各模块源文按点路径回收（esbuild 求值丢标识符，AST 侧补回收）。
  // 渲染恒产出：空树退化为 Record<string, never>，ambient 桥永远有类型可引 ——
  const stateTypegenContent = renderStateTypegen({
    tree: evaluated.state ?? evaluated.defineTree,
    enumSlots: collectEnumTypeSlotsForBuild({
      configSource: sourceTree.get(CONFIG_FILE) ?? "",
      moduleFiles: moduleSlotFiles(sourceTree, moduleDefineCalls),
    }),
    generatedDir: generatedDirName,
  });

  // —— script 命名空间 ambient 声明（免导入直呼）：内容恒定、与工程状态无关，
  // 纯编译期类型面零运行时注入；显式 import / 解构按 TS 遮蔽语义优先 ——
  const scriptTypegenContent = renderScriptTypegen();

  // —— font 字面量类型面：键 = 值 = 注册表字体名（引号键保非标识符名）；
  // 空注册表恒产出封闭空对象，未注册名在 TS 面不可见（改拼即 TS2551）——
  const fontTypegenContent = renderFontTypegen(fontEntries);

  // —— 差量写盘 + 生成物（逻辑路径，相对资源根）——
  const { added, updated, removed } = emitArtifacts({
    root,
    resourcesDir,
    storiesDir,
    generatedRel: `${sourcesDirName}/${generatedDirName}/${GENERATED_FILE}`,
    serialized,
    cellScan,
    typegen: {
      rel: `${sourcesDirName}/${generatedDirName}/${TYPEGEN_FILE}`,
      content: typegenContent,
    },
    stateGen: {
      rel: `${sourcesDirName}/${generatedDirName}/${STATE_TYPEGEN_FILE}`,
      content: stateTypegenContent,
    },
    scriptGen: {
      rel: `${sourcesDirName}/${generatedDirName}/${SCRIPT_TYPEGEN_FILE}`,
      content: scriptTypegenContent,
    },
    fontGen: {
      rel: `${sourcesDirName}/${generatedDirName}/${FONT_TYPEGEN_FILE}`,
      content: fontTypegenContent,
    },
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

/** 互斥文案里的一条调用签名（path 形带键名；spec 形统一签名） */
function defineLabel(call: LocatedDefineCall): string {
  return call.call.kind === "path" ? `define("${call.call.path}")` : "define({…})";
}

/** 枚举槽位回收的模块源文（按调用落点去重排序；树里缺文本的文件跳过） */
function moduleSlotFiles(
  sourceTree: ReadonlyMap<string, string>,
  calls: readonly { rel: string }[],
): Map<string, string> {
  const files = new Map<string, string>();
  for (const rel of [...new Set(calls.map((call) => call.rel))].sort()) {
    const text = sourceTree.get(rel);
    if (text !== undefined) files.set(rel, text);
  }
  return files;
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
  if (
    typeof entry.story.id !== "string" ||
    entry.story.id === "" ||
    typeof entry.story.entry !== "string" ||
    entry.story.entry === ""
  ) {
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
 * 来源 = config 状态（config 先行：形态 A state 或形态 B define 合并树）+ 各故事文件；
 * config 与故事同键异值同样冲突。
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
    put(key, value, "config.ts（state/define）");
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
