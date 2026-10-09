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
import type { CommandOf, ScriptValue } from "../../schema/opSchemas";
import type { CellHandle, KnownGuardName } from "./cells";

export type Stmt = StoryCommand;

// —— 等待与随机 ——

export function wait(
  seconds: number,
  opts?: { skipable?: boolean },
): CommandOf<"wait"> {
  return { op: "wait", seconds, ...opts };
}

/** 定长暂停（不可跳过——可跳过的等待用 `wait(seconds, { skipable: true })`） */
export function pause(seconds: number): CommandOf<"pause"> {
  return { op: "pause", seconds };
}

/** 引擎显式种子随机（R6）：产物 = random op（运行期求值 ⇒ 回溯重放取快照种子） */
export function random(
  seed: number,
  min: number,
  max: number,
  into: string,
): CommandOf<"random"> {
  return { op: "random", seed, range: [min, max], var: into };
}

// —— 跳转与导航 ——

export function jump(target: string): CommandOf<"jump"> {
  return { op: "jump", target };
}

export function navigate(path: string, scene?: string): CommandOf<"navigate"> {
  return { op: "navigate", path, ...(scene === undefined ? {} : { scene }) };
}

// —— 子过程（func / call / ret）——

export function func(
  name: string,
  params: readonly string[],
  body: readonly Stmt[],
): CommandOf<"func"> {
  return { op: "func", name, params: [...params], body: [...body] };
}

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

/** `return` 为 JS 保留字 ⇒ 别名 `ret`（产物 = return op） */
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

/** 条件分支（then-only 最常用形态）：产物 = 干净的 if-op 数据 */
export function when(cond: string, thenBody: readonly Stmt[]): CommandOf<"if"> {
  return { op: "if", cond, then: [...thenBody] };
}

/** 需要 elif/else 的条件分支：返回链（以 `.else(...)` 或 `.end()` 收尾取产物） */
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

export function whileDo(
  cond: string,
  body: readonly Stmt[],
): CommandOf<"while"> {
  return { op: "while", cond, body: [...body] };
}

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

/** `break` 为 JS 语句关键字 ⇒ 别名 `breakLoop` */
export function breakLoop(): CommandOf<"break"> {
  return { op: "break" };
}

/** `continue` 为 JS 语句关键字 ⇒ 别名 `continueLoop` */
export function continueLoop(): CommandOf<"continue"> {
  return { op: "continue" };
}

// —— 运行期守卫与断言 ——

/** 断言：cond 为假 ⇒ engine.error + 状态原样 + 停在当前命令（fail-closed 拦截） */
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
