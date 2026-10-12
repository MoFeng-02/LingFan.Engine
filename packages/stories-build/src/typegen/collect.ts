/**
 * 声明名收集：从产物 op 流里把「作者声明过的名字」捞出来。
 *
 * 这些名字是运行期变量表的内容（`{ticket}`、`{thing}` 这类插值键），既不在 stateSchema
 * 里也不在 defineVars 清单里，只能从编译产物读——这正是「插值键校验漏报」最容易漏的一类。
 * 字段名是引擎 op 契约，逐类照着 op 定义写死；出现新 op 时在此补一行即可。
 */

/** 声明名所在的字段：op → 该 op 里承载名字的字段名 */
const DECL_NAME_FIELDS: Readonly<Record<string, string>> = {
  set: "key",
  define: "key",
  let: "key",
  local: "key",
  undef: "key",
  array: "key",
  array_push: "key",
  array_pop: "key",
  dict: "key",
  dict_set: "key",
  for: "var",
  foreach: "var",
  random: "var",
  input: "store",
  minigame: "game",
};

/** op 名 → 名字取值的键；无映射返回 undefined */
function declaredFieldOf(op: string): string | undefined {
  return DECL_NAME_FIELDS[op];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 读一个 op 的声明名；字段缺失或非字符串都忽略（产物形态异常不在本模块职责内） */
function readDeclaredName(op: unknown): string | undefined {
  if (!isRecord(op)) return undefined;
  const opName = op.op;
  if (typeof opName !== "string") return undefined;
  const field = declaredFieldOf(opName);
  if (field === undefined) return undefined;
  const value = op[field];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * 递归收集一段命令流里的声明名：
 * 控制流（if/while/for/switch/when）把名字藏在 body/then/else/cases 里，
 * `func` 自带 body、`call` 带 args，都要照走；`minigame.reward[].key` 是奖励发到哪个变量。
 */
function collectFromCommands(
  commands: readonly unknown[],
  into: Set<string>,
): void {
  for (const command of commands) {
    if (!isRecord(command)) continue;

    const declared = readDeclaredName(command);
    if (declared !== undefined) into.add(declared);

    // 容器字段：值为命令数组的（body/then/else 等）
    for (const [field, value] of Object.entries(command)) {
      if (!Array.isArray(value)) continue;
      if (field === "options" || field === "cases" || field === "reward")
        continue;
      collectFromCommands(value, into);
    }

    // cases：[{ when: string; body: Command[] }]
    if (Array.isArray(command.cases)) {
      for (const item of command.cases) {
        if (!isRecord(item)) continue;
        if (Array.isArray(item.body)) collectFromCommands(item.body, into);
      }
    }

    // reward：[{ key: string; amount: number }]——奖励发到哪个变量也属插值键域
    if (Array.isArray(command.reward)) {
      for (const item of command.reward) {
        if (!isRecord(item)) continue;
        if (typeof item.key === "string" && item.key !== "") into.add(item.key);
      }
    }
  }
}

/**
 * 从编译产物的列集合里收集所有声明名。
 * 排序去重后返回——同输入同输出是渲染器零随机的前提。
 */
export function collectDeclaredNames(
  columns: readonly { readonly commands?: readonly unknown[] }[],
): string[] {
  const names = new Set<string>();
  for (const column of columns) {
    const commands = column.commands;
    if (!Array.isArray(commands)) continue;
    collectFromCommands(commands, names);
  }
  return [...names].sort();
}
