import * as ts from "typescript";
import { isSceneType } from "@lingfan-engine/core";
import {
  walkFiles,
  defaultStoriesBuildTexts,
  type StoriesBuildTexts,
} from "../../../shared/index.ts";
import type { StorySourceConfig } from "../../../config/story-config.ts";
import type { CompilerConstValues } from "../../compiler-contract.ts";
import {
  DiagBag,
  ROOT_TS_FILES_ALLOWED,
  GEN_PREFIX,
  COLUMN_FONT_DECL,
  COLUMN_TYPE_DECL,
  toPosix,
} from "./core.ts";
import type { Graph, ModuleRecord } from "./core.ts";
import { scanModule } from "./scan/module-scan.ts";
import { discoverStateRoot } from "./state-root.ts";
import {
  scanConstStatement,
  assertNpmNamesConstOnly,
} from "./scan/bindings.ts";
import { resolveImports } from "./scan/imports.ts";
import { createUiChannel } from "./scan/ui-specifier.ts";
import { resolveUiImports } from "./scan/ui-import.ts";
import type { AliasResolver } from "./scan/alias.ts";

/**
 * 图谱构建：布局声明（config 求值产物）为必填入参——本层不再解析 config.ts
 *（读取/校验统一走 const-eval/config-eval），只消费 folders/start。
 *
 * `alias` 是工程 `tsconfig.json` 的 `paths` 解析器；缺省 = 只认相对路径。
 */
export function buildGraph(
  sourcesDir: string,
  diags: DiagBag,
  config: StorySourceConfig,
  constValues?: CompilerConstValues,
  texts?: StoriesBuildTexts,
  alias?: AliasResolver,
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
      uis: new Map(),
    });
  }

  // UI 沙箱根是源根的上一级（`src/`）：UI 目录与故事源树是兄弟，不是它的子目录。
  // 这一遍必须早于模块层常量扫描——`export const picked = hub` 折叠时要看得到 UI 绑定。
  const uiChannel = createUiChannel(sourcesDir, alias);
  const uiTexts = texts ?? defaultStoriesBuildTexts;
  for (const record of records.values()) scanModule(record, diags);
  for (const record of records.values())
    resolveUiImports(record, diags, uiChannel, uiTexts);
  for (const record of records.values())
    resolveImports(record, records, diags, true, alias, uiChannel);
  for (const record of records.values()) {
    for (const stmt of record.consts)
      scanConstStatement(stmt, record, diags, texts);
  }
  collectColumnFonts(records, diags);
  collectColumnTypes(records, diags);
  for (const record of records.values())
    resolveImports(record, records, diags, false, alias, uiChannel);
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

/**
 * 列级声明所在的语法节点（诊断定位用）。
 *
 * 找不到对应的 `const` 语句时退回整个源文件：报错仍能指出哪个文件，
 * 比拿不到位置更好，也和 `columnFont` 既有行为一致。
 */
function declNodeOf(record: ModuleRecord, name: string): ts.Node {
  const stmt = record.consts.find((s) => {
    const decl = s.declarationList.declarations[0];
    return (
      decl !== undefined &&
      ts.isIdentifier(decl.name) &&
      decl.name.text === name
    );
  });
  return stmt ?? record.sf;
}

/**
 * 列级字体声明拾取：`export const columnFont = "<名>"`。
 * 值走既有 const 绑定通道（字面量 / 常量运算 / 其他 const / 编译期求值内联同源），
 * 这里只做归属与形状判定；字体名是否在注册表内由汇编段对照 fontNames 报（注册表
 * 在会话上，图谱层不可见）。
 */
function collectColumnFonts(
  records: ReadonlyMap<string, ModuleRecord>,
  diags: DiagBag,
): void {
  for (const record of records.values()) {
    const binding = record.exports.get(COLUMN_FONT_DECL);
    if (binding === undefined) continue;
    const node = declNodeOf(record, COLUMN_FONT_DECL);
    if (record.story === null) {
      diags.add(
        record.rel,
        record.sf,
        node,
        "columnFont 只能声明在故事文件（default 导出列）的模块顶层",
      );
      continue;
    }
    if (
      binding.kind !== "const" ||
      typeof binding.value !== "string" ||
      binding.value === ""
    ) {
      diags.add(
        record.rel,
        record.sf,
        node,
        "columnFont 必须折叠为非空字符串字面量（字体名 = Resources/Fonts 文件名去扩展名）",
      );
      continue;
    }
    record.columnFont = { value: binding.value, node };
  }
}

/**
 * 列类型声明拾取：`export const columnType = "ui"`。
 *
 * 与 JSON / 文本形态的 `type` 字段同义：不写 = `game`，写了必须是契约承认的两个取值之一。
 * 为什么要这条通道：列类型是**列自身的语义**，而 TS 创作链里一列就是一个函数模块，
 * 没有别的位置能放下它；让作者改生成物或手写 JSON 会把同一份事实劈成两处。
 */
function collectColumnTypes(
  records: ReadonlyMap<string, ModuleRecord>,
  diags: DiagBag,
): void {
  for (const record of records.values()) {
    const binding = record.exports.get(COLUMN_TYPE_DECL);
    if (binding === undefined) continue;
    const node = declNodeOf(record, COLUMN_TYPE_DECL);
    if (record.story === null) {
      diags.add(
        record.rel,
        record.sf,
        node,
        "columnType 只能声明在故事文件（default 导出列）的模块顶层",
      );
      continue;
    }
    if (binding.kind !== "const" || !isSceneType(binding.value)) {
      diags.add(
        record.rel,
        record.sf,
        node,
        'columnType 必须折叠为 "game" 或 "ui" 字面量（缺省即 game，不必声明）',
      );
      continue;
    }
    record.columnType = { value: binding.value, node };
  }
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
