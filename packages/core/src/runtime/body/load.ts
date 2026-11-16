/**
 * 列身体的状态写入：进列时把 `column.body` 对账进 `SYS.body`。
 *
 * 为什么放在运行层而不是命令层：身体是列的静态声明，不是作者写的 op——进列即生效，
 * 因此也随快照 / 存档 / 回溯自动换回（那三条路径都整表替换状态）。
 *
 * 三个刻意的取舍：
 * - **无身体时删键，不写 `undefined`**：写 `undefined` 会让存档序列化出 `null`，读档后
 *   拿到的是 `null` 而不是「键不存在」，宿主一处判 `undefined`、一处判 `null` 就会分叉
 * - **删键同时补一次变更通知**：只删不发，订阅该键的宿主收不到清空，会继续画上一个
 *   身体——删键与写值必须是同一个可观察动作，宿主只认变更通知这一条通道
 * - **形状相同不重写**：进列在读档重放、同列重进时会被反复调用，每次都写会发一次变更
 *   通知，宿主据此重挂组件——Vue 侧表现为组件实例被销毁重建，本地输入框草稿丢失、
 *   动画被打断。比较后再写是「声明式对账」，不是「命令式重装」
 */
import {
  SYS,
  type ColumnBody,
  type StoryColumn,
} from "../../contracts/index.ts";
import { isPlainObject } from "../../shared/guards.ts";
import type { OpContext } from "../internal/context.ts";

/** 状态里的身体值是否合法：`name` 为字符串，`props` 缺省或为普通对象 */
function isBodyState(value: unknown): value is ColumnBody {
  if (!isPlainObject(value)) return false;
  if (typeof value.name !== "string") return false;
  const props = value.props;
  return props === undefined || isPlainObject(props);
}

/**
 * 两层等价判定：一层键用 `===` 比较，更深层用 JSON 串比较。
 *
 * 串比较之所以安全：`props` 已通过构建期的 JSON 安全校验，运行期不会出现函数、
 * `undefined`、循环引用这类串表示有歧义的值。
 */
function shallowEqualJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    const a = left[key];
    const b = right[key];
    if (a === b) continue;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (JSON.stringify(a) !== JSON.stringify(b)) return false;
      continue;
    }
    if (isPlainObject(a) && isPlainObject(b)) {
      if (JSON.stringify(a) !== JSON.stringify(b)) return false;
      continue;
    }
    return false;
  }
  return true;
}

/** 两份身体是否等价（等价即不必重写，宿主不必重挂） */
function sameBody(prev: unknown, next: ColumnBody): boolean {
  if (!isPlainObject(prev) || !isPlainObject(next)) return prev === next;
  return prev.name === next.name && shallowEqualJson(prev.props, next.props);
}

/** 诊断用：尽量给出收到的值（脏数据可能不可序列化），取不到就退回类型名 */
function describe(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return typeof value;
  }
}

/**
 * 把当前列的身体对账进 `SYS.body`（`SYS.body` 只在这里写）。
 *
 * **画面归 scene 列**：`scene` 列是「这一屏」，进它就重新决定谁画——声明了 `body`
 * 就换上，没声明就清空（那种列用 `elements` 画自己的东西）。`flow` 列是纯流程，
 * 它**不改画面**：没声明 `body` 就原样留着上一个画面，声明了才换。
 *
 * 这条分流是「写一句话不该换掉整屏」的唯一实现点：对话列通常是 `flow`，
 * 它没声明身体，于是 `navigate` 进对话列时玩家仍然看见那间屋子，而对话本身
 * 在自己的列里逐句成检查点（列帧自带列坐标），因此逐句可回退。作者不必为了让
 * 画面别闪而给每条对话列复述一遍身体。
 *
 * 形状非法的旧值（典型来源：手工改过的存档）出站 `body-invalid` 诊断后，仍按列的声明
 * 重写——脏值自愈，错误只作诊断，不让一屏坏数据卡死叙事。
 */
export function loadBody(ctx: OpContext, column: StoryColumn): void {
  const body = column.body;
  if (body === undefined) {
    // flow 列不声明身体 = 这一列不管画面，保持上一个画面
    if (column.kind === "flow") return;
    if (ctx.state.has(SYS.body)) {
      // 删键与通知成对：宿主只靠变更通知得知这一屏没人画了
      ctx.state.delete(SYS.body);
      ctx.emit(SYS.body, undefined, "system");
    }
    return;
  }
  const next: ColumnBody =
    body.props === undefined
      ? { name: body.name }
      : { name: body.name, props: body.props };
  const prev = ctx.get(SYS.body);
  if (prev !== undefined && !isBodyState(prev)) {
    ctx.fail(
      "body-invalid",
      `SYS.body 形状非法（列 ${column.id}）：期望 { name: string; props?: object }，收到 ${describe(prev)}`,
    );
  }
  if (!sameBody(prev, next)) ctx.setSystem(SYS.body, next);
}
