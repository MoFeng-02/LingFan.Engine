/**
 * 命令块的执行：把一批由引擎外提交的命令按序解释执行。
 *
 * 两种提交方共用同一套执行与回滚机制，差别只在**模式**上：
 * - `element`：数据侧点击动作（元素 `ops` 属性）。要求当前有等待画面——否则会与正在
 *   推进的命令流交叉；等待类 op 整次拒绝；进入等待态视为违约（解析期已拦，属于不变量）。
 * - `scene`：列身体等外部画面提交。进列那刻就可能没有任何等待态（纯视觉房间），
 *   因此不要求等待画面；除 `load` 外全部 op 放行——列身体是这一屏的主人，
 *   它能做的事和脚本能做的事一样多（见 `SCENE_BLOCKED_OPS` 的逐条说明）。
 *
 * 共通的语义要点：
 * - **复用既有 op 分发表**（分发器的 switch）——零新语义；未实现 op fail-closed
 * - **不建检查点**：提交是状态变更，不是玩家经历的「一步」；变更随下一次检查点入档，
 *   回溯到更早的检查点即回到提交前的值
 * - **叙事位置只由真正换列的 op 改写**：`element` 模式下 `jump`/`navigate`/`call` 会替换
 *   命令流，与「提交后继续当前流」冲突 ⇒ 一并拒绝；`scene` 模式下它们是合法动作，
 *   换列的按新列结算、不换列的（`call`）把剩余帧续在原帧栈之上
 * - **原子性**：任一 op 执行失败 ⇒ 全局状态与作用域链回滚到提交前（拒绝后状态原样，
 *   与对抗性输入的全库约定一致）；历史里不留下半执行痕迹
 *
 * 返回是否全部执行成功（false = 已出站 engine.error，状态已回滚）。
 */
import { ELEMENT_OPS_BLOCKED, SYS } from "../../../contracts/index.ts";
import type { EventListener, StoryCommand } from "../../../contracts/index.ts";
import type { OpContext } from "../../internal/index.ts";
import { abortExternalTakeovers } from "../../internal/index.ts";
import { Scope } from "../../scope.ts";

/** 提交模式：决定等待态要求与「停在等待态」的判定 */
export type CommandBlockMode = "element" | "scene";

/** 允许出现在等待态的取值（正向判定，不假设 `__waiting` 一定存在） */
const WAIT_STATES: ReadonlySet<string> = new Set([
  "dialog",
  "menu",
  "input",
  "wait",
  "video",
  "minigame",
  "interaction",
  "extension",
]);

/**
 * `scene` 模式的拒绝清单：**只有 `load`**。
 *
 * 其余 op 全部放行——列身体是这一屏的主人，它能做的事和脚本能做的事一样多：
 * - `say`/`menu`/`input`/`wait` 等进入等待态：画面仍是当前列身体，等待层叠在它上面；
 * - `call`/`return`：压入一段命令跑完再回来，**不换列 ⇒ 不换画面**；
 * - `jump`/`navigate`：真换列（换画面），换了就是换了，提交收尾按新列结算；
 * - `save`/`auto_save`/`save_delete`：与点击同一时刻的存档动作，无画面后果。
 *
 * `load` 是唯一真做不到的：它整份导入存档并重建坐标、历史与帧栈，
 * 提交它的那个组件在这一步之后已经不存在，没有任何「回来」的位置。
 */
const SCENE_BLOCKED_OPS: ReadonlySet<string> = new Set(["load"]);

/** 按模式取拒绝清单：`element` 用契约全表，`scene` 只留真正做不到的 */
function blockedOps(mode: CommandBlockMode): ReadonlySet<string> {
  if (mode === "scene") return SCENE_BLOCKED_OPS;
  return ELEMENT_OPS_BLOCKED;
}

/**
 * 执行一批命令：按序跑完 ops，成功返回 true；
 * 失败则整体回滚并返回 false（已出站错误）。
 *
 * `element` 模式下进入等待态同样算失败（解析期就该拒绝，运行期属于不变量被破坏）；
 * `scene` 模式下停在等待态是正常结果（`say` 上屏，等玩家推进）。
 */
export function runCommandBlock(
  ctx: OpContext,
  ops: readonly Record<string, unknown>[],
  mode: CommandBlockMode,
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
  const blocked = blockedOps(mode);
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
  // `element` 只在**等待画面**允许点击动作：避免与正在推进的命令流交叉。
  // 未等待时 `SYS.waiting` 通常为 "none"，但脚本跑完/从未建立等待时可能是 undefined
  // ⇒ 用「是否为已知等待态」正向判定，不假设键一定存在。
  // `interaction`（外部玩法系统接管）与 `extension`（扩展 op 等待）同为引擎等待态：
  // 接管画面同样是被暂停的叙事，元素动作在其等待画面同样可用。
  // `scene` 不设此要求：列身体在进列那刻就可能没有任何等待态。
  if (mode === "element") {
    const waiting = ctx.get(SYS.waiting);
    if (typeof waiting !== "string" || !WAIT_STATES.has(waiting)) {
      ctx.fail(
        "element-ops-invalid",
        `当前无等待画面（__waiting=${String(waiting)}），元素动作只在等待期生效`,
      );
      return false;
    }
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
  // 失败探测：执行期 fail() 会出站 engine.error——本窗口内的错误即本次提交失败
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
  // 提前离开（进入等待态）或执行完毕：`scene` 与 `element` 的收尾语义在这里分岔
  const remaining = ctx.frames;
  const interrupted = remaining.length > 0;
  // 真换列了（jump/navigate 落到别的列）：新列已接管帧栈与坐标，提交就此收场，
  // 不叠回原列、也不还原坐标——否则会把新列的命令续在原列下面。
  const leftColumn = ctx.coord.columnId !== savedCoord.columnId;
  ctx.frames = savedFrames;
  ctx.coord = savedCoord;
  if (mode === "scene" && !failed) {
    // `scene` 的三种正常收场：继续等、真换列、跑完
    if (leftColumn) {
      // 换列收尾与 enterColumn 同一入口（单一收尾，禁另写一份）：真换列时中断外部接管。
      // 换列经 enterColumn 已收口过一次，这里是同一函数的幂等再调用，确保「离开原列」
      // 这一事实无论走哪条路径都经过同一个中断收尾，不会漏掉挂载信号。
      abortExternalTakeovers(ctx);
      // 新列的帧栈是它自己的，原列的已随换列销毁；状态与坐标保持新列的样子
      ctx.frames = remaining;
      return true;
    }
    if (interrupted) {
      // 停在等待态：**保留剩余帧以续播**（`call` 进 label 说了一句就停在这里，
      // 玩家推进后要接着说下一句，而不是回到列身体那条空命令流）。
      // 列身体自己的帧垫在下面，续播跑完自然回到它。
      ctx.frames = [...savedFrames, ...remaining];
      return true;
    }
    return true;
  }
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
    if (mode === "scene") return false;
    ctx.fail(
      "element-ops-interrupted",
      "元素动作序列进入了等待态（已在解析期拒绝，若出现请报告）",
    );
    return false;
  }
  return true;
}

/**
 * 执行一次点击动作（`element` 模式）：按序跑完 ops，成功返回 true；
 * 任一 op 失败或进入等待态则整体回滚并返回 false（已出站错误）。
 */
export function runElementOps(
  ctx: OpContext,
  ops: readonly Record<string, unknown>[],
): boolean {
  return runCommandBlock(ctx, ops, "element");
}

/**
 * 执行一次外部画面提交（`scene` 模式）：不要求等待画面，除 `load` 外全部 op 放行。
 *
 * 换列的 op 按新列结算；不换列的（`call`/`return`）把剩余帧续在原帧栈之上，
 * 因此停在等待态时玩家推进之后会接着跑完那段命令，跑完自然回到列身体的原流程。
 * 不建检查点（提交是状态变更，不是玩家经历的「一步」）；失败整份回滚。
 */
export function submitSceneOps(
  ctx: OpContext,
  ops: readonly Record<string, unknown>[],
): boolean {
  return runCommandBlock(ctx, ops, "scene");
}
