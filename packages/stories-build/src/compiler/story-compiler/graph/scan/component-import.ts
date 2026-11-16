import * as ts from "typescript";
import { posix } from "node:path";
import type { StoriesBuildTexts } from "../../../../shared/index.ts";
import type {
  Binding,
  ComponentRecord,
  DiagBag,
  ModuleRecord,
} from "../core.ts";
import type { ComponentChannel } from "./component-specifier.ts";

/**
 * 组件导入通道的落账：把模块里每条组件说明符登记成「一个组件 + 一个句柄绑定」。
 *
 * 这一遍必须**先于模块层常量扫描**跑：`export const picked = hub` 要在扫描时就能把
 * `hub` 折成 `"hub"`，否则折叠看不到组件绑定。它也独立于模块图的两遍导入解析——
 * 组件文件从不进 `records`（那里是会参与连边与常量求值的 TS 模块，`.vue` 进去会被当
 * TS 解析），句柄是纯静态事实。
 *
 * 两种写法：default 导入组件文件，或命名导入组件注册表。前者三件必须同时成立——
 * 落在源根的兄弟目录 `<dir>/<名>/` 内、default 导入、绑定名等于目录名——任一不成立都
 * fail-closed：组件名是全工程的键（列声明、生成物、运行期挂载都用它），静默接受一个
 * 歪名字会让后面每一步都拿着不同的名字。后者见 `bindRegisterImport`。
 *
 * 叠加层组件（`ui`）与列身体组件（`scenes`）共用这段逻辑：判定与落账只看 `channel`，
 * 文案与落账表由调用方给（两处各自一张表、各自一套措辞，互不串号）。
 */
export interface ComponentImportHooks {
  /** 把这次登记写进模块记录（哪个 Map、记哪一种绑定 kind） */
  readonly record: ComponentRecordSink;
  /** 文案：说明符落在组件目录之外 */
  readonly outside: (spec: string, sourceRootName: string) => string;
  /** 文案：default 导入的绑定名与目录名不一致 */
  readonly bindingName: (name: string, received: string) => string;
  /** 文案：文件名与目录名不一致 */
  readonly fileName: (name: string, file: string) => string;
  /** 文案：得用 default 导入 */
  readonly defaultImport: (name: string) => string;
  /** 文案：注册表里没有这个名字 */
  readonly registerMissing: (name: string) => string;
  /** 文案：注册表不接受 default / 命名空间导入 */
  readonly registerNoDefault: () => string;
  /** 文案：注册表的副作用导入 */
  readonly registerSideEffect: () => string;
}

/** 落账去处：哪张表、记哪种绑定 */
export interface ComponentRecordSink {
  table(record: ModuleRecord): Map<string, ComponentRecord>;
  bind(name: string): Binding;
}

/**
 * 扫一个模块的全部组件导入。
 *
 * `channel` 负责判定，`hooks` 负责落账与措辞——两件事分开，同一个模块可能同时挂着
 * 两条通道（一个模块既导入 UI 又导入场景），各自跑各自的，登记进各自的表。
 */
export function resolveComponentImports(
  record: ModuleRecord,
  diags: DiagBag,
  channel: ComponentChannel,
  hooks: ComponentImportHooks,
): void {
  for (const imp of record.imports) {
    const spec = ts.isStringLiteral(imp.moduleSpecifier)
      ? imp.moduleSpecifier.text
      : "";
    bindComponentImport(record, imp, spec, diags, channel, hooks);
  }
}

/** 单条说明符的判定与登记；不归组件管时什么都不做（交回模块图）。 */
function bindComponentImport(
  record: ModuleRecord,
  imp: ts.ImportDeclaration,
  spec: string,
  diags: DiagBag,
  channel: ComponentChannel,
  hooks: ComponentImportHooks,
): void {
  const outcome = channel.classify(record.rel, spec);
  if (outcome.kind === "not-component") return;
  const { sf, rel } = record;
  if (outcome.kind === "outside") {
    diags.add(rel, sf, imp, hooks.outside(spec, channel.sourceRootName));
    return;
  }
  if (outcome.kind === "file-name") {
    diags.add(
      rel,
      sf,
      imp,
      hooks.fileName(outcome.name, posix.basename(outcome.relPath)),
    );
    return;
  }
  if (outcome.kind === "register") {
    bindRegisterImport(record, imp, diags, channel, hooks);
    return;
  }
  const clause = imp.importClause;
  // 类型导入不产生运行期绑定，也没有句柄可用；`import type` 交给 tsc 自己判。
  if (clause?.isTypeOnly === true) return;
  if (clause?.name === undefined || clause.namedBindings !== undefined) {
    diags.add(rel, sf, clause ?? imp, hooks.defaultImport(outcome.name));
    return;
  }
  if (clause.name.text !== outcome.name) {
    diags.add(
      rel,
      sf,
      clause.name,
      hooks.bindingName(outcome.name, clause.name.text),
    );
    return;
  }
  hooks.record.table(record).set(outcome.name, {
    name: outcome.name,
    relPath: outcome.relPath,
    node: imp,
  });
  record.bindings.set(clause.name.text, hooks.record.bind(outcome.name));
}

/**
 * 组件注册表的命名导入：从注册表说明符取句柄（形如 `{ hub }`）。
 *
 * 名字来自注册表键，而不是说明符本身——一条注册表说明符能同时供出所有句柄，
 * 所以必须逐个导入名去注册表里查。查不到就是笔误，报错而不是静默跳过。
 *
 * 与 default 导入的差异只有一处：这里**不要求**绑定名等于组件名（`import { hub as h }`
 * 合法）。绑定名只是本地别名，折叠用的是组件名，落账时两者分开记。
 */
function bindRegisterImport(
  record: ModuleRecord,
  imp: ts.ImportDeclaration,
  diags: DiagBag,
  channel: ComponentChannel,
  hooks: ComponentImportHooks,
): void {
  const { sf, rel } = record;
  const clause = imp.importClause;
  // 副作用导入不取任何句柄，写在这里只可能是笔误。
  if (clause === undefined) {
    diags.add(rel, sf, imp, hooks.registerSideEffect());
    return;
  }
  // 类型导入不产生运行期绑定，也没有句柄可用。
  if (clause.isTypeOnly) return;
  const named = clause.namedBindings;
  // 注册表只有具名导出：default 与命名空间导入都取不到句柄。
  if (clause.name !== undefined || named === undefined) {
    diags.add(rel, sf, clause, hooks.registerNoDefault());
    return;
  }
  if (ts.isNamespaceImport(named)) {
    diags.add(rel, sf, named, hooks.registerNoDefault());
    return;
  }
  for (const element of named.elements) {
    const imported = element.propertyName?.text ?? element.name.text;
    const entry = channel.registry.find((item) => item.name === imported);
    if (entry === undefined) {
      diags.add(rel, sf, element, hooks.registerMissing(imported));
      continue;
    }
    hooks.record.table(record).set(entry.name, {
      name: entry.name,
      relPath: posix.join(channel.dir, entry.name, entry.file),
      node: imp,
    });
    record.bindings.set(element.name.text, hooks.record.bind(entry.name));
  }
}

/** 造一组 UI 钩子：落 `uis` 表、记 `ui` 绑定、用 UI 措辞 */
export function uiImportHooks(texts: StoriesBuildTexts): ComponentImportHooks {
  return {
    record: {
      table: (record) => record.uis,
      bind: (name) => ({ kind: "ui", name }),
    },
    outside: texts.uiOutside,
    bindingName: texts.uiBindingName,
    fileName: texts.uiFileName,
    defaultImport: texts.uiDefaultImport,
    registerMissing: texts.uiRegisterMissing,
    registerNoDefault: texts.uiRegisterNoDefault,
    registerSideEffect: texts.uiRegisterSideEffect,
  };
}

/** 造一组场景钩子：落 `scenes` 表、记 `scene` 绑定、用场景措辞 */
export function sceneImportHooks(
  texts: StoriesBuildTexts,
): ComponentImportHooks {
  return {
    record: {
      table: (record) => record.scenes,
      bind: (name) => ({ kind: "scene", name }),
    },
    outside: texts.sceneOutside,
    bindingName: texts.sceneBindingName,
    fileName: texts.sceneFileName,
    defaultImport: texts.sceneDefaultImport,
    registerMissing: texts.sceneRegisterMissing,
    registerNoDefault: texts.sceneRegisterNoDefault,
    registerSideEffect: texts.sceneRegisterSideEffect,
  };
}
