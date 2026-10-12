import { StoryBuildError } from "../shared";

/**
 * story-compiler 契约（编译器下游的唯一对接面）：
 * `compileStories({ root, sourcesDir, stories, modules })` 一次性编译全部故事文件，
 * 产物 = 列粒度条目（`columnId` + `sourceRelPath` + `story`）+ 诊断集。
 * 诊断非空 = fail-closed（编排层一次报全部）；`story` 为 parseStory 同形结构。
 */
export interface CompiledStoryEntry {
  /** 该条目对应的列 id（须存在于 `story.columns`） */
  readonly columnId: string;
  /** 源文件相对 `Stories.src/` 的 posix 路径（如 `chapters/prologue.ts`） */
  readonly sourceRelPath: string;
  /** parseStory 同形结构（引擎 Story；条目为列粒度） */
  readonly story: unknown;
}

export interface CompilerDiagnostic {
  readonly file: string;
  readonly line: number;
  readonly col: number;
  readonly message: string;
}

export interface CompiledStories {
  readonly stories: readonly CompiledStoryEntry[];
  readonly diags: readonly CompilerDiagnostic[];
  /**
   * 全工程 `defineVars({...})` 清单里的变量键（已合并去重排序）。
   *
   * 类型面生成器的数据源之一。可选：注入式合成编译器（测试缝）不产这份数据，
   * 那样类型面的变量键域退化为 empty——与「工程里没有 defineVars」同义。
   */
  readonly defineVarsKeys?: readonly string[];
}

/**
 * 编译期求值喂入（§十二）：文件相对 `Stories.src/` 的 posix 路径 → 导出名 →
 * 求值出的 JSON 可序列化值。由编排层求值段（const-eval-pass）填充；缺省 =
 * 没有被求值的文件，编译器行为与未接入求值时逐字一致。
 */
export type CompilerConstValues = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

export interface StoriesCompiler {
  compileStories(input: {
    readonly root: string;
    readonly sourcesDir: string;
    /** 故事文件清单（相对 `Stories.src/`，posix；default 导出 Story 的 .ts） */
    readonly stories: readonly string[];
    /** 模块文件清单（相对 `Stories.src/`，posix；被 import 的支撑 .ts） */
    readonly modules: readonly string[];
    /** 编译期求值喂入（§十二）；缺省 = 无被求值文件（行为不变） */
    readonly constValues?: CompilerConstValues;
  }): CompiledStories | Promise<CompiledStories>;
}

/**
 * 默认编译器装载：`./story-compiler.ts`（本域内的编译器实现；文件缺席 = fail-closed 带指引）。
 *
 * 这里写死带扩展名的相对路径，不走 bundler 式的无扩展名解析：本仓源码由 tsx/Node 直接跑
 * TypeScript，Node 的 ESM 解析不补 `.ts`，无扩展名会解析失败。
 */
export async function loadDefaultCompiler(): Promise<StoriesCompiler> {
  const specifier = "./story-compiler.ts";
  try {
    const mod = (await import(specifier)) as {
      compileStories?: StoriesCompiler["compileStories"];
    };
    if (typeof mod.compileStories !== "function") {
      throw new Error("模块缺 compileStories 导出");
    }
    return { compileStories: mod.compileStories };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new StoryBuildError(
      `story-compiler 未就绪（${specifier} 装载失败：${message}）——编排契约已按 compileStories 收敛，等待编译器交付对接`,
    );
  }
}
