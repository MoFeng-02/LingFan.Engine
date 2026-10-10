import { BUILTIN_OP_NAMES, MANIFEST_FILE, type Story } from "@lingfan/engine";
import { walkStoryCommands } from "@lingfan/editor";
import { StoryBuildError } from "./errors";

/** 闸门判定的可配置项：文案里出现的目录名（缺省 = 现状；只影响文案，不影响判定） */
export interface GateOptions {
  readonly resourcesDir: string;
  readonly sourcesDir: string;
}

/** 指针 → 「列 "id" /columns/N/...」：指针里的列下标映射回列 id，越界则原样返回 */
function columnLabeler(story: Story): (pointer: string) => string {
  const columnIds = story.columns.map((column) => column.id);
  return (pointer: string): string => {
    const index = Number(/^\/columns\/(\d+)/.exec(pointer)?.[1] ?? NaN);
    const id = columnIds[index];
    return id === undefined ? pointer : `列 "${id}" ${pointer}`;
  };
}

/**
 * 扩展 op 闸门（fail-early）：运行期 `unknown-op` 的构建期等价判定。
 * 内建与已声明扩展之外出现的 op 名 = 运行期必 unknown-op ⇒ 构建期即拦截
 * （遍历含嵌套块体——`if.then`/`while.body`/`func.body` 内的命令同样在列；一次报全部，
 * 同一 op 超过 3 处折叠为「（共 N 处）」）。
 */
export function assertKnownOps(
  story: Story,
  extensionOpNames: ReadonlySet<string>,
  options: GateOptions,
): void {
  const unknownOps = new Map<string, string[]>();
  walkStoryCommands(story, (cmd, pointer) => {
    const op = cmd.op;
    if (
      typeof op !== "string" ||
      BUILTIN_OP_NAMES.has(op) ||
      extensionOpNames.has(op)
    ) {
      return;
    }
    const hits = unknownOps.get(op) ?? [];
    hits.push(pointer);
    unknownOps.set(op, hits);
  });
  if (unknownOps.size === 0) return;
  const at = columnLabeler(story);
  const detail = [...unknownOps.entries()]
    .map(([op, pointers]) => {
      const shown = pointers.slice(0, 3).map(at).join("、");
      const more = pointers.length > 3 ? `（共 ${pointers.length} 处）` : "";
      return `  - op "${op}" —— ${shown}${more}`;
    })
    .join("\n");
  throw new StoryBuildError(
    `故事使用了既非内建、也未被清单 extensions 声明扩展提供的 op（运行期必 unknown-op，构建期拦截）：\n${detail}\n` +
      `→ 在 ${options.resourcesDir}/${MANIFEST_FILE} 的 extensions 声明提供该 op 的扩展模块，或改用内建 op`,
  );
}

/**
 * 守卫名闸门（cell 范式的闭合校验）：故事 `guard.fn` ⊆ cell 注册表键集。
 * fail-closed 带命令指针定位（编辑器不校验守卫名——构建期兜住）。
 */
export function assertKnownGuards(
  story: Story,
  guardNames: ReadonlySet<string>,
  options: GateOptions,
): void {
  const unknownGuards = new Map<string, string[]>();
  walkStoryCommands(story, (cmd, pointer) => {
    if (cmd.op !== "guard") return;
    const fn = cmd.fn;
    if (typeof fn !== "string" || guardNames.has(fn)) return;
    const hits = unknownGuards.get(fn) ?? [];
    hits.push(pointer);
    unknownGuards.set(fn, hits);
  });
  if (unknownGuards.size === 0) return;
  const detail = [...unknownGuards.entries()]
    .map(([fn, pointers]) => `  - guard "${fn}" —— ${pointers.join("、")}`)
    .join("\n");
  throw new StoryBuildError(
    `故事使用了未在源内 cell(...) 声明的守卫（运行期必 guard-unknown，构建期拦截）：\n${detail}\n` +
      `→ 在 ${options.sourcesDir} 源里用 cell("${[...unknownGuards.keys()][0]}", impl) 声明实现，或改用已声明的守卫`,
  );
}
