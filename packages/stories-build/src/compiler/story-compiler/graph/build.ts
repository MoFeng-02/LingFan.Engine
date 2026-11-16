import * as ts from "typescript";
import {
  walkFiles,
  defaultStoriesBuildTexts,
  type StoriesBuildTexts,
} from "../../../shared/index.ts";
import type { StorySourceConfig } from "../../../config/story-config.ts";
import type { CompilerConstValues } from "../../compiler-contract.ts";
import { DiagBag, ROOT_TS_FILES_ALLOWED, GEN_PREFIX, toPosix } from "./core.ts";
import type {
  Graph,
  ModuleRecord,
  SceneRegistryEntry,
  UiRegistryEntry,
} from "./core.ts";
import { scanModule } from "./scan/module-scan.ts";
import { discoverStateRoot } from "./state-root.ts";
import {
  scanConstStatement,
  assertNpmNamesConstOnly,
} from "./scan/bindings.ts";
import {
  assertSceneBodies,
  collectColumnBodies,
  collectColumnBodyProps,
  collectColumnFonts,
  collectColumnKinds,
  collectColumnTypes,
} from "./column-decls.ts";
import { resolveImports } from "./scan/imports.ts";
import { createUiChannel } from "./scan/ui-specifier.ts";
import { resolveUiImports } from "./scan/ui-import.ts";
import { createSceneChannel } from "./scan/scene-specifier.ts";
import { resolveSceneImports } from "./scan/scene-import.ts";
import type { AliasResolver } from "./scan/alias.ts";

/**
 * 图谱构建：布局声明（config 求值产物）为必填入参——本层不再解析 config.ts
 *（读取/校验统一走 const-eval/config-eval），只消费 folders/start。
 *
 * `alias` 是工程 `tsconfig.json` 的 `paths` 解析器；缺省 = 只认相对路径。
 *
 * `uiRegistry` 是 UI 名注册表（扫描 `ui/` 目录的产物）；缺省 = 空表，此时命名导入
 * 注册表会因查不到名字而报错——只有编排层知道 `ui/` 在哪，编译器自己不扫目录。
 * `sceneRegistry` 同理，指 `scenes/`：两张表分开传，谁也不知道对方的存在。
 */
export function buildGraph(
  sourcesDir: string,
  diags: DiagBag,
  config: StorySourceConfig,
  constValues?: CompilerConstValues,
  texts?: StoriesBuildTexts,
  alias?: AliasResolver,
  uiRegistry?: readonly UiRegistryEntry[],
  sceneRegistry?: readonly SceneRegistryEntry[],
): Graph | null {
  const files = new Map<string, string>();
  for (const [rel, text] of walkFiles(sourcesDir)) {
    const posix = toPosix(rel);
    if (posix.startsWith(GEN_PREFIX) || !posix.endsWith(".ts")) continue;
    files.set(posix, text);
  }
  if (!files.has("config.ts")) {
    const emptySf = ts.createSourceFile(
      "config.ts",
      "",
      ts.ScriptTarget.Latest,
      true,
    );
    diags.addPos("config.ts", emptySf, 0, "Stories.src 根级缺少 config.ts");
    return null;
  }

  const configSf = ts.createSourceFile(
    "config.ts",
    files.get("config.ts") ?? "",
    ts.ScriptTarget.Latest,
    true,
  );
  if (config.folders.length === 0) {
    diags.addPos(
      "config.ts",
      configSf,
      0,
      'folders 为空且未包含 "*"：没有编译域',
    );
  }
  for (const rel of files.keys()) {
    if (rel.includes("/") || ROOT_TS_FILES_ALLOWED.has(rel)) continue;
    const sf = ts.createSourceFile(
      rel,
      files.get(rel) ?? "",
      ts.ScriptTarget.Latest,
      true,
    );
    diags.add(
      rel,
      sf,
      sf,
      "根级除 config.ts 外不允许 .ts 文件：故事请放入 folders 目录，纯模块请放入子目录",
    );
  }

  const records = new Map<string, ModuleRecord>();
  for (const [rel, text] of files) {
    if (rel === "config.ts") continue;
    records.set(rel, {
      rel,
      sf: ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true),
      story: null,
      functions: new Map(),
      bindings: new Map(),
      exports: new Map(),
      imports: [],
      consts: [],
      npmNames: new Set(),
      evaluated: constValues?.[rel],
      columnFont: null,
      columnType: null,
      columnKind: null,
      columnBody: null,
      columnBodyProps: null,
      uis: new Map(),
      scenes: new Map(),
    });
  }

  // UI 沙箱根是源根的上一级（`src/`）：UI 目录与故事源树是兄弟，不是它的子目录。
  // 这一遍必须早于模块层常量扫描——`export const picked = hub` 折叠时要看得到 UI 绑定。
  const uiChannel = createUiChannel(sourcesDir, alias, uiRegistry);
  const sceneChannel = createSceneChannel(sourcesDir, alias, sceneRegistry);
  const componentChannels = [uiChannel.component, sceneChannel.component];
  const uiTexts = texts ?? defaultStoriesBuildTexts;
  for (const record of records.values()) scanModule(record, diags);
  for (const record of records.values())
    resolveUiImports(record, diags, uiChannel, uiTexts);
  for (const record of records.values())
    resolveSceneImports(record, diags, sceneChannel, uiTexts);
  for (const record of records.values())
    resolveImports(record, records, diags, true, alias, componentChannels);
  for (const record of records.values()) {
    for (const stmt of record.consts)
      scanConstStatement(stmt, record, diags, texts);
  }
  collectColumnFonts(records, diags);
  collectColumnTypes(records, diags);
  collectColumnKinds(records, diags, uiTexts);
  collectColumnBodies(records, diags, uiTexts);
  collectColumnBodyProps(records, diags, uiTexts);
  assertSceneBodies(records, diags, uiTexts);
  for (const record of records.values())
    resolveImports(record, records, diags, false, alias, componentChannels);
  for (const record of records.values())
    assertNpmNamesConstOnly(record, diags, texts);

  const wildcard = config.folders.includes("*");
  const explicit = config.folders.filter((f) => f !== "*");
  const coveredStories: string[] = [];
  for (const [rel, record] of records) {
    if (record.story === null) continue;
    const covered = wildcard || explicit.some((f) => rel.startsWith(`${f}/`));
    if (!covered) {
      const node =
        record.sf.statements.find((s) => ts.isExportAssignment(s)) ?? record.sf;
      diags.add(
        rel,
        record.sf,
        node,
        "故事文件不在 config.folders 覆盖范围内（不会被编译为列）",
      );
      continue;
    }
    coveredStories.push(rel);
  }
  coveredStories.sort();

  const stateRoot = discoverStateRoot(records, diags);
  return { files, records, config, configSf, coveredStories, stateRoot };
}

export function resolveStart(graph: Graph, diags: DiagBag): string | undefined {
  const candidates = graph.coveredStories.filter((rel) => {
    const idx = rel.lastIndexOf("/");
    return (idx === -1 ? rel : rel.slice(idx + 1)) === graph.config.start;
  });
  if (candidates.length === 0) {
    diags.addPos(
      "config.ts",
      graph.configSf,
      0,
      `start \`${graph.config.start}\` 没有命中任何覆盖内故事文件`,
    );
    return undefined;
  }
  if (candidates.length > 1) {
    diags.addPos(
      "config.ts",
      graph.configSf,
      0,
      `start \`${graph.config.start}\` 命中多个故事文件：${candidates.join("、")}`,
    );
    return undefined;
  }
  const record = graph.records.get(candidates[0]);
  return record?.story?.name;
}
