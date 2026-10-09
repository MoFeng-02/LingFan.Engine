/**
 * 扩展 op 的执行：故事里出现的自定义命令交给注册表里对应的扩展函数。
 *
 * 失败即停机：扩展函数返回非成功结果、或直接抛异常（由 `runRegisteredOp`
 * 兜底转成错误码），都经 `fail` 出站 `engine.error` 并停在当前命令，
 * 不做「跳过继续」——故事作者写错扩展名或扩展违约时，静默跳过比报错更难查。
 *
 * 副作用只允许经扩展上下文写状态（键名被物理强制加 `ext.<id>.` 前缀），
 * 所以扩展之间不会互相覆盖状态。
 */
import type { StoryCommand } from "../../contracts";
import type { OpContext } from "../internal";
import { runRegisteredOp, type RegisteredOp } from "../opRegistry";

/**
 * 执行一条扩展 op。
 *
 * 返回 `true` = 执行成功，分发器步进到下一条命令；
 * 返回 `false` = 已 `fail`，停机。
 *
 * 一旦真正执行过，就把扩展 id 记进依赖集合——存档据此声明「这份存档依赖哪些扩展」，
 * 读档时缺了对应扩展会被拒绝，而不是带着错误状态继续跑。
 */
export function execExtensionOp(
  ctx: OpContext,
  entry: RegisteredOp,
  cmd: StoryCommand,
): boolean {
  ctx.usedExtensions.add(entry.extensionId);
  const outcome = runRegisteredOp(entry, cmd, ctx.story, {
    get: (key) => ctx.get(key),
    setGlobal: (key, value) => ctx.setGlobal(key, value),
  });
  if (outcome.ok) return true;
  ctx.fail(outcome.code, outcome.message);
  return false;
}
