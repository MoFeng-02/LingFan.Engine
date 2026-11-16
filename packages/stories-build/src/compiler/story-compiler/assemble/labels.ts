/**
 * 按需产列：把被 `jump("X")` / `navigate("X")` 指过、却不是故事列的导出函数补成列。
 *
 * 一件事情的两种写法，产物形态不同：
 * - `call`／直接调用 `X()` ⇒ 一条 `func` 命令，运行期是函数帧，内部原子；
 * - `jump("X")`／`navigate("X")` ⇒ 一条**真列**（`kind:"flow"`），逐句可回退。
 *
 * 后者要求 `X` 在列名注册表里，否则类型期就红。这里只补「被引用过的」那些：
 * 没被跳转引用的导出函数仍不产列（纯工具模块不该凭空多出一列）。
 */
import {
  compareOrdinal,
  normalizeUiNames,
  type Story,
  type StoryCommand,
} from "@lingfan-engine/core";
import type { AssembleSession, CompiledStory } from "./types.ts";
import { expandClosure } from "./closure.ts";
import { compileFunction, tryFuncOp } from "./functions.ts";
import { undeclaredMountUis } from "./mount-uis.ts";
import { collectLabelRefs } from "../graph/label-refs.ts";
import type { DiagBag, Graph, ModuleRecord } from "../graph.ts";

/**
 * 收集需要补成列的 label 名并逐条编译。
 *
 * `knownColumnIds` 是已产出的列名（大小写不敏感比对，与列 id 查重同口径）；
 * 与既有列重名的目标直接跳过——列优先，跳转目标本来就是它。
 */
export function compileLabelColumns(
  session: AssembleSession,
  graph: Graph,
  diags: DiagBag,
  knownColumnIds: ReadonlySet<string>,
): CompiledStory[] {
  const out: CompiledStory[] = [];
  const taken = new Set(knownColumnIds);
  for (const ref of collectLabelRefs(graph.records).values()) {
    const lower = ref.name.toLowerCase();
    if (taken.has(lower)) continue;
    const owner = findExportedFunction(graph, ref.name);
    if (owner === undefined) {
      const mod = graph.records.get(ref.file);
      if (mod !== undefined) {
        diags.add(
          ref.file,
          mod.sf,
          ref.node,
          session.texts.labelTargetMissing(ref.name),
        );
      }
      continue;
    }
    taken.add(lower);
    const compiled = compileLabelColumn(session, graph, diags, owner, ref.name);
    if (compiled !== undefined) out.push(compiled);
  }
  return out;
}

/** 跨模块找 `export function <name>` 的落点（按文件码元序，结果确定） */
function findExportedFunction(
  graph: Graph,
  name: string,
): { readonly mod: ModuleRecord; readonly rel: string } | undefined {
  for (const rel of [...graph.records.keys()].sort(compareOrdinal)) {
    const mod = graph.records.get(rel)!;
    if (mod.functions.get(name) === undefined) continue;
    if (mod.exports.get(name)?.kind !== "function") continue;
    return { mod, rel };
  }
  return undefined;
}

function compileLabelColumn(
  session: AssembleSession,
  graph: Graph,
  diags: DiagBag,
  owner: { readonly mod: ModuleRecord; readonly rel: string },
  name: string,
): CompiledStory | undefined {
  const { mod, rel } = owner;
  const decl = mod.functions.get(name);
  if (decl === undefined) return undefined;
  const compiled = compileFunction(session, graph, diags, rel, [], decl, []);
  if (compiled === undefined) return undefined;

  // 该函数体里叫到的其他函数要先进列（`call` 命令按名字查 func 表），
  // 自身不再包一层 func：它的体就是这一列的命令。
  const closure = expandClosure(session, graph, diags, compiled.refs);
  const ops: StoryCommand[] = [];
  for (const item of [...closure.values()].sort((a, b) =>
    compareOrdinal(a.name, b.name),
  )) {
    const op = tryFuncOp(
      mod.sf,
      decl,
      diags,
      item.name,
      item.params,
      item.body,
    );
    if (op !== undefined) ops.push(op);
  }

  const columnUis = normalizeUiNames([...mod.uis.keys()]);
  const commands: StoryCommand[] = [...ops, ...compiled.body];
  const declared = new Set(columnUis);
  for (const missing of undeclaredMountUis(commands, declared)) {
    diags.add(
      rel,
      mod.sf,
      decl,
      `mount("${missing}") 引用了本列未导入的 UI——请在本模块补一条默认导入，` +
        `指向 \`../../ui/${missing}/${missing}.vue\`，否则产物缺这条静态声明`,
    );
  }

  const story: Story = {
    formatVersion: 1,
    id: name,
    entry: name,
    columns: [
      {
        id: name,
        kind: "flow",
        ...(columnUis.length > 0 ? { uis: columnUis } : {}),
        commands,
      },
    ],
  };
  return { columnId: name, sourceRelPath: rel, story };
}
