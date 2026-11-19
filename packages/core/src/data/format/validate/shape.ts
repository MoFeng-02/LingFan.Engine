/**
 * 命令负载的**共享形状谓词**（叶子模块：不依赖任何兄弟校验模块，供分发骨架与各族分片取用）。
 * 可选字段谓词统一「缺省放行、给了就判类型」，与各族内联手写判定同口径。
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

/** 可选布尔字段：缺省放行；给了非布尔（含 null / 字符串）记一条 issue。 */
export function validateOptionalBoolean(
  cmd: Record<string, unknown>,
  field: string,
  at: string,
  issues: string[],
): void {
  if (cmd[field] !== undefined && typeof cmd[field] !== "boolean") {
    issues.push(`${at}.${field} 必须为布尔`);
  }
}

/** 可选有限数字段：缺省放行；给了非数字 / NaN / Infinity 记一条 issue。 */
export function validateOptionalFiniteNumber(
  cmd: Record<string, unknown>,
  field: string,
  at: string,
  issues: string[],
): void {
  const value = cmd[field];
  if (
    value !== undefined &&
    (typeof value !== "number" || !Number.isFinite(value))
  ) {
    issues.push(`${at}.${field} 必须为有限数字`);
  }
}

/** 可选非负有限数字段（fade 等时长 / 间隔）：缺省放行；负数 / 非有限拒绝。 */
export function validateOptionalNonNegativeNumber(
  cmd: Record<string, unknown>,
  field: string,
  at: string,
  issues: string[],
): void {
  const value = cmd[field];
  if (
    value !== undefined &&
    (typeof value !== "number" || !Number.isFinite(value) || value < 0)
  ) {
    issues.push(`${at}.${field} 必须为非负有限数`);
  }
}

/** 必填非负有限数（seek 的 seconds 等定位量）：缺失 / 非数字 / 负数 / 非有限一律拒绝。 */
export function requireNonNegativeFiniteNumber(
  v: unknown,
  at: string,
  issues: string[],
): void {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
    issues.push(`${at} 必须为非负有限数`);
  }
}
