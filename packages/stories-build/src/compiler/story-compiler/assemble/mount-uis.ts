/**
 * `mount` 命令与列级 `uis` 声明的互锁判定。
 *
 * 为什么要有这道判定：`uis` 是**静态声明**（本列引用了哪些 UI，宿主据此预加载），
 * `mount(...)` 是**动态挂载**。两者指向同一个名字空间，但来源不同——静态那份来自
 * 导入语句，动态那份来自列体代码。若代码 `mount` 了一个本列没导入的 UI，静态声明就漏了
 * 一个名字：宿主不会预加载它，界面第一次挂载时才去取，表现为「点了才闪一下」。
 * 这类缺陷在运行期只表现为时序抖动，很难归因，所以在编译期就判死。
 *
 * 判定只看名字是否在集合里，不判断 UI 是否存在（那是构建期的另一道闸门）。
 */
import { compareOrdinal, type StoryCommand } from "@lingfan-engine/core";
import { walkCommandBodies } from "@lingfan-engine/editor";

/**
 * 找出「`mount` 了但未在 `uis` 里声明」的名字（去重 + 码点序，保证诊断顺序稳定）。
 *
 * 遍历含嵌套块体（`if.then` / `while.body` / `func.body` 等）：块体里的 `mount`
 * 与列体顶层的 `mount` 在运行期一样会执行，静态声明漏了它同样是缺陷。
 */
export function undeclaredMountUis(
  commands: readonly StoryCommand[],
  uis: ReadonlySet<string>,
): string[] {
  const missing = new Set<string>();
  const consider = (cmd: Record<string, unknown>): void => {
    if (cmd.op !== "mount") return;
    const name = cmd.name;
    if (typeof name !== "string" || uis.has(name)) return;
    missing.add(name);
  };
  for (const cmd of commands) {
    consider(cmd as unknown as Record<string, unknown>);
    walkCommandBodies(
      cmd as unknown as Record<string, unknown>,
      "",
      (inner) => {
        consider(inner);
      },
    );
  }
  return [...missing].sort(compareOrdinal);
}
