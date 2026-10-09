/**
 * present 族的命令负载结构校验（validateCommand 的族分片）。
 * 只判本族 op 的必填与类型，未知字段不在此拒绝（编辑期 schema 负责）。
 */
import { requireNonEmptyString } from "../guards";
import { isPlainObject } from "../../../shared";

/**
 * 校验本族 op 的负载（12 个 op：`show` `hide` `background` `bg_switch` `zindex` `style` `window` `animate` `animate_block` `transition` `shake` `text_typewriter`）。
 *
 * 入参由分发骨架给出：`cmd` 已收窄为非空 op 的对象，`at` 是报错定位前缀，`issues` 是收集器。
 * 无返回值，问题通过 `issues` 交付；不匹配的 op 直接落到函数末尾，等于放行（结构从简）。
 * 失败表现：不抛异常。必填缺失或类型不符时推一条带 `at` 定位的中文 issue，尽量一次报全本族问题。
 */
export function validatePresentCommand(
  cmd: Record<string, unknown>,
  at: string,
  issues: string[],
): void {
  switch (cmd.op) {
    case "show":
      requireNonEmptyString(cmd.target, `${at}.target`, issues);
      if (cmd.background !== undefined && typeof cmd.background !== "boolean") {
        issues.push(`${at}.background 必须为布尔`);
      }
      break;
    case "hide":
      requireNonEmptyString(cmd.target, `${at}.target`, issues);
      break;
    case "background":
    case "bg_switch":
      requireNonEmptyString(cmd.resource, `${at}.resource`, issues);
      break;
    case "zindex":
      requireNonEmptyString(cmd.target, `${at}.target`, issues);
      if (typeof cmd.value !== "number" || !Number.isFinite(cmd.value)) {
        issues.push(`${at}.value 必须为有限数字`);
      }
      break;
    case "style":
      requireNonEmptyString(cmd.target, `${at}.target`, issues);
      if (!isPlainObject(cmd.props)) issues.push(`${at}.props 必须为对象`);
      break;
    case "window":
      if (cmd.mode !== "auto" && cmd.mode !== "show" && cmd.mode !== "hide") {
        issues.push(`${at}.mode 必须为 "auto" | "show" | "hide"`);
      }
      break;
    case "animate":
      requireNonEmptyString(cmd.target, `${at}.target`, issues);
      requireNonEmptyString(cmd.property, `${at}.property`, issues);
      if (typeof cmd.value !== "number" || !Number.isFinite(cmd.value)) {
        issues.push(`${at}.value 必须为有限数字`);
      }
      break;
    case "animate_block": {
      requireNonEmptyString(cmd.target, `${at}.target`, issues);
      for (const field of ["x", "y", "opacity", "rotation", "scale"]) {
        const value = cmd[field];
        if (
          value !== undefined &&
          (typeof value !== "number" || !Number.isFinite(value))
        ) {
          issues.push(`${at}.${field} 必须为有限数字`);
        }
      }
      break;
    }
    case "transition":
      requireNonEmptyString(cmd.type, `${at}.type`, issues);
      break;
    case "shake":
      break; // intensity / duration 均可选（执行器给缺省）
    case "text_typewriter":
      if (cmd.enabled !== undefined && typeof cmd.enabled !== "boolean") {
        issues.push(`${at}.enabled 必须为布尔`);
      }
      if (
        cmd.speed !== undefined &&
        (typeof cmd.speed !== "number" ||
          !Number.isFinite(cmd.speed) ||
          cmd.speed <= 0)
      ) {
        issues.push(`${at}.speed 必须为正数（字符/秒）`);
      }
      if (cmd.enabled === undefined && cmd.speed === undefined) {
        issues.push(`${at} 至少需要 enabled 或 speed`);
      }
      break;
  }
}
