/**
 * 命令负载的**共享形状谓词**（叶子模块：不依赖任何兄弟校验模块，供分发骨架与各族分片取用）。
 */

/**
 * 实例级 z：命令上的可选 `z` = 单控件实例的层级覆盖。
 * 只允许**非负有限数**（fail-closed：负数 / NaN / Infinity / 字符串一律拒绝）。
 * 仅「拥有独立渲染层」的命令接受该字段（say / menu / input / notify / minigame）。
 */
export function validateInstanceZ(
  cmd: Record<string, unknown>,
  at: string,
  issues: string[],
): void {
  if (cmd.z === undefined) return;
  if (typeof cmd.z !== "number" || !Number.isFinite(cmd.z) || cmd.z < 0) {
    issues.push(`${at}.z 必须为非负有限数（实例级层级）`);
  }
}
