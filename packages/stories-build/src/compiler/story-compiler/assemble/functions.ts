/**
 * 函数编译：把 .ts 模块里的函数声明（列内嵌套/跨列被引）翻译成 func 命令，
 * 含参数校验、嵌套函数提升与互调、结果缓存（按 `文件#拥有者链#名` 键）。
 * 会话与列编译入口在 ./session.ts。
 */
import * as ts from "typescript";
import type { StoryCommand } from "@lingfan-engine/core";
import type { DiagBag, Graph } from "../graph.ts";
import {
  createBodyCtx,
  makeFuncOp,
  translateStatements,
  type FuncRegistry,
  type Scope,
  type ScopeEntry,
} from "../translate.ts";
import type { AssembleSession, CompiledFunction } from "./types.ts";

function nodePos(
  sf: ts.SourceFile,
  node: ts.Node,
): { file: string; line: number; col: number } {
  const { line, character } = sf.getLineAndCharacterOfPosition(
    node.getStart(sf),
  );
  return { file: sf.fileName, line: line + 1, col: character + 1 };
}

export function partitionFunctions(statements: readonly ts.Statement[]): {
  fns: ts.FunctionDeclaration[];
  rest: ts.Statement[];
} {
  const fns: ts.FunctionDeclaration[] = [];
  const rest: ts.Statement[] = [];
  for (const stmt of statements) {
    if (
      ts.isFunctionDeclaration(stmt) &&
      stmt.name !== undefined &&
      stmt.body !== undefined
    ) {
      fns.push(stmt);
      continue;
    }
    rest.push(stmt);
  }
  return { fns, rest };
}

function readParams(
  ctx: ReturnType<typeof createBodyCtx>,
  decl: ts.FunctionDeclaration,
): string[] | undefined {
  const params: string[] = [];
  for (const param of decl.parameters) {
    if (!ts.isIdentifier(param.name)) {
      diagNode(ctx, param, "函数参数必须是简单标识符");
      return undefined;
    }
    if (params.includes(param.name.text)) {
      diagNode(ctx, param, `重复的参数名 \`${param.name.text}\``);
      return undefined;
    }
    if (
      param.initializer !== undefined ||
      param.questionToken !== undefined ||
      param.dotDotDotToken !== undefined
    ) {
      diagNode(ctx, param, "函数参数不支持默认值/可选/剩余");
      return undefined;
    }
    params.push(param.name.text);
  }
  return params;
}

function diagNode(
  ctx: ReturnType<typeof createBodyCtx>,
  node: ts.Node,
  message: string,
): void {
  ctx.shared.diags.add(ctx.shared.file, ctx.shared.mod.sf, node, message);
}

export function tryFuncOp(
  sf: ts.SourceFile,
  node: ts.Node,
  diags: DiagBag,
  name: string,
  params: string[],
  body: StoryCommand[],
): StoryCommand | undefined {
  try {
    return makeFuncOp(name, params, body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    diags.add(
      sf.fileName,
      sf,
      node,
      `func 命令构建失败（${name}）：${message}`,
    );
    return undefined;
  }
}

export function compileFunction(
  session: AssembleSession,
  graph: Graph,
  diags: DiagBag,
  file: string,
  ownerChain: readonly string[],
  decl: ts.FunctionDeclaration,
  parentScopes: readonly Scope[],
): CompiledFunction | undefined {
  const mod = graph.records.get(file);
  if (mod === undefined || decl.name === undefined) return undefined;
  const sf = mod.sf;
  const name = decl.name.text;
  const key = `${file}#${[...ownerChain, name].join("#")}`;
  const cached = session.cache.get(key);
  if (cached !== undefined) return cached;

  const registry: FuncRegistry = { refs: new Map(), names: new Map() };
  const shared = {
    mod,
    file,
    diags,
    funcs: registry,
    stateRoot: graph.stateRoot,
    fontNames: session.fontNames,
    texts: session.texts,
  };
  const ctx = createBodyCtx(shared, { inFunction: true, parentScopes });
  const params = readParams(ctx, decl);
  if (params === undefined) return undefined;
  const paramScope = new Map<string, ScopeEntry>(
    params.map((p) => [p, { kind: "param" }]),
  );
  ctx.scopes.push(paramScope);

  const { fns: nestedDecls, rest } = partitionFunctions(decl.body!.statements);
  // 函数声明提升：嵌套名先登记进本层，体翻译即可引用它们，嵌套函数之间也能互调
  for (const nestedDecl of nestedDecls) {
    ctx.scopes[ctx.scopes.length - 1].set(nestedDecl.name!.text, {
      kind: "function",
      file,
    });
  }
  const bodyCommands = translateStatements(ctx, rest);
  // 嵌套函数体继承本层作用域链（参数/局部/嵌套名只读下传）；本层翻译先完成，声明已齐备
  const nested: CompiledFunction[] = [];
  for (const nestedDecl of nestedDecls) {
    const compiled = compileFunction(
      session,
      graph,
      diags,
      file,
      [...ownerChain, name],
      nestedDecl,
      ctx.scopes,
    );
    if (compiled === undefined) continue;
    nested.push(compiled);
  }

  const allNames = new Map<string, { file: string; line: number; col: number }>(
    [[name, nodePos(sf, decl.name)]],
  );
  for (const item of nested) {
    for (const [n, pos] of item.allNames) allNames.set(n, pos);
  }
  const refs = new Set<string>([
    ...registry.refs.keys(),
    ...nested.flatMap((item) => [...item.refs]),
  ]);
  const nestedOps: StoryCommand[] = [];
  for (const item of [...nested].sort((a, b) => a.name.localeCompare(b.name))) {
    const op = tryFuncOp(
      sf,
      decl.name,
      diags,
      item.name,
      item.params,
      item.body,
    );
    if (op === undefined) continue;
    nestedOps.push(op);
  }
  const compiled: CompiledFunction = {
    key,
    file,
    name,
    params,
    body: [...nestedOps, ...bodyCommands],
    refs,
    allNames,
  };
  session.cache.set(key, compiled);
  return compiled;
}
