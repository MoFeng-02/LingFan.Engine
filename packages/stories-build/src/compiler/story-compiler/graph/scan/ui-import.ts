import * as ts from "typescript";
import { posix } from "node:path";
import type { StoriesBuildTexts } from "../../../../shared/index.ts";
import { UI_DIR_NAME, type DiagBag, type ModuleRecord } from "../core.ts";
import type { UiChannel } from "./ui-specifier.ts";

/**
 * UI 导入通道的落账一段：把模块里每条 UI 说明符登记成「一个 UI + 一个句柄绑定」。
 *
 * 这一遍必须**先于模块层常量扫描**跑：`export const picked = hub` 要在扫描时就能把
 * `hub` 折成 `"hub"`，否则折叠看不到 UI 绑定。它也独立于模块图的两遍导入解析——
 * UI 文件从不进 `records`（那里是会参与连边与常量求值的 TS 模块，`.vue` 进去会被当
 * TS 解析），句柄是纯静态事实。
 *
 * 两种写法：default 导入 UI 文件，或命名导入 UI 注册表。前者三件必须同时成立——
 * 落在源根的兄弟目录 `ui/<名>/` 内、default 导入、绑定名等于目录名——任一不成立都
 * fail-closed：UI 名字是全工程的键（列声明、生成物、运行期挂载都用它），静默接受一个
 * 歪名字会让后面每一步都拿着不同的名字。后者见 `bindRegisterImport`。
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
  if (outcome.kind === "register") {
    bindRegisterImport(record, imp, diags, channel, texts);
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

/**
 * UI 注册表的命名导入：从注册表说明符取句柄（形如 `{ hub }`）。
 *
 * 名字来自注册表键，而不是说明符本身——一条注册表说明符能同时供出所有 UI 句柄，
 * 所以必须逐个导入名去注册表里查。查不到就是笔误，报错而不是静默跳过。
 *
 * 与 default 导入的差异只有一处：这里**不要求**绑定名等于 UI 名（`import { hub as h }`
 * 合法）。绑定名只是本地别名，折叠用的是 UI 名，落账时两者分开记。
 */
function bindRegisterImport(
  record: ModuleRecord,
  imp: ts.ImportDeclaration,
  diags: DiagBag,
  channel: UiChannel,
  texts: StoriesBuildTexts,
): void {
  const { sf, rel } = record;
  const clause = imp.importClause;
  // 副作用导入不取任何句柄，写在这里只可能是笔误。
  if (clause === undefined) {
    diags.add(rel, sf, imp, texts.uiRegisterSideEffect());
    return;
  }
  // 类型导入不产生运行期绑定，也没有句柄可用。
  if (clause.isTypeOnly) return;
  const named = clause.namedBindings;
  // 注册表只有具名导出：default 与命名空间导入都取不到句柄。
  if (clause.name !== undefined || named === undefined) {
    diags.add(rel, sf, clause, texts.uiRegisterNoDefault());
    return;
  }
  if (ts.isNamespaceImport(named)) {
    diags.add(rel, sf, named, texts.uiRegisterNoDefault());
    return;
  }
  for (const element of named.elements) {
    const imported = element.propertyName?.text ?? element.name.text;
    const entry = channel.registry.find((item) => item.name === imported);
    if (entry === undefined) {
      diags.add(rel, sf, element, texts.uiRegisterMissing(imported));
      continue;
    }
    record.uis.set(entry.name, {
      name: entry.name,
      relPath: posix.join(UI_DIR_NAME, entry.name, entry.file),
      node: imp,
    });
    record.bindings.set(element.name.text, { kind: "ui", name: entry.name });
  }
}
