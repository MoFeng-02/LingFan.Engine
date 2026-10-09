/**
 * collections 族的命令负载结构校验（validateCommand 的族分片）。
 * 只判本族 op 的必填与类型，未知字段不在此拒绝（编辑期 schema 负责）。
 */
import { requireNonEmptyString } from "../guards";
import { isPlainObject } from "../../../shared";

/**
 * 校验本族 op 的负载（6 个 op：`array` `array_push` `array_pop` `dict` `dict_set` `random`）。
 *
 * 入参由分发骨架给出：`cmd` 已收窄为非空 op 的对象，`at` 是报错定位前缀，`issues` 是收集器。
 * 无返回值，问题通过 `issues` 交付；不匹配的 op 直接落到函数末尾，等于放行（结构从简）。
 * 失败表现：不抛异常。必填缺失或类型不符时推一条带 `at` 定位的中文 issue，尽量一次报全本族问题。
 */
export function validateCollectionsCommand(
  cmd: Record<string, unknown>,
  at: string,
  issues: string[],
): void {
  switch (cmd.op) {
    case "array":
      requireNonEmptyString(cmd.key, `${at}.key`, issues);
      if (!Array.isArray(cmd.items)) issues.push(`${at}.items 必须为数组`);
      if (cmd.once !== undefined && typeof cmd.once !== "boolean") {
        issues.push(`${at}.once 必须为布尔`);
      }
      break;
    case "array_push":
      requireNonEmptyString(cmd.key, `${at}.key`, issues);
      if (!("value" in cmd)) issues.push(`${at}.value 必填`);
      break;
    case "array_pop":
      requireNonEmptyString(cmd.key, `${at}.key`, issues);
      break;
    case "dict":
      requireNonEmptyString(cmd.key, `${at}.key`, issues);
      if (!isPlainObject(cmd.value)) issues.push(`${at}.value 必须为对象`);
      if (cmd.once !== undefined && typeof cmd.once !== "boolean") {
        issues.push(`${at}.once 必须为布尔`);
      }
      break;
    case "dict_set":
      requireNonEmptyString(cmd.key, `${at}.key`, issues);
      requireNonEmptyString(cmd.field, `${at}.field`, issues);
      if (!("value" in cmd)) issues.push(`${at}.value 必填`);
      break;
    case "random": {
      if (typeof cmd.seed !== "number" || !Number.isInteger(cmd.seed)) {
        issues.push(`${at}.seed 必须为整数`);
      }
      const range = cmd.range;
      if (
        !Array.isArray(range) ||
        range.length !== 2 ||
        typeof range[0] !== "number" ||
        typeof range[1] !== "number"
      ) {
        issues.push(`${at}.range 必须为 [min, max] 数字数组`);
      }
      requireNonEmptyString(cmd.var, `${at}.var`, issues);
      break;
    }
  }
}
