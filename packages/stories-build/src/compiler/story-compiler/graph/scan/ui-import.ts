import * as ts from "typescript";
import { posix } from "node:path";
import type { StoriesBuildTexts } from "../../../../shared/index.ts";
import type { DiagBag, ModuleRecord } from "../core.ts";
import type { UiChannel } from "./ui-specifier.ts";

/**
 * UI 导入通道的落账一段：把模块里每条 UI 说明符登记成「一个 UI + 一个句柄绑定」。
 *
 * 这一遍必须**先于模块层常量扫描**跑：`export const picked = hub` 要在扫描时就能把
 * `hub` 折成 `"hub"`，否则折叠看不到 UI 绑定。它也独立于模块图的两遍导入解析——
 * UI 文件从不进 `records`（那里是会参与连边与常量求值的 TS 模块，`.vue` 进去会被当
 * TS 解析），句柄是纯静态事实。
 *
 * 三件必须同时成立的事——落在源根的兄弟目录 `ui/<名>/` 内、default 导入、绑定名等于
 * 目录名——任一不成立都 fail-closed：UI 名字是全工程的键（列声明、生成物、运行期挂载
 * 都用它），静默接受一个歪名字会让后面每一步都拿着不同的名字。
 */
export function resolveUiImports(
  record: ModuleRecord,
  diags: DiagBag,
  channel: UiChannel,
  texts: StoriesBuildTexts,
): void {
  for (const imp of record.imports) {
    const spec = ts.isStringLiteral(imp.moduleSpecifier)
      ? imp.moduleSpecifier.text
      : "";
    bindUiImport(record, imp, spec, diags, channel, texts);
  }
}

/** 单条说明符的判定与登记；不归 UI 管时什么都不做（交回模块图）。 */
function bindUiImport(
  record: ModuleRecord,
  imp: ts.ImportDeclaration,
  spec: string,
  diags: DiagBag,
  channel: UiChannel,
  texts: StoriesBuildTexts,
): void {
  const outcome = channel.classify(record.rel, spec);
  if (outcome.kind === "not-ui") return;
  const { sf, rel } = record;
  if (outcome.kind === "outside") {
    diags.add(rel, sf, imp, texts.uiOutside(spec, channel.sourceRootName));
    return;
  }
  if (outcome.kind === "file-name") {
    diags.add(
      rel,
      sf,
      imp,
      texts.uiFileName(outcome.name, posix.basename(outcome.relPath)),
    );
    return;
  }
  const clause = imp.importClause;
  // 类型导入不产生运行期绑定，也没有句柄可用；`import type` 交给 tsc 自己判。
  if (clause?.isTypeOnly === true) return;
  if (clause?.name === undefined || clause.namedBindings !== undefined) {
    diags.add(rel, sf, clause ?? imp, texts.uiDefaultImport(outcome.name));
    return;
  }
  if (clause.name.text !== outcome.name) {
    diags.add(
      rel,
      sf,
      clause.name,
      texts.uiBindingName(outcome.name, clause.name.text),
    );
    return;
  }
  record.uis.set(outcome.name, {
    name: outcome.name,
    relPath: outcome.relPath,
    node: imp,
  });
  record.bindings.set(clause.name.text, { kind: "ui", name: outcome.name });
}
