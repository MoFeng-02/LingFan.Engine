import * as ts from "typescript";
import type { Story, StoryCommand } from "@lingfan/engine";
import type { DiagBag, Graph } from "./graph.ts";
import {
  createBodyCtx,
  makeFuncOp,
  translateStatements,
  type FuncRegistry,
  type Scope,
  type ScopeEntry,
} from "./translate.ts";

interface CompiledFunction {
  key: string;
  file: string;
  name: string;
  params: string[];
  body: StoryCommand[];
  refs: ReadonlySet<string>;
  allNames: ReadonlyMap<string, { file: string; line: number; col: number }>;
}

export interface AssembleSession {
  cache: Map<string, CompiledFunction>;
  /** 字体名注册表（编排层自 Resources/Fonts 扫描；构建期字体引用检查对照源） */
  fontNames: ReadonlySet<string>;
}

export interface CompiledStory {
  columnId: string;
  sourceRelPath: string;
  story: Story;
}

export function createAssembleSession(
  fontNames: ReadonlySet<string> = new Set(),
): AssembleSession {
  return { cache: new Map(), fontNames };
}

function nodePos(
  sf: ts.SourceFile,
  node: ts.Node,
): { file: string; line: number; col: number } {
  const { line, character } = sf.getLineAndCharacterOfPosition(
    node.getStart(sf),
  );
  return { file: sf.fileName, line: line + 1, col: character + 1 };
}

function partitionFunctions(statements: readonly ts.Statement[]): {
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

function tryFuncOp(
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

function compileFunction(
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

export function compileStoryFile(
  session: AssembleSession,
  graph: Graph,
  diags: DiagBag,
  rel: string,
): CompiledStory | undefined {
  const mod = graph.records.get(rel);
  const storyName = mod?.story?.node.name;
  if (mod === undefined || mod.story === null || storyName === undefined)
    return undefined;
  const storyDecl = mod.story;
  const sf = mod.sf;
  const columnId = storyDecl.name;

  // —— 列级字体：声明值对照字体名注册表（fail-closed，与词引用同一文案口径）——
  let columnFont: string | undefined;
  if (mod.columnFont !== null) {
    const { value, node } = mod.columnFont;
    if (session.fontNames.has(value)) {
      columnFont = value;
    } else {
      diags.add(
        rel,
        sf,
        node,
        `未注册的字体名 "${value}"——Resources/Fonts 里没有对应字体文件（字体名 = 文件名去扩展名）`,
      );
    }
  }

  const registry: FuncRegistry = { refs: new Map(), names: new Map() };
  const shared = {
    mod,
    file: rel,
    diags,
    funcs: registry,
    stateRoot: graph.stateRoot,
    fontNames: session.fontNames,
  };
  const ctx = createBodyCtx(shared, { inFunction: false });
  const { fns: nestedDecls, rest } = partitionFunctions(
    storyDecl.node.body!.statements,
  );
  // 函数声明提升：嵌套名先登记进列根作用域，列体即可引用它们
  for (const nestedDecl of nestedDecls) {
    ctx.scopes[ctx.scopes.length - 1].set(nestedDecl.name!.text, {
      kind: "function",
      file: rel,
    });
  }
  const bodyCommands = translateStatements(ctx, rest);
  // 嵌套函数体继承列根作用域（列级 let/嵌套名只读下传）；列体翻译先完成，声明已齐备
  const nested: CompiledFunction[] = [];
  for (const nestedDecl of nestedDecls) {
    const compiled = compileFunction(
      session,
      graph,
      diags,
      rel,
      [columnId],
      nestedDecl,
      ctx.scopes,
    );
    if (compiled === undefined) continue;
    nested.push(compiled);
  }

  const closure = new Map<string, CompiledFunction>();
  const worklist = [...registry.refs.keys()];
  while (worklist.length > 0) {
    const key = worklist.pop()!;
    if (closure.has(key)) continue;
    const sep = key.indexOf("#");
    const file = key.slice(0, sep);
    const fnName = key.slice(sep + 1);
    const target = graph.records.get(file);
    const decl = target?.functions.get(fnName);
    if (target === undefined || decl === undefined) continue;
    const compiled = compileFunction(session, graph, diags, file, [], decl, []);
    if (compiled === undefined) continue;
    closure.set(key, compiled);
    worklist.push(...compiled.refs);
  }

  const columnNames = new Map<
    string,
    { file: string; line: number; col: number }
  >();
  const registerName = (
    n: string,
    pos: { file: string; line: number; col: number },
  ): void => {
    const prev = columnNames.get(n);
    if (prev !== undefined) {
      diags.add(
        rel,
        sf,
        storyName,
        `同列存在同名 func \`${n}\`：${prev.file}:${prev.line}:${prev.col} 与 ${pos.file}:${pos.line}:${pos.col}`,
      );
      return;
    }
    columnNames.set(n, pos);
  };
  const localGroup: CompiledFunction[] = [...nested];
  const importedGroup: CompiledFunction[] = [];
  for (const compiled of closure.values()) {
    if (compiled.file === rel) localGroup.push(compiled);
    else importedGroup.push(compiled);
  }
  for (const group of [localGroup, importedGroup]) {
    for (const compiled of group) {
      for (const [n, pos] of compiled.allNames) registerName(n, pos);
    }
  }

  const commands: StoryCommand[] = [];
  for (const group of [localGroup, importedGroup]) {
    for (const compiled of [...group].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const op = tryFuncOp(
        sf,
        storyName,
        diags,
        compiled.name,
        compiled.params,
        compiled.body,
      );
      if (op === undefined) continue;
      commands.push(op);
    }
  }
  commands.push(...bodyCommands);

  const story: Story = {
    formatVersion: 1,
    id: columnId,
    entry: columnId,
    columns: [
      {
        id: columnId,
        kind: "flow",
        ...(columnFont !== undefined ? { font: columnFont } : {}),
        commands,
      },
    ],
  };
  return { columnId, sourceRelPath: rel, story };
}
