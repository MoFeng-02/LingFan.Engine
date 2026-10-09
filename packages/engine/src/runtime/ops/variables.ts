/**
 * 变量与随机数命令的执行：set / let / local、define、undef、array 系列、dict 系列、random。
 *
 * 变量的落点分两层：`set` 先沿当前作用域链找同名声明，找到就写那一层，找不到才落全局；
 * `let` / `local` 则总是声明进当前最内层作用域。块/列级作用域随帧出栈销毁，也不进存档；
 * 全局层就是执行器的状态容器本体，随快照、存档、回溯一起随行。
 *
 * 负载值统一经表达式求值（`{...}` 包裹的走表达式，其余按字面量），求值失败当场停机，
 * 不猜一个默认值继续跑。
 */
import type { StoryCommand } from "../../contracts";
import { ExpressionError, type ExprValue } from "../expr";
import type { Frame, OpContext } from "../internal";

/** set 复合赋值前缀（value 支持 {expr} 与 += 等复合赋值） */
const COMPOUND_PREFIX = /^\s*(\+=|-=|\*=|\/=|%=)\s*([\s\S]+)$/;

/**
 * set/let/local：
 * - set：写入声明时所在层，未声明 → 全局（状态容器本体）；支持 += 等复合赋值
 * - let/local：块级可变，声明进当前最内层作用域
 */
export function execAssign(
  ctx: OpContext,
  frame: Frame,
  cmd: StoryCommand,
  op: string,
): boolean {
  const key = cmd.key as string;
  try {
    const compound =
      op === "set" && typeof cmd.value === "string"
        ? COMPOUND_PREFIX.exec(cmd.value)
        : null;
    let value: ExprValue;
    if (compound) {
      const sym = compound[1]!;
      const rhs = ctx.evalValue(compound[2]);
      const current = ctx.readVariable(key);
      if (typeof current !== "number" || typeof rhs !== "number") {
        throw new ExpressionError("type-error", `复合赋值 ${sym} 只支持 number`);
      }
      value = applyCompound(sym, current, rhs);
    } else {
      value = ctx.evalValue(cmd.value);
    }
    if (op === "set") {
      const scope = ctx.frames[ctx.frames.length - 1]?.scope;
      // 装载顺序声明层优先；未声明落全局（状态容器本体）
      if (scope !== undefined && scope.assignExisting(key, value)) {
        ctx.emit(key, value, frame.columnId === null ? "block" : "column");
      } else {
        ctx.setGlobal(key, value);
      }
    } else {
      frame.scope.declare(key, value);
      ctx.emit(key, value, frame.columnId === null ? "block" : "column");
    }
    return true;
  } catch (e) {
    if (e instanceof ExpressionError) {
      ctx.fail(e.code, e.message);
      return false;
    }
    throw e;
  }
}

/** 复合赋值的算术本体；除数为 0 是硬错误（不产出 Infinity/NaN 污染状态） */
function applyCompound(sym: string, current: number, rhs: number): number {
  switch (sym) {
    case "+=":
      return current + rhs;
    case "-=":
      return current - rhs;
    case "*=":
      return current * rhs;
    case "/=":
      if (rhs === 0)
        throw new ExpressionError("division-by-zero", "'/=' 除数为 0");
      return current / rhs;
    default:
      if (rhs === 0)
        throw new ExpressionError("division-by-zero", "'%=' 除数为 0");
      return current % rhs;
  }
}

/** define：全局 + once——不存在才设 */
export function execDefine(ctx: OpContext, cmd: StoryCommand): boolean {
  const key = cmd.key as string;
  try {
    const value = ctx.evalValue(cmd.value);
    if (!ctx.state.has(key)) ctx.setGlobal(key, value);
    return true;
  } catch (e) {
    if (e instanceof ExpressionError) {
      ctx.fail(e.code, e.message);
      return false;
    }
    throw e;
  }
}

/** undef：销毁声明槽；沿块/列作用域链与全局层查找 */
export function execUndef(
  ctx: OpContext,
  frame: Frame,
  cmd: StoryCommand,
): boolean {
  const key = cmd.key as string;
  const inScope = frame.scope.undef(key);
  const inGlobal = ctx.state.delete(key);
  if (!inScope && !inGlobal) {
    ctx.fail("unknown-variable", `undef：未定义变量 ${key}`);
    return false;
  }
  ctx.emit(key, undefined, frame.columnId === null ? "block" : "column");
  return true;
}

/** array：key + items[]（项可为 {expr}）；once → 已存在跳过 */
export function execArray(ctx: OpContext, cmd: StoryCommand): boolean {
  const key = cmd.key as string;
  try {
    if (cmd.once === true && ctx.state.has(key)) return true;
    const items = (cmd.items as unknown[]).map((item) => ctx.evalValue(item));
    ctx.setGlobal(key, items);
    return true;
  } catch (e) {
    if (e instanceof ExpressionError) {
      ctx.fail(e.code, e.message);
      return false;
    }
    throw e;
  }
}

export function execArrayPush(ctx: OpContext, cmd: StoryCommand): boolean {
  const key = cmd.key as string;
  try {
    const arr = ctx.state.get(key);
    if (!Array.isArray(arr)) {
      ctx.fail("type-error", `array_push 目标 ${key} 不存在或不是数组`);
      return false;
    }
    const value = ctx.evalValue(cmd.value);
    ctx.setGlobal(key, [...arr, value]); // 新数组引用，观察者可感知
    return true;
  } catch (e) {
    if (e instanceof ExpressionError) {
      ctx.fail(e.code, e.message);
      return false;
    }
    throw e;
  }
}

export function execArrayPop(ctx: OpContext, cmd: StoryCommand): boolean {
  const key = cmd.key as string;
  const arr = ctx.state.get(key);
  if (!Array.isArray(arr) || arr.length === 0) {
    ctx.fail("type-error", `array_pop 目标 ${key} 不存在、非数组或已空`);
    return false;
  }
  ctx.setGlobal(key, arr.slice(0, -1));
  return true;
}

/** dict：value 为 JSON 对象字面量（字段值可为 {expr}）；once 同 array */
export function execDict(ctx: OpContext, cmd: StoryCommand): boolean {
  const key = cmd.key as string;
  try {
    if (cmd.once === true && ctx.state.has(key)) return true;
    const value: Record<string, ExprValue> = {};
    for (const [field, v] of Object.entries(
      cmd.value as Record<string, unknown>,
    )) {
      value[field] = ctx.evalValue(v);
    }
    ctx.setGlobal(key, value);
    return true;
  } catch (e) {
    if (e instanceof ExpressionError) {
      ctx.fail(e.code, e.message);
      return false;
    }
    throw e;
  }
}

export function execDictSet(ctx: OpContext, cmd: StoryCommand): boolean {
  const key = cmd.key as string;
  try {
    const dict = ctx.state.get(key);
    if (dict === null || typeof dict !== "object" || Array.isArray(dict)) {
      ctx.fail("type-error", `dict_set 目标 ${key} 不存在或不是字典`);
      return false;
    }
    const value = ctx.evalValue(cmd.value);
    ctx.setGlobal(key, {
      ...(dict as Record<string, ExprValue>),
      [cmd.field as string]: value,
    });
    return true;
  } catch (e) {
    if (e instanceof ExpressionError) {
      ctx.fail(e.code, e.message);
      return false;
    }
    throw e;
  }
}

/** random op（显式种子）：重置 rngState 为种子 → 抽值 → 写入 var */
export function execRandom(ctx: OpContext, cmd: StoryCommand): boolean {
  const seed = cmd.seed;
  const range = cmd.range;
  const key = cmd.var;
  if (typeof seed !== "number" || !Number.isInteger(seed)) {
    ctx.fail("type-error", "random 的 seed 必须为整数");
    return false;
  }
  if (
    !Array.isArray(range) ||
    range.length !== 2 ||
    typeof range[0] !== "number" ||
    typeof range[1] !== "number"
  ) {
    ctx.fail("type-error", "random 的 range 必须为 [min, max] 数字数组");
    return false;
  }
  if (typeof key !== "string" || key === "") {
    ctx.fail("type-error", "random 的 var 必须为非空字符串");
    return false;
  }
  const min = range[0]!;
  const max = range[1]!;
  if (min > max) {
    ctx.fail("invalid-range", "random 下界必须 ≤ 上界");
    return false;
  }
  // 种子进状态：同一份故事在回溯重放时抽到同一串值
  ctx.rngState = seed | 0;
  ctx.setGlobal(key, drawInt(ctx, min, max));
  return true;
}

/** 闭区间整数抽取（含两端） */
function drawInt(ctx: OpContext, min: number, max: number): number {
  return min + Math.floor(ctx.draw() * (max - min + 1));
}
