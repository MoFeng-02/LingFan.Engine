/**
 * Script 词汇层 · **流程域**（wait / pause / random / 跳转导航 / func·call / 控制流 /
 * assert / guard）。
 *
 * **控制流是结构化构造，不是 TS 原生语句**：`when(...).then([...])` 产出 if-op
 * **节点**（数据）；TS 原生 `if` 在构建期求值（分支展开成静态数据）——两者语义不同，
 * 按「这一分支是运行期还是构建期」选择。运行期分支的运行期循环同理（whileDo/forIn）。
 *
 * `Stmt` 刻意保持 StoryCommand envelope（**不**收窄为 ScriptCommand）：
 * 块体内建 op 与扩展 op（extOp）混排是合法创作形态，闭合联合会把扩展挡在块体外。
 */
import type { StoryCommand } from "@lingfan/engine";
import type { CommandOf, ScriptValue } from "../../schema";
import type { CellHandle, KnownColumnName, KnownGuardName } from "./cells";

export type Stmt = StoryCommand;

// —— 等待与随机 ——

/**
 * 等待 `seconds` 秒后继续。等待建立时就是回溯检查点；开启 autoSave 时
 * 此处自动存档。
 * @param seconds 等待秒数。
 * @param opts 可选项：skipable 为 true 时玩家可点击/按键提前跳过。
 * @returns `wait` 故事命令。
 * @example
 * wait(2, { skipable: true });
 */
export function wait(
  seconds: number,
  opts?: { skipable?: boolean },
): CommandOf<"wait"> {
  return { op: "wait", seconds, ...opts };
}

/**
 * 定长暂停（不可跳过——可跳过的等待用 {@link wait} 传
 * `{ skipable: true }`）。等待建立时建立回溯检查点。
 * @param seconds 暂停秒数。
 * @returns `pause` 故事命令。
 */
export function pause(seconds: number): CommandOf<"pause"> {
  return { op: "pause", seconds };
}

/**
 * 用显式种子掷一次随机数：把 `[min, max]` **闭区间**内的一个整数写进
 * 变量 `into`。种子同时进入随机状态——回溯重放时序列完全一致。
 * `seed` 必须是整数；`min > max` 报错停机。
 * @param seed 随机种子（整数，决定具体取值）。
 * @param min 下界（含）。
 * @param max 上界（含）。
 * @param into 收纳结果的变量名。
 * @returns `random` 故事命令。
 * @example
 * random(20260101, 1, 6, "dice");
 * say("掷出了 {dice} 点！");
 */
export function random(
  seed: number,
  min: number,
  max: number,
  into: string,
): CommandOf<"random"> {
  return { op: "random", seed, range: [min, max], var: into };
}

// —— 跳转与导航 ——

/**
 * 立即跳进 `target` 列继续（列名即标签，同一故事文件内跳转）。
 * @param target 目标列名（`stories.gen.d.ts` 存在时收窄为工程内列名字面量联合）。
 * @returns `jump` 故事命令。
 * @example
 * when(cond`gold >= 10`, [jump("shop")]);
 */
export function jump(target: KnownColumnName): CommandOf<"jump"> {
  return { op: "jump", target };
}

/**
 * 导航到目标列继续：`scene` 给出时优先（跨章节/场景跳转），缺省用
 * `path`。跳转前会清掉旧列的对话残留画面；不建立检查点。
 * @param path 目标列名（缺省目标）。
 * @param scene 目标列名（显式给出时优先于 path）。
 * @returns `navigate` 故事命令。
 * @example
 * navigate("ep2_gate", "ep2");
 */
export function navigate(
  path: KnownColumnName,
  scene?: KnownColumnName,
): CommandOf<"navigate"> {
  return { op: "navigate", path, ...(scene === undefined ? {} : { scene }) };
}

// —— 子过程（func / call / ret）——

/**
 * 注册一个具名子过程：执行到这里时把 `body` 挂进函数表，之后用
 * {@link call} 调用。对同名重复注册报错（除非两次定义完全相同）。
 * @param name 子过程名（call 时引用）。
 * @param params 形参名列表（call 的实参按位绑定进来）。
 * @param 子过程体（一组故事命令）。
 * @returns `func` 故事命令。
 * @example
 * func("greet", ["who"], [say("你好，{who}！")]);
 * call("greet", ["阿岚"]);
 */
export function func(
  name: string,
  params: readonly string[],
  body: readonly Stmt[],
): CommandOf<"func"> {
  return { op: "func", name, params: [...params], body: [...body] };
}

/**
 * 调用 {@link func} 注册的子过程（或跳到普通流程列）：实参逐项求值后
 * 按位绑定给形参，过程体跑完（或 {@link ret}）后回到调用点继续。
 * 参数个数对不上报错停机。
 * @param target 子过程名或目标列名。
 * @param args 实参列表（字面量或 `"{expr}"` 表达式串，按位绑定）。
 * @returns `call` 故事命令。
 * @example
 * call("greet", ["阿岚"]);
 */
export function call(
  target: string,
  args?: readonly ScriptValue[],
): CommandOf<"call"> {
  return {
    op: "call",
    target,
    ...(args === undefined ? {} : { args: [...args] }),
  };
}

/**
 * 从子过程返回到调用点。在子过程（func 体）之外使用报错停机。
 * @returns `return` 故事命令。
 * @example
 * func("early", [], [when(cond`hp <= 0`, [ret()]), say("继续")]);
 */
export function ret(): CommandOf<"return"> {
  return { op: "return" };
}

// —— 条件分支（双入口）——
// 为什么不做一个可链式的 when：链式方法名（elif/else）与 if-op 的**数据字段同名**
//    ——方法挂上命令对象后，读字段读到的是方法（elifs.push is not a function），
//    未收尾的链放进命令数组还会把函数属性带进 Story ⇒ build 期响亮报错。
//    拆两个入口：`when` 覆盖最常用（then-only，干净数据直出）；`whenChain` 才有链式。

export interface IfChain {
  elif(cond: string, body: readonly Stmt[]): IfChain;
  else(body: readonly Stmt[]): Stmt;
  /** elif 链收尾（无 else 分支时）——产物 = 最终 if 数据 */
  end(): Stmt;
}

/**
 * 运行期条件分支（then-only 最常用形态）：执行到这里时求值 `cond`，
 * 为真才执行 `thenBody`（分支体在新块作用域里执行）。
 *
 * `cond` 是条件表达式：用 {@link cond} 标签串接变量（如
 * `cond\`gold >= 10\``），或直接写 `"{gold >= 10}"`；表达式必须产出
 * 布尔值，否则报错停机。
 *
 * @param cond 条件表达式（运行期求值，须为布尔）。
 * @param thenBody 条件成立时执行的一组命令。
 * @returns `if` 故事命令。
 * @example
 * when(cond`gold >= 10`, [
 *   say("买下了药水。"),
 *   set("gold", "-= 10"),
 * ]);
 */
export function when(cond: string, thenBody: readonly Stmt[]): CommandOf<"if"> {
  return { op: "if", cond, then: [...thenBody] };
}

/**
 * 需要 elif / else 的条件分支：先给条件与 then 体，再链上
 * `.elif(cond, body)`、以 `.else(body)` 或 `.end()` 收尾取产物。
 * 各分支条件都在运行期依次求值，命中第一个为真的分支。
 * @param cond 首个条件表达式（运行期求值，须为布尔）。
 * @param thenBody 首个条件成立时执行的一组命令。
 * @returns 分支链（以 `.else(...)` 或 `.end()` 收尾产出 `if` 故事命令）。
 * @example
 * whenChain(cond`mood > 5`, [say("今天心情不错。")])
 *   .elif(cond`mood > 0`, [say("还过得去。")])
 *   .else([say("唉……")]);
 */
export function whenChain(cond: string, thenBody: readonly Stmt[]): IfChain {
  const then = [...thenBody];
  const elifs: Array<{ cond: string; then: Stmt[] }> = [];
  let elseBody: Stmt[] | undefined;
  const build = (): Stmt => {
    const out: Record<string, unknown> = { op: "if", cond, then };
    if (elifs.length > 0) out.elif = elifs;
    if (elseBody !== undefined) out.else = elseBody;
    return out as unknown as Stmt;
  };
  const chain: IfChain = {
    elif(c, body) {
      elifs.push({ cond: c, then: [...body] });
      return chain;
    },
    else(body) {
      elseBody = [...body];
      return build();
    },
    end() {
      return build();
    },
  };
  return chain;
}

// —— 循环（while / for / foreach）——

/**
 * 运行期 while 循环：每轮重新求值 `cond`，为真就执行一轮 `body`
 * （体在新块作用域里执行）。条件必须产出布尔值。注意别写出永真条件。
 * @param cond 每轮重判的条件表达式（须为布尔）。
 * @param body 每轮执行的一组命令。
 * @returns `while` 故事命令。
 * @example
 * whileDo(cond`hunger < 100`, [eat()]);
 */
export function whileDo(
  cond: string,
  body: readonly Stmt[],
): CommandOf<"while"> {
  return { op: "while", cond, body: [...body] };
}

/**
 * 运行期 for 循环：把 `iterable` 求值（必须得到数组），逐元素赋给
 * `varName`（块级临时变量，出循环即销毁）并执行一轮 `body`。
 * @param varName 循环变量名（每轮接收当前元素）。
 * @param iterable 数组表达式（求值结果必须是数组）。
 * @param body 每个元素执行的一组命令。
 * @returns `for` 故事命令。
 * @example
 * forIn("item", "backpack", [say("背包里有：{item}")]);
 */
export function forIn(
  varName: string,
  iterable: string,
  body: readonly Stmt[],
): CommandOf<"for"> {
  return { op: "for", var: varName, in: iterable, body: [...body] };
}

/**
 * foreach：`collection` = 集合**变量名**（运行期按名 resolve，须为数组）。
 * 形状 = 规范四事实（`data/format/` 校验 / foreachSchema / parseTextStory 产物 /
 * generateText 投影）：`{var, key, body}`——`in` 是 DSL 行文法（`foreach "v" in "k"`）
 * 的分隔符，**不属于 op 数据**（`in` 字段属于 `for` op）；多产 `in` 会被编辑器
 * 判 unknown-field。漏 `key` parseStory 即拒（执行层以 key resolve，互锁测试锚定）。
 *
 * 逐元素迭代：每轮把当前元素赋给 `varName`（块级临时变量）再执行 `body`。
 *
 * @param varName 循环变量名（每轮接收当前元素）。
 * @param collection 集合**变量名**（运行期按名取数组）。
 * @param body 每个元素执行的一组命令。
 * @returns `foreach` 故事命令。
 * @example
 * forEach("item", "party", [say("{item} 入队了。")]);
 */
export function forEach(
  varName: string,
  collection: string,
  body: readonly Stmt[],
): CommandOf<"foreach"> {
  return {
    op: "foreach",
    var: varName,
    key: collection,
    body: [...body],
  };
}

// —— 多路分支与循环控制 ——

/**
 * 运行期多路分支：把 `on` 求值后与各 `cases` 的取值做相等比较，命中
 * 哪个就执行哪个分支体（不穿透、不fall-through）；都不命中走
 * `defaultBody`（未给则直接继续）。
 * @param on 被比较的表达式（运行期求值）。
 * @param cases 分支表：`[取值, 分支体]` 对。
 * @param defaultBody 都不命中时执行的命令（可省略）。
 * @returns `switch` 故事命令。
 * @example
 * switchOn("{choice}", [
 *   ["inn", [navigate("to_inn")]],
 *   ["shop", [navigate("to_shop")]],
 * ], [say("原地待命。")]);
 */
export function switchOn(
  on: string,
  cases: ReadonlyArray<readonly [ScriptValue, readonly Stmt[]]>,
  defaultBody?: readonly Stmt[],
): CommandOf<"switch"> {
  return {
    op: "switch",
    on,
    cases: cases.map(([value, body]) => ({ value, body: [...body] })),
    ...(defaultBody === undefined ? {} : { default: [...defaultBody] }),
  };
}

/**
 * 跳出当前所在循环（while / for / foreach）。在循环体之外使用报错停机。
 * @returns `break` 故事命令。
 * @example
 * whileDo(cond`true`, [when(cond`found`, [breakLoop()]), search()]);
 */
export function breakLoop(): CommandOf<"break"> {
  return { op: "break" };
}

/**
 * 结束当前这一轮循环，直接进入下一轮条件判断。在循环体之外使用报错停机。
 * @returns `continue` 故事命令。
 * @example
 * forIn("x", "list", [when(cond`x == 0`, [continueLoop()]), use(x)]);
 */
export function continueLoop(): CommandOf<"continue"> {
  return { op: "continue" };
}

// —— 运行期守卫与断言 ——

/**
 * 运行期断言：`cond` 求值为假时故事报错停机（状态原样、停在当前命令），
 * 为真则直接继续。用于给作者捕获「不该发生」的状态。
 * @param cond 断言条件表达式（须为布尔）。
 * @param message 报错附带的说明（可省略）。
 * @returns `assert` 故事命令。
 * @example
 * assert(cond`gold >= 0`, "金币不应为负");
 */
export function assert(cond: string, message?: string): CommandOf<"assert"> {
  return { op: "assert", cond, ...(message === undefined ? {} : { message }) };
}

export interface GuardOptions {
  /** 纯数据参数（JSON 安全——嵌套对象/数组合法，运行期 findJsonValueError 兜底） */
  args?: Record<string, unknown>;
}

/**
 * 运行期守卫：调用组合根注册的 `(ctx, args)` 纯函数（未注册名 ⇒ fail-closed）。
 * 名字参数接受**字面量**（注册表有声明 ⇒ 字面量联合，补全 + 写错即红；空表 = 普通
 * string）或 **cell 句柄**（名字只写一次——声明点即引用点）。
 *
 * 值口径原则：**被求值的走 `Value`**（call args / reward /
 * set——运行期表达式求值，标量语义）；**被运输的走 JSON**（guard args /
 * minigame config——原样透传宿主，JSON 安全校验兜底）。guardSchema.args 已对齐。
 *
 * 运行期行为：守卫通过 = 故事直接继续（不改任何状态）；守卫返回失败、
 * 抛错、或名字未在组合根注册时，故事报错停机（fail-closed）。
 *
 * @param fn 守卫名（字面量联合，补全友好）或 {@link cell} 声明的句柄。
 * @param opts 可选项：args 传给守卫的纯数据参数（JSON 安全）。
 * @returns `guard` 故事命令。
 * @example
 * guard("checkMoney", { args: { cost: 50 } });
 */
export function guard(
  fn: KnownGuardName | CellHandle,
  opts?: GuardOptions,
): CommandOf<"guard"> {
  return {
    op: "guard",
    fn: typeof fn === "string" ? fn : fn.name,
    ...(opts?.args === undefined ? {} : { args: { ...opts.args } }),
  };
}
