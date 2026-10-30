import {
  BUILTIN_OP_NAMES,
  MANIFEST_FILE,
  type Story,
} from "@lingfan-engine/core";
import { walkStoryCommands } from "@lingfan-engine/editor";
import {
  defaultStoriesBuildTexts,
  StoryBuildError,
  type StoriesBuildTexts,
} from "../shared/index.ts";
import type { UiImportViolation } from "../ui/scan-imports.ts";

/** 闸门判定的可配置项：文案里出现的目录名（缺省 = 现状；只影响文案，不影响判定） */
export interface GateOptions {
  readonly resourcesDir: string;
  readonly sourcesDir: string;
  /** UI 根目录名（源根的兄弟目录；只用于 `uis` 闸门的文案定位） */
  readonly uiDirName: string;
  /** 文案注入（Partial）；缺省 = 内建缺省文案（即构建层的既有文案） */
  readonly texts?: Partial<StoriesBuildTexts>;
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
  const texts: StoriesBuildTexts = {
    ...defaultStoriesBuildTexts,
    ...options.texts,
  };
  const at = columnLabeler(story);
  const detail = [...unknownOps.entries()]
    .map(([op, pointers]) => {
      const shown = pointers.slice(0, 3).map(at).join("、");
      const more = pointers.length > 3 ? `（共 ${pointers.length} 处）` : "";
      return `  - op "${op}" —— ${shown}${more}`;
    })
    .join("\n");
  throw new StoryBuildError(
    texts.unknownOpsGate(detail, options.resourcesDir, MANIFEST_FILE),
  );
}

/**
 * 列级 `uis` 闸门：产物里出现的每个 UI 名，源里必须有对应实现文件。
 *
 * 判据取 `src/ui/<名>/<名>.<扩展名>`（与导入期同一条落位规则）——名字写错一个字母
 * 在编译期毫无反应，只在宿主预加载落空时表现为「界面闪一下才出现」，很难归因；
 * 构建期对着目录核一遍就把这类笔误变成一次构建失败。
 */
export function assertKnownUis(
  story: Story,
  uiNames: ReadonlySet<string>,
  options: GateOptions,
): void {
  const unknownUis = new Map<string, string[]>();
  story.columns.forEach((column, index) => {
    const uis = column.uis;
    if (!Array.isArray(uis)) return;
    for (const name of uis) {
      if (typeof name !== "string" || uiNames.has(name)) continue;
      const hits = unknownUis.get(name) ?? [];
      hits.push(`/columns/${index}`);
      unknownUis.set(name, hits);
    }
  });
  if (unknownUis.size === 0) return;
  const texts: StoriesBuildTexts = {
    ...defaultStoriesBuildTexts,
    ...options.texts,
  };
  const at = columnLabeler(story);
  const detail = [...unknownUis.entries()]
    .map(
      ([name, pointers]) =>
        `  - ui "${name}" —— ${pointers.map(at).join("、")}`,
    )
    .join("\n");
  throw new StoryBuildError(
    texts.unknownUisGate(detail, options.sourcesDir, options.uiDirName),
  );
}

/**
 * UI import 面闸门（fail-closed）：`src/ui/**` 下任何越界 import 都让构建整体失败。
 *
 * 为什么在构建期拦：UI 不归 stories-build 编译，宿主打包器又拦不住 `@/host/boot`
 * 这类合法路径。越界依赖只在这里可见，放过一次就再也看不见了。
 * 明细每行带 `文件:行` 与说明符，超过 3 处折叠为「（共 N 处）」。
 */
export function assertUiImports(
  violations: readonly UiImportViolation[],
  options: GateOptions,
): void {
  if (violations.length === 0) return;
  const texts: StoriesBuildTexts = {
    ...defaultStoriesBuildTexts,
    ...options.texts,
  };
  const shown = violations
    .slice(0, 3)
    .map(
      (violation) =>
        `  - ${violation.file}:${violation.line} \`${violation.specifier}\` —— ${violation.reason}`,
    );
  const more =
    violations.length > 3 ? `\n  （共 ${violations.length} 处）` : "";
  throw new StoryBuildError(
    texts.uiImportGate(shown.join("\n") + more, options.uiDirName),
  );
}

/**
 * 守卫名闸门（cell 范式的闭合校验）：故事 `guard.fn` 必须都在 cell 注册表键集内。
 * fail-closed 带命令指针定位（编辑器不校验守卫名——构建期兜住）。
 */ export function assertKnownGuards(
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
  const texts: StoriesBuildTexts = {
    ...defaultStoriesBuildTexts,
    ...options.texts,
  };
  const detail = [...unknownGuards.entries()]
    .map(([fn, pointers]) => `  - guard "${fn}" —— ${pointers.join("、")}`)
    .join("\n");
  throw new StoryBuildError(
    texts.unknownGuardsGate(
      detail,
      options.sourcesDir,
      [...unknownGuards.keys()][0],
    ),
  );
}
