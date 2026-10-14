import * as ts from "typescript";
import { walkFiles, type StoriesBuildTexts } from "../../../shared/index.ts";
import type { StorySourceConfig } from "../../../config/story-config.ts";
import type { CompilerConstValues } from "../../compiler-contract.ts";
import {
  DiagBag,
  ROOT_TS_FILES_ALLOWED,
  GEN_PREFIX,
  COLUMN_FONT_DECL,
  toPosix,
} from "./core.ts";
import type { Graph, ModuleRecord } from "./core.ts";
import { scanModule, discoverStateRoot } from "./module-scan.ts";
import { scanConstStatement, assertNpmNamesConstOnly } from "./bindings.ts";
import { resolveImports } from "./imports.ts";

/**
 * 图谱构建：布局声明（config 求值产物）为必填入参——本层不再解析 config.ts
 *（读取/校验统一走 const-eval/config-eval），只消费 folders/start。
 */
export function buildGraph(
  sourcesDir: string,
  diags: DiagBag,
  config: StorySourceConfig,
  constValues?: CompilerConstValues,
  texts?: StoriesBuildTexts,
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
    });
  }

  for (const record of records.values()) scanModule(record, diags);
  for (const record of records.values())
    resolveImports(record, records, diags, true);
  for (const record of records.values()) {
    for (const stmt of record.consts)
      scanConstStatement(stmt, record, diags, texts);
  }
  collectColumnFonts(records, diags);
  for (const record of records.values())
    resolveImports(record, records, diags, false);
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
 * 列级字体声明拾取：`export const columnFont = "<名>"`。
 * 值走既有 const 绑定通道（字面量 / 常量运算 / 其他 const / 编译期求值内联同源），
 * 这里只做归属与形状裁定；字体名是否在注册表内由汇编段对照 fontNames 报（注册表
 * 在会话上，图谱层不可见）。
 */
function collectColumnFonts(
  records: ReadonlyMap<string, ModuleRecord>,
  diags: DiagBag,
): void {
  for (const record of records.values()) {
    const binding = record.exports.get(COLUMN_FONT_DECL);
    if (binding === undefined) continue;
    const stmt = record.consts.find((s) => {
      const decl = s.declarationList.declarations[0];
      return (
        decl !== undefined &&
        ts.isIdentifier(decl.name) &&
        decl.name.text === COLUMN_FONT_DECL
      );
    });
    const node = stmt ?? record.sf;
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
