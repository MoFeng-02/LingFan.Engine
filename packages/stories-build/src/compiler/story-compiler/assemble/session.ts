import {
  compareOrdinal,
  type CharacterDef,
  type Story,
  type StoryCommand,
} from "@lingfan-engine/core";
import {
  defaultStoriesBuildTexts,
  type StoriesBuildTexts,
} from "../../../shared/index.ts";
import type { DiagBag, Graph } from "../graph.ts";
import { compileFunction, partitionFunctions, tryFuncOp } from "./functions.ts";
import {
  createBodyCtx,
  translateStatements,
  type FuncRegistry,
} from "../translate.ts";
import type {
  AssembleSession,
  CompiledFunction,
  CompiledStory,
} from "./types.ts";

export type { AssembleSession, CompiledStory } from "./types.ts";

/**
 * 会话与列编译：会话持有跨文件共享状态（函数缓存/字体表/文案表/全工程角色表），
 * compileStoryFile 把单个故事文件编译成单列 Story。函数体翻译在 ./functions.ts。
 */

export function createAssembleSession(
  fontNames: ReadonlySet<string> = new Set(),
  texts: StoriesBuildTexts = defaultStoriesBuildTexts,
  characters: ReadonlyMap<string, CharacterDef> = new Map(),
): AssembleSession {
  return { cache: new Map(), fontNames, texts, characters };
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

  // —— 列级字体：声明值对照字体名注册表（fail-closed，与词引用同一组诊断文案）——
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
    texts: session.texts,
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
  // 全工程角色表前置：模块层声明的角色进场即有（注册先于一切命令，含 func）
  for (const def of [...session.characters.values()].sort((a, b) =>
    compareOrdinal(a.key, b.key),
  )) {
    commands.push(characterCommand(def));
  }
  for (const group of [localGroup, importedGroup]) {
    for (const compiled of [...group].sort((a, b) =>
      compareOrdinal(a.name, b.name),
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

/** 模块层角色声明 → character 命令（六字段全可选，有值才投影） */
function characterCommand(def: CharacterDef): StoryCommand {
  const op: StoryCommand = { op: "character", key: def.key };
  if (def.name !== undefined) op.name = def.name;
  if (def.color !== undefined) op.color = def.color;
  if (def.size !== undefined) op.size = def.size;
  if (def.font !== undefined) op.font = def.font;
  if (def.textColor !== undefined) op.textColor = def.textColor;
  if (def.screen !== undefined) op.screen = def.screen;
  return op;
}
