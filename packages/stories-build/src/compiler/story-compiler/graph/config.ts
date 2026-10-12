import * as ts from "typescript";
import { isSafeFileNameSegment } from "@lingfan/engine";
import type { StoryConfig, DiagBag } from "./core";

export function readConfig(
  sf: ts.SourceFile,
  rel: string,
  diags: DiagBag,
): StoryConfig | null {
  const assign = sf.statements.find((s): s is ts.ExportAssignment =>
    ts.isExportAssignment(s),
  );
  if (
    assign === undefined ||
    !ts.isObjectLiteralExpression(assign.expression)
  ) {
    diags.add(
      rel,
      sf,
      sf.statements[0] ?? sf,
      "config.ts 必须以 export default { folders, start } 结尾",
    );
    return null;
  }
  const obj = assign.expression;
  if (obj.properties.length !== 2) {
    diags.add(rel, sf, obj, "config.ts 只允许 folders 与 start 两个属性");
    return null;
  }
  const readProp = (key: string): ts.Expression | undefined => {
    for (const p of obj.properties) {
      if (
        ts.isPropertyAssignment(p) &&
        ts.isIdentifier(p.name) &&
        p.name.text === key
      )
        return p.initializer;
    }
    return undefined;
  };
  const foldersInit = readProp("folders");
  const startInit = readProp("start");
  if (foldersInit === undefined || startInit === undefined) {
    diags.add(
      rel,
      sf,
      obj,
      "config.ts 必须同时提供 folders（字符串数组）与 start（故事文件名）",
    );
    return null;
  }
  let ok = true;
  const folders: string[] = [];
  if (!ts.isArrayLiteralExpression(foldersInit)) {
    diags.add(rel, sf, foldersInit, "folders 必须是字符串数组");
    return null;
  }
  for (const el of foldersInit.elements) {
    if (!ts.isStringLiteral(el)) {
      diags.add(rel, sf, el, "folders 条目必须是字符串字面量");
      ok = false;
      continue;
    }
    if (
      el.text !== "*" &&
      el.text.split("/").some((s) => s === "" || !isSafeFileNameSegment(s))
    ) {
      diags.add(rel, sf, el, `folders 条目 \`${el.text}\` 不是安全的目录段`);
      ok = false;
      continue;
    }
    if (!folders.includes(el.text)) folders.push(el.text);
  }
  if (
    !ts.isStringLiteral(startInit) ||
    !startInit.text.endsWith(".ts") ||
    startInit.text.includes("/") ||
    startInit.text.includes("\\")
  ) {
    diags.add(
      rel,
      sf,
      startInit,
      "start 必须是单个故事文件名（含 .ts，不带目录）",
    );
    ok = false;
  }
  if (!ok) return null;
  return { folders, start: (startInit as ts.StringLiteral).text };
}
