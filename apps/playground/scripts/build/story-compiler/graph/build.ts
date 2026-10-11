import * as ts from "typescript";
import { walkFiles } from "../../walk-files";
import type { CompilerConstValues } from "../../compiler-contract";
import { DiagBag, ROOT_TS_FILES_ALLOWED, GEN_PREFIX, toPosix } from "./core";
import type { Graph, ModuleRecord } from "./core";
import { readConfig } from "./config";
import { scanModule, discoverStateRoot } from "./module-scan";
import { scanConstStatement, assertNpmNamesConstOnly } from "./bindings";
import { resolveImports } from "./imports";

export function buildGraph(sourcesDir: string, diags: DiagBag, constValues?: CompilerConstValues): Graph | null {
  const files = new Map<string, string>();
  for (const [rel, text] of walkFiles(sourcesDir)) {
    const posix = toPosix(rel);
    if (posix.startsWith(GEN_PREFIX) || !posix.endsWith(".ts")) continue;
    files.set(posix, text);
  }
  if (!files.has("config.ts")) {
    const emptySf = ts.createSourceFile("config.ts", "", ts.ScriptTarget.Latest, true);
    diags.addPos("config.ts", emptySf, 0, "Stories.src 根级缺少 config.ts");
    return null;
  }

  const configSf = ts.createSourceFile("config.ts", files.get("config.ts") ?? "", ts.ScriptTarget.Latest, true);
  const config = readConfig(configSf, "config.ts", diags);
  if (config === null) return null;
  if (config.folders.length === 0) {
    diags.addPos("config.ts", configSf, 0, "folders 为空且未包含 \"*\"：没有编译域");
  }
  for (const rel of files.keys()) {
    if (rel.includes("/") || ROOT_TS_FILES_ALLOWED.has(rel)) continue;
    const sf = ts.createSourceFile(rel, files.get(rel) ?? "", ts.ScriptTarget.Latest, true);
    diags.add(rel, sf, sf, "根级除 config.ts 外不允许 .ts 文件：故事请放入 folders 目录，纯模块请放入子目录");
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
    });
  }

  for (const record of records.values()) scanModule(record, diags);
  for (const record of records.values()) resolveImports(record, records, diags, true);
  for (const record of records.values()) {
    for (const stmt of record.consts) scanConstStatement(stmt, record, diags);
  }
  for (const record of records.values()) resolveImports(record, records, diags, false);
  for (const record of records.values()) assertNpmNamesConstOnly(record, diags);

  const wildcard = config.folders.includes("*");
  const explicit = config.folders.filter((f) => f !== "*");
  const coveredStories: string[] = [];
  for (const [rel, record] of records) {
    if (record.story === null) continue;
    const covered = wildcard || explicit.some((f) => rel.startsWith(`${f}/`));
    if (!covered) {
      const node = record.sf.statements.find((s) => ts.isExportAssignment(s)) ?? record.sf;
      diags.add(rel, record.sf, node, "故事文件不在 config.folders 覆盖范围内（不会被编译为列）");
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
    diags.addPos("config.ts", graph.configSf, 0, `start \`${graph.config.start}\` 没有命中任何覆盖内故事文件`);
    return undefined;
  }
  if (candidates.length > 1) {
    diags.addPos("config.ts", graph.configSf, 0, `start \`${graph.config.start}\` 命中多个故事文件：${candidates.join("、")}`);
    return undefined;
  }
  const record = graph.records.get(candidates[0]);
  return record?.story?.name;
}
