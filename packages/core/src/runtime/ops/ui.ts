/**
 * UI 挂载的执行：把「哪个组件该不该出现在渲染树上、带什么入参」写成状态。
 *
 * 核心只写 `SYS.mounts` 这张表，不碰 DOM、不认识组件内部——挂载与卸载是宿主的活。
 * `visible: false` 的语义是**从渲染树移除**（卸载），不是 `display: none`：
 * 隐藏的组件不该继续跑生命周期与计时器。整表随快照 / 存档 / 回溯自动随行。
 */
import {
  SYS,
  type MountTable,
  type StoryCommand,
} from "../../contracts/index.ts";
import { isMountTable, isUiName, UI_NAME_PATTERN } from "../../shared/index.ts";
import { findJsonValueError } from "../stateContract.ts";
import type { OpContext } from "../internal/index.ts";

/** `mount` 已知负载字段（未知字段 fail-closed） */
const MOUNT_OP_FIELDS: ReadonlySet<string> = new Set([
  "op",
  "name",
  "visible",
  "props",
]);

/** 读挂载表：形状不合（外部改坏）按空表处理，不让一条脏值卡死整个挂载域 */
function mountTableOf(ctx: OpContext): MountTable {
  const value = ctx.get(SYS.mounts);
  return isMountTable(value) ? value : {};
}

/**
 * 挂载 / 卸载一个 UI 组件：`mount(hub, true)`、`mount(hub, false, { scene: "forest" })`。
 *
 * - `visible` 必填布尔：没有「切换」语义，显式写显隐才能让回溯读到确定的终值
 * - `props` 可选：给了就**整份替换**（不是浅合并）——合并语义会让「删掉一个入参」
 *   无法表达，而组件的入参集合是它的契约，得能完整指定
 * - 整表新建后写回：**不得原地改** `table[name]`，否则回溯会拿到被污染的值
 */
export function execMount(ctx: OpContext, cmd: StoryCommand): boolean {
  const unknown = Object.keys(cmd).filter((k) => !MOUNT_OP_FIELDS.has(k));
  if (unknown.length > 0) {
    ctx.fail(
      "mount-unknown-field",
      `mount 未知负载字段：${unknown.join(", ")}`,
    );
    return false;
  }
  const { name, visible } = cmd;
  if (!isUiName(name)) {
    ctx.fail(
      "mount-invalid-name",
      `mount 的 name 不合法：${JSON.stringify(name)}（须匹配 ${UI_NAME_PATTERN.source}）`,
    );
    return false;
  }
  if (typeof visible !== "boolean") {
    ctx.fail(
      "mount-invalid-visible",
      `mount 的 visible 必须是布尔：${JSON.stringify(visible)}`,
    );
    return false;
  }
  const rawProps = cmd.props;
  let props: Record<string, unknown> = {};
  if (rawProps !== undefined) {
    if (
      typeof rawProps !== "object" ||
      rawProps === null ||
      Array.isArray(rawProps)
    ) {
      ctx.fail(
        "mount-invalid-props",
        `mount 的 props 必须是对象：${JSON.stringify(rawProps)}`,
      );
      return false;
    }
    const unsafe = findJsonValueError(rawProps, "mount.props");
    if (unsafe !== null) {
      ctx.fail(
        "mount-unsafe-props",
        `mount 的 props 不是 JSON 安全的值——${unsafe}`,
      );
      return false;
    }
    props = rawProps as Record<string, unknown>;
  }
  const table = mountTableOf(ctx);
  const next: Record<
    string,
    { visible: boolean; props: Record<string, unknown> }
  > = { ...table };
  next[name] = { visible, props };
  ctx.setSystem(SYS.mounts, next satisfies MountTable);
  return true;
}
