/**
 * 元素动作序列（数据侧点击动作）的执行：把元素 `ops` 属性的命令按序解释执行。
 *
 * 语义要点：
 * - **复用既有 op 分发表**（分发器的 switch）——零新语义；未实现 op fail-closed
 * - **不建检查点**：点击是状态变更，不是玩家经历的「一步」；变更随下一次检查点入档，
 *   回溯到更早的检查点即回到点击前的值
 * - **禁止等待类 op**（say/menu/input/wait/pause/nvl/cutscene/minigame）：命令流会被
 *   替换成动作序列，等待语义由当前叙事位置承载 ⇒ 整次拒绝（fail-closed，不半执行）
 * - **不改变叙事位置**：jump/navigate/call 会替换命令流，与「点击后继续当前流」冲突 ⇒
 *   一并拒绝
 * - **原子性**：任一 op 执行失败 ⇒ 全局状态与作用域链回滚到点击前（拒绝后状态原样，
 *   与对抗性输入的全库约定一致）；历史里不留下半执行痕迹
 *
 * 返回是否全部执行成功（false = 已出站 engine.error，状态已回滚）。
 */
import { ELEMENT_OPS_BLOCKED, SYS } from "../../../contracts";
import type { EventListener, StoryCommand } from "../../../contracts";
import type { OpContext } from "../../internal";
import { Scope } from "../../scope";

/**
 * 执行一次点击动作：按序跑完 ops，成功返回 true；
 * 任一 op 失败或进入等待态则整体回滚并返回 false（已出站错误）。
 */
export function runElementOps(
  ctx: OpContext,
  ops: readonly Record<string, unknown>[],
): boolean {
  if (!ctx.started) {
    ctx.fail("element-ops-invalid", "故事尚未启动，无法执行元素动作");
    return false;
  }
  if (!Array.isArray(ops) || ops.length === 0) {
    ctx.fail("element-ops-invalid", "元素 ops 必须为非空数组");
    return false;
  }
  // 前置形态校验：整次拒绝（不半执行）——等待/位置/存档类 op 与畸形负载都在此拦截。
  // 清单来自契约（`ELEMENT_OPS_BLOCKED`）：编辑器编辑期诊断读同一份，避免两处漂移。
  const blocked = ELEMENT_OPS_BLOCKED;
  for (const [i, item] of ops.entries()) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      ctx.fail("element-ops-invalid", `元素 ops[${i}] 必须为对象`);
      return false;
    }
    const op = (item as { op?: unknown }).op;
    if (typeof op !== "string" || op === "") {
      ctx.fail("element-ops-invalid", `元素 ops[${i}] 缺少非空 op`);
      return false;
    }
    if (blocked.has(op)) {
      ctx.fail(
        "element-ops-blocked-op",
        `元素 ops[${i}] 的 ${op} 不可用于点击动作（等待/位置/存档类 op 会打断当前叙事流）`,
      );
      return false;
    }
  }
  // 只在**等待画面**允许点击动作：避免与正在推进的命令流交叉。
  // 未等待时 `SYS.waiting` 通常为 "none"，但脚本跑完/从未建立等待时可能是 undefined
  // ⇒ 用「是否为已知等待态」正向判定，不假设键一定存在。
  const waiting = ctx.get(SYS.waiting);
  if (
    waiting !== "dialog" &&
    waiting !== "menu" &&
    waiting !== "input" &&
    waiting !== "wait" &&
    waiting !== "video" &&
    waiting !== "minigame"
  ) {
    ctx.fail(
      "element-ops-invalid",
      `当前无等待画面（__waiting=${String(waiting)}），元素动作只在等待期生效`,
    );
    return false;
  }
  const savedCoord = { ...ctx.coord };
  const savedFrames = ctx.frames;
  // 原子回滚面：动作序列可触及的全部可变状态（SSOT / 注册表 / 随机数游标 / 依赖标记）
  const savedState = new Map(ctx.state);
  const savedFunctions = new Map(ctx.functions);
  const savedCharacters = new Map(ctx.characters);
  const savedExtensions = new Set(ctx.usedExtensions);
  const savedRng = ctx.rngState;
  const rootScope = savedFrames[savedFrames.length - 1]?.scope ?? Scope.root();
  const savedScope = rootScope.snapshotChain();
  // 失败探测：执行期 fail() 会出站 engine.error——本窗口内的错误即本次动作失败
  let failed = false;
  const probe: EventListener = (event) => {
    if (event.payload.kind === "engine.error") failed = true;
  };
  ctx.eventListeners.add(probe);
  // 动作序列以独立帧执行（块级作用域，出帧即销毁）；scope 取当前帧（`set` 沿用既有寻址）
  ctx.frames = [
    {
      columnId: null,
      commands: ops as readonly StoryCommand[],
      index: 0,
      scope: rootScope.enterChild(),
    },
  ];
  try {
    ctx.run();
  } finally {
    ctx.eventListeners.delete(probe);
  }
  // 提前离开（进入等待态）或执行完毕都恢复叙事位置——动作序列不得改写叙事坐标
  const interrupted = ctx.frames.length > 0;
  ctx.frames = savedFrames;
  ctx.coord = savedCoord;
  if (interrupted || failed) {
    // 失败即原子回滚：全部可变面原样（错误已由具体 op 出站，调用方据 error 上报）
    ctx.state = savedState;
    ctx.functions = savedFunctions;
    for (const [k, v] of savedCharacters) ctx.characters.set(k, v);
    ctx.usedExtensions.clear();
    for (const id of savedExtensions) ctx.usedExtensions.add(id);
    ctx.rngState = savedRng;
    rootScope.restoreChain(savedScope);
    if (!interrupted) return false;
    ctx.fail(
      "element-ops-interrupted",
      "元素动作序列进入了等待态（已在解析期拒绝，若出现请报告）",
    );
    return false;
  }
  return true;
}
