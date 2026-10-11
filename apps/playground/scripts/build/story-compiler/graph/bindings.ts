import * as ts from "typescript";
import { foldConst } from "./fold";
import { WORD_NAMES } from "./core";
import type { Binding, ConstValue, ModuleRecord, DiagBag } from "./core";

export function scanConstStatement(
  stmt: ts.VariableStatement,
  record: ModuleRecord,
  diags: DiagBag,
): void {
  const { sf, rel } = record;
  const declared = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword) ?? false;
  if (declared) {
    const decl0 = stmt.declarationList.declarations[0];
    if (decl0 !== undefined && ts.isIdentifier(decl0.name)) {
      const exported0 = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      record.bindings.set(decl0.name.text, { kind: "declare", name: decl0.name.text });
      if (exported0) record.exports.set(decl0.name.text, { kind: "declare", name: decl0.name.text });
    }
    return;
  }
  const flags = ts.getCombinedNodeFlags(stmt.declarationList);
  if ((flags & ts.NodeFlags.Const) === 0) {
    diags.add(rel, sf, stmt, "模块层只允许 const 声明（let/var 请移入函数体，运行期为局部变量）");
    return;
  }
  if (stmt.declarationList.declarations.length !== 1) {
    diags.add(rel, sf, stmt, "模块层 const 每条语句只允许一个声明");
    return;
  }
  const decl = stmt.declarationList.declarations[0];
  if (decl.initializer === undefined) {
    diags.add(rel, sf, decl, "模块层 const 必须带初始化");
    return;
  }
  const exported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  const bind = (name: string, binding: Binding) => {
    record.bindings.set(name, binding);
    if (exported) record.exports.set(name, binding);
  };

  if (ts.isObjectBindingPattern(decl.name)) {
    const initIdent = ts.isIdentifier(decl.initializer) ? record.bindings.get(decl.initializer.text) : undefined;
    if (initIdent?.kind !== "namespace") {
      diags.add(rel, sf, decl.initializer, "对象解构仅支持词汇层 script 命名空间：const { say, … } = script");
      return;
    }
    for (const el of decl.name.elements) {
      if (!ts.isIdentifier(el.name) || el.propertyName !== undefined || el.initializer !== undefined || el.dotDotDotToken !== undefined) {
        diags.add(rel, sf, el, "词汇层解构只支持 { a, b } 形式（不支持重命名/默认值/剩余）");
        continue;
      }
      const name = el.name.text;
      if (!WORD_NAMES.has(name)) {
        diags.add(rel, sf, el, `词汇层不存在词 \`${name}\`（或该名称不是词函数）`);
        continue;
      }
      bind(name, { kind: "word", name });
    }
    return;
  }
  if (!ts.isIdentifier(decl.name)) {
    diags.add(rel, sf, decl, "模块层 const 不支持数组解构/绑定模式");
    return;
  }
  const name = decl.name.text;
  const init = decl.initializer;

  if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === "cell") {
    if (init.arguments.length !== 2 || !ts.isStringLiteral(init.arguments[0])) {
      diags.add(rel, sf, init, "cell(name, impl) 第一实参必须是字符串字面量");
      return;
    }
    bind(name, { kind: "cell", guard: init.arguments[0].text });
    return;
  }
  if (ts.isCallExpression(init) && ts.isIdentifier(init.expression)) {
    const callee = record.bindings.get(init.expression.text);
    if (callee?.kind === "word" && callee.name === "defineVars") {
      bind(name, { kind: "opaque" });
      return;
    }
  }
  if (exported && name === "stateSchema") {
    // 构建期数据声明（C12）：state schema 由编排层求值降维成 defines，图谱层仅登记
    // opaque——不参与故事表达式，词/表达式通道不可见。
    bind(name, { kind: "opaque" });
    return;
  }
  const initIdentBinding = ts.isIdentifier(init) ? record.bindings.get(init.text) : undefined;
  if (initIdentBinding !== undefined) {
    if (initIdentBinding.kind === "namespace") {
      bind(name, { kind: "opaque" });
      return;
    }
    if (initIdentBinding.kind === "const") {
      bind(name, { kind: "const", value: initIdentBinding.value });
      return;
    }
  }
  if (ts.isPropertyAccessExpression(init) && ts.isIdentifier(init.expression)) {
    const target = record.bindings.get(init.expression.text);
    if (target?.kind === "namespace") {
      bind(name, { kind: "opaque" });
      return;
    }
  }
  // —— 编译期求值喂入（§十二）：导出名命中求值结果 ⇒ 直接绑定标量常量，跳过静态
  // 折叠。结构语义分支（cell/defineVars/词解构/namespace）优先于此：同一份代码无论
  // 是否经求值，结构绑定的解释保持一致 —— 求值只接管「常量值」这一条通道。
  const evaluated = record.evaluated?.[name];
  if (evaluated !== undefined) {
    if (!isConstScalar(evaluated)) {
      diags.add(rel, sf, init, `编译期求值导出 \`${name}\` 不是标量（string|number|boolean|null）——对象/数组等复合值不可作为常量绑定内联（§十二）`);
      return;
    }
    bind(name, { kind: "const", value: evaluated });
    return;
  }
  const value = foldConst(init, sf, diags, rel, (n) => record.bindings.get(n));
  if (value === undefined) {
    if (referencesNpmName(init, record.npmNames)) {
      diags.add(rel, sf, init, "模块层 const 引用了 node_modules 值导入——仅导出的 const 可经编译期求值内联（请把 npm 值收敛为导出 const，§十二）");
      return;
    }
    diags.add(rel, sf, init, "模块层 const 必须内联为可折叠标量（字面量/常量运算/字符串拼接/三元/枚举成员/其他 const）");
    return;
  }
  bind(name, { kind: "const", value });
}

function isConstScalar(value: unknown): value is ConstValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null;
}

function referencesNpmName(node: ts.Node, npmNames: ReadonlySet<string>): boolean {
  if (npmNames.size === 0) return false;
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found || ts.isTypeNode(n)) return;
    if (ts.isIdentifier(n) && npmNames.has(n.text)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/**
 * C10（§十二）：node_modules 值导入的引用域仅限模块层 const 初始化链。
 * 豁免：导入声明本身、模块层 const/let/var 语句（初始化链语境；非 const 由
 * scanConstStatement 自报）、enum（scanEnum 自校验）与类型位置（与 import type
 * 同语义）。其余引用（含函数体/default 导出体）一律报错。仅对被求值文件生效：
 * 未求值文件的 npm 导入已在 resolveImports 处按原文案拒绝。
 */
export function assertNpmNamesConstOnly(record: ModuleRecord, diags: DiagBag): void {
  if (record.npmNames.size === 0 || record.evaluated === undefined) return;
  const { sf, rel } = record;
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isVariableStatement(node) || ts.isEnumDeclaration(node)) return;
    if (ts.isTypeNode(node)) return;
    if (ts.isIdentifier(node) && record.npmNames.has(node.text)) {
      diags.add(rel, sf, node, `node_modules 值导入 \`${node.text}\` 仅限模块层 const 初始化链（§十二/C10）：函数体与其他语句不得引用`);
      return;
    }
    ts.forEachChild(node, visit);
  };
  for (const stmt of sf.statements) visit(stmt);
}
