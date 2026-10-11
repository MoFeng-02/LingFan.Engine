import * as ts from "typescript";
import type { StoryCommand } from "@lingfan/engine";
import { script } from "@lingfan/editor";
import type { Binding, DiagBag, ModuleRecord } from "../graph";

export const WORDS = script as unknown as Record<string, (...args: unknown[]) => StoryCommand>;

export interface ScopeEntry {
  kind: "let" | "param" | "index" | "function";
  value?: string | number | boolean;
  file?: string;
}

export type Scope = Map<string, ScopeEntry>;

export interface FuncRegistry {
  refs: Map<string, { file: string; name: string }>;
  names: Map<string, { file: string; line: number; col: number }>;
}

export interface SharedCtx {
  mod: ModuleRecord;
  file: string;
  diags: DiagBag;
  funcs: FuncRegistry;
  /** 状态根名（发现自 `export declare const <根名>: StoryState`；无声明回退 "state"） */
  readonly stateRoot: string;
}

export interface BodyCtx {
  shared: SharedCtx;
  scopes: Scope[];
  breakables: Array<"loop" | "switch">;
  inFunction: boolean;
}

export function diag(ctx: BodyCtx, node: ts.Node, message: string): void {
  ctx.shared.diags.add(ctx.shared.file, ctx.shared.mod.sf, node, message);
}

export function lookupBinding(ctx: BodyCtx, name: string): Binding | undefined {
  return ctx.shared.mod.bindings.get(name);
}

export function lookupScope(ctx: BodyCtx, name: string): ScopeEntry | undefined {
  for (let i = ctx.scopes.length - 1; i >= 0; i -= 1) {
    const hit = ctx.scopes[i].get(name);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

export function declareLocal(ctx: BodyCtx, name: string, entry: ScopeEntry): void {
  ctx.scopes[ctx.scopes.length - 1].set(name, entry);
}

// —— 表达式下沉（引擎文法唯一来源 runtime/expr）——

export function isAssignmentOperator(text: string): boolean {
  return ["=", "+=", "-=", "*=", "/=", "%="].includes(text);
}

export function createBodyCtx(shared: SharedCtx, options: { inFunction: boolean; params?: string[] }): BodyCtx {
  const root: Scope = new Map();
  for (const param of options.params ?? []) root.set(param, { kind: "param" });
  return {
    shared,
    scopes: [root],
    breakables: [],
    inFunction: options.inFunction,
  };
}

export function makeFuncOp(name: string, params: string[], body: StoryCommand[]): StoryCommand {
  return WORDS.func(name, params, body);
}

export function createSharedCtx(mod: ModuleRecord, diags: DiagBag, funcs: FuncRegistry, stateRoot: string): SharedCtx {
  return { mod, file: mod.rel, diags, funcs, stateRoot };
}
