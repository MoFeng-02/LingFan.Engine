/**
 * 控制转移命令的执行：navigate / func / call / return。
 *
 * 这一族改变「接下来执行哪段代码」——要么换一条列（navigate），要么压入一个
 * 子过程帧（func 注册、call 调用），要么把子过程帧弹回去（return）。
 * 它们自己不建立等待画面，检查点由落点自身的等待命令建立。
 */
import { SYS, type StoryCommand } from "../../contracts";
import { ExpressionError } from "../expr";
import type { Frame, OpContext } from "../internal";

/**
 * navigate op：跨列导航。目标列 = scene ?? path（scene 优先），
 * 二者都是 columnId（列名即标签，「文件」在组装模型中坍缩为列）。
 * 与 jump 的语义差异 = 清旧列对话镜像（导航 = 画面边界）+
 * path/scene 词汇（JSON v1 契约）。不建检查点：navigate
 * 建检查点的语义在检查点模型下产生回溯陷阱——导航站重放必重建下一站的等待画面，
 * flush 提交命中前向同坐标站使 cursor 前移，back 原地循环；检查点 = 玩家所见，
 * 下导航边界由前后所见站界定。
 */
export function execNavigate(ctx: OpContext, cmd: StoryCommand): boolean {
  const scene =
    typeof cmd.scene === "string" && cmd.scene !== "" ? cmd.scene : null;
  const target = scene ?? (typeof cmd.path === "string" ? cmd.path : "");
  if (target === "") {
    ctx.fail(
      "navigate-invalid",
      "navigate 需要 path（scene 可选；二者皆为目标列 id）",
    );
    return false;
  }
  ctx.setSystem(SYS.currentDialogText, ""); // 清旧列对话镜像（导航 = 画面边界）
  ctx.setSystem(SYS.currentDialogSpeaker, "");
  ctx.setSystem(SYS.currentDialogColor, ""); // 同清：避免上一句的颜色覆盖残留
  ctx.setSystem(SYS.dialogComplete, false);
  return ctx.enterColumn(target);
}

/** func：执行期注册进函数表；重复注册 fail-closed（确定性重放重入同函数 = 幂等放行） */
export function execFunc(ctx: OpContext, cmd: StoryCommand): boolean {
  const name = cmd.name as string;
  const registered = ctx.functions.get(name);
  const next = {
    params: cmd.params as string[],
    body: cmd.body as StoryCommand[],
  };
  if (registered !== undefined) {
    // 读档重放跨 JSON 序列化 → body 引用必然不同，须按语义比较（params 逐位 + body 序列化一致）
    const identical =
      registered.params.length === next.params.length &&
      registered.params.every((p, i) => p === next.params[i]) &&
      JSON.stringify(registered.body) === JSON.stringify(next.body);
    if (!identical && !ctx.rollbackActive) {
      ctx.fail("func-duplicate", `函数重复注册：${name}`);
      return false;
    }
  }
  ctx.functions.set(name, next);
  return true;
}

/**
 * call：按名查表 → 实参求值按位绑定 → 函数帧（体 = 独立块作用域）。
 * 未注册/参数个数不符 fail-closed。
 */
export function execCall(
  ctx: OpContext,
  frame: Frame,
  cmd: StoryCommand,
): boolean {
  const name = cmd.target as string;
  const fn = ctx.functions.get(name);
  if (fn === undefined) {
    // 列（label）目标：`call` 的文档语义是「调用子过程（func 或 label），
    // 用 return 返回」——只认 func 会让 `call sb_subroutine`
    // （`label sb_subroutine:` 定义）报「未注册的函数」。
    //
    // 实现要点：直接压入该列命令的帧（不切 coord、不装元素）——
    // 因为「子过程」是被调用的代码块，不是「进入一个新场景」：
    // ① 作用域沿用 func 的块级语义（enterChild，不污染列级作用域）
    // ② func: true 标记复用 ⇒ return 与「列尾出帧」两条路径都能正确回到调用点
    // ③ 调用者位置先 index += 1 ⇒ 返回点 = 下一条
    const column = ctx.columnById(name);
    if (column === undefined) {
      ctx.fail(
        "call-unknown-target",
        `调用目标不存在：${name}（既不是 func 也不是列）`,
      );
      return false;
    }
    if (column.kind !== "flow") {
      ctx.fail(
        "call-invalid-target",
        `call 只能调用流程列（flow）；${name} 是场景列（scene）——` +
          `空间层切换请用 navigate/jump`,
      );
      return false;
    }
    frame.index += 1;
    const scope = frame.scope.enterChild();
    ctx.frames.push({
      columnId: null,
      commands: column.commands ?? [],
      index: 0,
      scope,
      func: true,
    });
    return true;
  }
  try {
    const args = ((cmd.args as unknown[] | undefined) ?? []).map((a) =>
      ctx.evalValue(a),
    );
    if (args.length !== fn.params.length) {
      ctx.fail(
        "arity-error",
        `函数 ${name} 需要 ${fn.params.length} 个参数，收到 ${args.length}`,
      );
      return false;
    }
    frame.index += 1;
    const scope = frame.scope.enterChild(); // 函数体内作用域 = 独立块
    fn.params.forEach((p, i) => scope.declare(p, args[i]!));
    ctx.frames.push({
      columnId: null,
      commands: fn.body,
      index: 0,
      scope,
      func: true,
    });
    return true;
  } catch (e) {
    if (e instanceof ExpressionError) {
      ctx.fail(e.code, e.message);
      return false;
    }
    throw e;
  }
}

/** return：弹出函数帧及其内部块帧，回到调用方；函数外 return fail-closed */
export function execReturn(ctx: OpContext): boolean {
  for (let i = ctx.frames.length - 1; i >= 0; i -= 1) {
    if (ctx.frames[i]!.func === true) {
      ctx.frames.length = i; // 移除函数帧及其内部剩余帧
      return true;
    }
  }
  ctx.fail("return-outside-func", "return 必须在 func 体内");
  return false;
}
