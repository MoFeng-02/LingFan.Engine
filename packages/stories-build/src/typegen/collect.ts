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
  // 结果绑定名：语句级 `const r = f(1)` 降糖成 call op 后唯一携带声明名的字段——
  // 引擎把 into 无条件声明成调用方局部变量（无带值 return 时绑 null）。
  call: "into",
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
 * 递归走一段命令流，对每个 op 节点调用 `visit` 提取名字：
 * 控制流（if/while/for/switch/when）把内容藏在 body/then/else/cases 里，
 * `func` 自带 body、`call` 带 args，都要照走。`options`/`reward` 不是命令数组，跳过；
 * `cases` 是 `[{ when, body }]`，单独走进每支的 body。
 *
 * 声明名与函数名共用这一个走法（同一套递归机制），各自只换「从节点读哪个名字」的
 * 提取器——避免两套各走各的、日后控制流形态变了只改一处漏一处。
 */
function walkCommands(
  commands: readonly unknown[],
  visit: (command: Record<string, unknown>) => void,
): void {
  for (const command of commands) {
    if (!isRecord(command)) continue;

    visit(command);

    // 容器字段：值为命令数组的（body/then/else 等）
    for (const [field, value] of Object.entries(command)) {
      if (!Array.isArray(value)) continue;
      if (field === "options" || field === "cases" || field === "reward")
        continue;
      walkCommands(value, visit);
    }

    // cases：[{ when: string; body: Command[] }]
    if (Array.isArray(command.cases)) {
      for (const item of command.cases) {
        if (!isRecord(item)) continue;
        if (Array.isArray(item.body)) walkCommands(item.body, visit);
      }
    }
  }
}

/** 声明名提取器：op 的声明名字段 + minigame.reward[].key（奖励发到哪个变量也属插值键域） */
function visitDeclaredName(
  command: Record<string, unknown>,
  into: Set<string>,
): void {
  const declared = readDeclaredName(command);
  if (declared !== undefined) into.add(declared);

  if (Array.isArray(command.reward)) {
    for (const item of command.reward) {
      if (!isRecord(item)) continue;
      if (typeof item.key === "string" && item.key !== "") into.add(item.key);
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
    walkCommands(commands, (command) => visitDeclaredName(command, names));
  }
  return [...names].sort();
}

/** 读一个 func op 的子过程名；非 func、字段缺失或非字符串都忽略 */
function readFuncName(op: unknown): string | undefined {
  if (!isRecord(op)) return undefined;
  if (op.op !== "func") return undefined;
  const value = op.name;
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * 从编译产物的列集合里收集所有子过程名（func op 的 name 字段）。
 *
 * 这些名字进 `FuncNameRegistry`，与列名域（`ColumnNameRegistry`）并集构成 `call`
 * 的目标域——运行期 call 先查 func 表、再查 flow 列，类型面照同一份产物收集，
 * 两侧始终一致。补列出来的 label 是 flow 列（在列名域），func 名在这里，各归其位。
 * 排序去重后返回，与声明名收集同口径。
 */
export function collectFuncNames(
  columns: readonly { readonly commands?: readonly unknown[] }[],
): string[] {
  const names = new Set<string>();
  for (const column of columns) {
    const commands = column.commands;
    if (!Array.isArray(commands)) continue;
    walkCommands(commands, (command) => {
      const name = readFuncName(command);
      if (name !== undefined) names.add(name);
    });
  }
  return [...names].sort();
}
