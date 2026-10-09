/**
 * blocks 族的命令负载结构校验（validateCommand 的族分片）。
 * 只判本族 op 的必填与类型，未知字段不在此拒绝（编辑期 schema 负责）。
 */
import { requireNonEmptyString } from "../guards";
import { validateInstanceZ } from "../column";
import { validateBody } from "../body";
import { isPlainObject } from "../../../shared";

/**
 * 校验本族 op 的负载（7 个 op：`if` `menu` `while` `for` `foreach` `switch` `func`）。
 *
 * 入参由分发骨架给出：`cmd` 已收窄为非空 op 的对象，`at` 是报错定位前缀，`issues` 是收集器。
 * 无返回值，问题通过 `issues` 交付；不匹配的 op 直接落到函数末尾，等于放行（结构从简）。
 * 失败表现：不抛异常。必填缺失或类型不符时推一条带 `at` 定位的中文 issue，尽量一次报全本族问题。
 */
export function validateBlocksCommand(
  cmd: Record<string, unknown>,
  at: string,
  issues: string[],
): void {
  switch (cmd.op) {
    case "if": {
      requireNonEmptyString(cmd.cond, `${at}.cond`, issues);
      validateBody(cmd.then, `${at}.then`, issues, true);
      if (cmd.elif !== undefined) {
        if (!Array.isArray(cmd.elif)) {
          issues.push(`${at}.elif 必须为数组`);
        } else {
          for (const [j, elif] of cmd.elif.entries()) {
            if (!isPlainObject(elif)) {
              issues.push(`${at}.elif[${j}] 必须为对象`);
              continue;
            }
            requireNonEmptyString(elif.cond, `${at}.elif[${j}].cond`, issues);
            validateBody(elif.then, `${at}.elif[${j}].then`, issues, true);
          }
        }
      }
      if (cmd.else !== undefined)
        validateBody(cmd.else, `${at}.else`, issues, false);
      break;
    }
    case "menu": {
      if (cmd.prompt !== undefined && typeof cmd.prompt !== "string") {
        issues.push(`${at}.prompt 必须为字符串`);
      }
      if (!Array.isArray(cmd.options) || cmd.options.length === 0) {
        issues.push(`${at}.options 必须为非空数组`);
      } else {
        for (const [j, opt] of cmd.options.entries()) {
          if (!isPlainObject(opt)) {
            issues.push(`${at}.options[${j}] 必须为对象`);
            continue;
          }
          requireNonEmptyString(opt.text, `${at}.options[${j}].text`, issues);
          requireNonEmptyString(
            opt.target,
            `${at}.options[${j}].target`,
            issues,
          );
        }
      }
      validateInstanceZ(cmd, at, issues); // menu 的实例 z（choices 层）
      break;
    }
    case "while":
      requireNonEmptyString(cmd.cond, `${at}.cond`, issues);
      validateBody(cmd.body, `${at}.body`, issues, true);
      break;
    case "for":
      requireNonEmptyString(cmd.var, `${at}.var`, issues);
      requireNonEmptyString(cmd.in, `${at}.in`, issues);
      validateBody(cmd.body, `${at}.body`, issues, true);
      break;
    case "foreach":
      requireNonEmptyString(cmd.var, `${at}.var`, issues);
      requireNonEmptyString(cmd.key, `${at}.key`, issues);
      validateBody(cmd.body, `${at}.body`, issues, true);
      break;
    case "switch": {
      requireNonEmptyString(cmd.on, `${at}.on`, issues);
      if (!Array.isArray(cmd.cases) || cmd.cases.length === 0) {
        issues.push(`${at}.cases 必须为非空数组`);
      } else {
        for (const [j, c] of cmd.cases.entries()) {
          if (!isPlainObject(c)) {
            issues.push(`${at}.cases[${j}] 必须为对象`);
            continue;
          }
          if (!("value" in c)) issues.push(`${at}.cases[${j}].value 必填`);
          validateBody(c.body, `${at}.cases[${j}].body`, issues, true);
        }
      }
      if (cmd.default !== undefined)
        validateBody(cmd.default, `${at}.default`, issues, false);
      break;
    }
    case "func":
      requireNonEmptyString(cmd.name, `${at}.name`, issues);
      if (
        !Array.isArray(cmd.params) ||
        cmd.params.some((p) => typeof p !== "string" || p === "")
      ) {
        issues.push(`${at}.params 必须为非空字符串数组`);
      }
      validateBody(cmd.body, `${at}.body`, issues, true);
      break;
  }
}
