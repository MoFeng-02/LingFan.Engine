import * as ts from "typescript";
import { isSceneType } from "@lingfan-engine/core";
import type { StoriesBuildTexts } from "../../../shared/index.ts";
import {
  COLUMN_BODY_DECL,
  COLUMN_BODY_PROPS_DECL,
  COLUMN_FONT_DECL,
  COLUMN_KIND_DECL,
  COLUMN_TYPE_DECL,
} from "./core.ts";
import type {
  Binding,
  ColumnKind,
  DiagBag,
  JsonObject,
  JsonValue,
  ModuleRecord,
} from "./core.ts";
import { foldJsonValue } from "./fold.ts";

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
export function collectColumnFonts(
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
export function collectColumnTypes(
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

/**
 * 列类型归属的第二种声明：`export const columnKind = "scene"`。
 *
 * 与 `kind` 字段同义，缺省即 `flow`——所以只有故事文件顶层、只有两个字面量取值。
 * 单独一条通道而不是复用 `columnType`：那是「列画在游戏层还是 UI 层」，这是
 * 「这一列的身体是命令体还是组件」，正交，混在一起会逼出四值枚举。
 */
export function collectColumnKinds(
  records: ReadonlyMap<string, ModuleRecord>,
  diags: DiagBag,
  texts: StoriesBuildTexts,
): void {
  for (const record of records.values()) {
    const binding = record.exports.get(COLUMN_KIND_DECL);
    if (binding === undefined) continue;
    const node = declNodeOf(record, COLUMN_KIND_DECL);
    if (record.story === null) {
      diags.add(
        record.rel,
        record.sf,
        node,
        "columnKind 只能声明在故事文件（default 导出列）的模块顶层",
      );
      continue;
    }
    if (!isColumnKindValue(binding)) {
      diags.add(record.rel, record.sf, node, texts.columnKindLiteral());
      continue;
    }
    record.columnKind = { value: binding.value, node };
  }
}

function isColumnKindValue(
  binding: Binding,
): binding is { kind: "const"; value: ColumnKind } {
  if (binding.kind !== "const") return false;
  return binding.value === "scene" || binding.value === "flow";
}

/**
 * 列身体拾取：`export const body = kitchen`。
 *
 * 认的是**初始化表达式**而不是折叠后的值：列身体必须是一个指向 `scenes/<名>/`
 * 的组件句柄，也就是从 `scene_register.g` 具名导入后绑定的名字。折叠成字符串
 * 也能拿到名字，但那样「随手写 `export const body = "kitchen"`」也会通过——
 * 而那个字符串在运行期根本挂不上组件，属于静默成功，必须在构建期拦掉。
 */
export function collectColumnBodies(
  records: ReadonlyMap<string, ModuleRecord>,
  diags: DiagBag,
  texts: StoriesBuildTexts,
): void {
  for (const record of records.values()) {
    const initializer = initializerOf(record, COLUMN_BODY_DECL);
    if (initializer === undefined) continue;
    const node = declNodeOf(record, COLUMN_BODY_DECL);
    if (record.story === null) {
      diags.add(
        record.rel,
        record.sf,
        node,
        "body 只能声明在故事文件（default 导出列）的模块顶层",
      );
      continue;
    }
    const binding = ts.isIdentifier(initializer)
      ? record.bindings.get(initializer.text)
      : undefined;
    if (binding?.kind !== "scene") {
      diags.add(
        record.rel,
        record.sf,
        node,
        texts.columnBodyHandle(receivedOf(initializer)),
      );
      continue;
    }
    record.columnBody = { value: binding.name, node };
  }
}

/** 报错里回显「收到的是什么」：能读成名字就读名字，读不出就退回源码文本。 */
function receivedOf(node: ts.Expression): string {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return node.getText();
}

/** 列声明的初始化表达式（模块顶层 `const <name> = <init>` 的 init） */
function initializerOf(
  record: ModuleRecord,
  name: string,
): ts.Expression | undefined {
  const stmt = record.consts.find((s) => {
    const decl = s.declarationList.declarations[0];
    return (
      decl !== undefined &&
      ts.isIdentifier(decl.name) &&
      decl.name.text === name
    );
  });
  return stmt?.declarationList.declarations[0]?.initializer;
}

/**
 * 列身体 props 拾取：`export const bodyProps = { … }`。
 *
 * 整棵树要原样进 `SYS.body`，运行期不求值，所以构建期必须读出纯数据；任何标识符、
 * 调用、展开、计算属性都不收（`foldJsonValue` 返回 undefined）。
 */
export function collectColumnBodyProps(
  records: ReadonlyMap<string, ModuleRecord>,
  diags: DiagBag,
  texts: StoriesBuildTexts,
): void {
  for (const record of records.values()) {
    const initializer = initializerOf(record, COLUMN_BODY_PROPS_DECL);
    if (initializer === undefined) continue;
    const node = declNodeOf(record, COLUMN_BODY_PROPS_DECL);
    if (record.story === null) {
      diags.add(
        record.rel,
        record.sf,
        node,
        "bodyProps 只能声明在故事文件（default 导出列）的模块顶层",
      );
      continue;
    }
    const value = foldJsonValue(initializer);
    if (value === undefined || !isJsonObject(value)) {
      diags.add(record.rel, record.sf, node, texts.columnBodyProps());
      continue;
    }
    record.columnBodyProps = { value, node };
  }
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `columnKind = "scene"` 却没有 `body` ⇒ 报错。
 *
 * 场景列的身体只能来自组件：没有组件的场景列既没有 elements 也没有 body，
 * 契约里它是「形状不成立」的一列，产物写出去也只会在读取端再报一次。
 */
export function assertSceneBodies(
  records: ReadonlyMap<string, ModuleRecord>,
  diags: DiagBag,
  texts: StoriesBuildTexts,
): void {
  for (const record of records.values()) {
    if (record.columnKind?.value !== "scene") continue;
    if (record.columnBody !== null) continue;
    diags.add(
      record.rel,
      record.sf,
      record.columnKind.node,
      texts.columnBodyMissing(),
    );
  }
}
