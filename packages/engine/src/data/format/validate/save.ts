/**
 * save 族的命令负载结构校验（validateCommand 的族分片）。
 * 只判本族 op 的必填与类型，未知字段不在此拒绝（编辑期 schema 负责）。
 */
import { requireNonEmptyString } from "../guards";

/**
 * 校验本族 op 的负载（4 个 op：`save` `load` `save_delete` `auto_save`）。
 *
 * 入参由分发骨架给出：`cmd` 已收窄为非空 op 的对象，`at` 是报错定位前缀，`issues` 是收集器。
 * 无返回值，问题通过 `issues` 交付；不匹配的 op 直接落到函数末尾，等于放行（结构从简）。
 * 失败表现：不抛异常。必填缺失或类型不符时推一条带 `at` 定位的中文 issue，尽量一次报全本族问题。
 */
export function validateSaveCommand(
  cmd: Record<string, unknown>,
  at: string,
  issues: string[],
): void {
  switch (cmd.op) {
    case "save":
      requireNonEmptyString(cmd.slot, `${at}.slot`, issues);
      if (cmd.title !== undefined && typeof cmd.title !== "string") {
        issues.push(`${at}.title 必须为字符串`);
      }
      break;
    case "load":
    case "save_delete":
      requireNonEmptyString(cmd.slot, `${at}.slot`, issues);
      break;
    case "auto_save":
      if (cmd.enabled !== true && cmd.enabled !== false) {
        issues.push(`${at}.enabled 必须为布尔`);
      }
      break;
  }
}
