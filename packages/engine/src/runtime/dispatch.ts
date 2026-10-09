/**
 * 逐命令解释执行的分发：帧栈推进 + 命令分流。
 *
 * 循环骨架与解释器状态机逐字对应：取命令 → 执行 → 前进，遇等待点即停
 * （调用方保证 `SYS.waiting` 为 none）。分发保持 `switch (cmd.op)` 的穷举形态，
 * 每个分支只调用 op 族处理器，不自带业务判定。
 */
import {
  execAnimate,
  execArray,
  execArrayPop,
  execArrayPush,
  execAssert,
  execAssign,
  execAudio,
  execAutoSaveOp,
  execCall,
  execCharacter,
  execDefine,
  execDict,
  execDictSet,
  execElementVisual,
  execExtensionOp,
  execFor,
  execForeach,
  execFunc,
  execGuard,
  execIf,
  execInput,
  execInteraction,
  execLoadOp,
  execMenu,
  execMinigame,
  execNavigate,
  execNotify,
  execNvl,
  execRandom,
  execReturn,
  execSaveDeleteOp,
  execSaveOp,
  execSay,
  execScreenEffect,
  execSwitch,
  execTextTypewriter,
  execUndef,
  execVideo,
  execWait,
  execWhile,
  execWindow,
} from "./ops";
import type { OpContext } from "./internal";

export function runDispatch(ctx: OpContext): void {
  for (;;) {
    const frame = ctx.frames[ctx.frames.length - 1];
    if (frame === undefined) return; // 全部帧结束 = 本故事段结束
    if (frame.index >= frame.commands.length) {
      const loop = frame.loop;
      if (loop !== undefined) {
        loop.iterations += 1;
        if (loop.kind === "while") {
          const again = ctx.evalCond(loop.cond);
          if (again === null) return; // 条件求值失败停机
          if (!again) {
            ctx.frames.pop();
            continue;
          }
          if (!ctx.beginLoopIteration(frame, loop)) return;
          continue;
        }
        // iterate：本轮完成 → 推进游标；序列耗尽 → 出循环
        if (loop.iterations >= loop.items!.length) {
          ctx.frames.pop();
          continue;
        }
        if (!ctx.beginLoopIteration(frame, loop)) return;
        continue;
      }
      ctx.frames.pop(); // 出块/出列：块级作用域随之不可达
      continue;
    }
    const cmd = frame.commands[frame.index]!;
    // 扩展查找前置：内建 switch 一行不动 ⇒ 内建行为逐字节等价；
    // 扩展 op 的推进语义 = 执行成功即步进（v1 无等待态）
    const extensionOp = ctx.extensionOps.get(cmd.op);
    if (extensionOp !== undefined) {
      if (!execExtensionOp(ctx, extensionOp, cmd)) return;
      frame.index += 1;
      continue;
    }
    switch (cmd.op) {
      case "say":
        execSay(ctx, frame, cmd);
        return; // 进入对话等待，暂停循环
      case "menu":
        execMenu(ctx, frame, cmd);
        return; // 进入菜单等待
      case "wait":
        execWait(ctx, frame, cmd);
        return; // 进入定时等待
      case "pause":
        execWait(ctx, frame, cmd, true);
        return; // 进入硬等待
      case "assert":
        if (!execAssert(ctx, cmd)) return; // 拦截 = 停在当前命令（状态原样 + 不推进）
        frame.index += 1;
        continue;
      case "guard":
        if (!execGuard(ctx, cmd)) return; // 拦截 = 停在当前命令（状态原样 + 不推进）
        frame.index += 1;
        continue;
      case "jump":
        if (
          !ctx.enterColumn(typeof cmd.target === "string" ? cmd.target : "")
        )
          return;
        continue;
      case "navigate":
        if (!execNavigate(ctx, cmd)) return;
        continue;
      case "save":
        if (!execSaveOp(ctx, frame, cmd)) return;
        continue;
      case "load":
        if (!execLoadOp(ctx, frame, cmd)) return;
        continue;
      case "auto_save":
        if (!execAutoSaveOp(ctx, frame, cmd)) return;
        continue;
      case "save_delete":
        if (!execSaveDeleteOp(ctx, frame, cmd)) return;
        continue;
      case "if":
        if (!execIf(ctx, frame, cmd)) return;
        continue;
      case "while":
        if (!execWhile(ctx, frame, cmd)) return;
        continue;
      case "for":
        if (!execFor(ctx, frame, cmd)) return;
        continue;
      case "foreach":
        if (!execForeach(ctx, frame, cmd)) return;
        continue;
      case "switch":
        if (!execSwitch(ctx, frame, cmd)) return;
        continue;
      case "break":
      case "continue": {
        const depth = ctx.nearestLoopIndex();
        if (depth < 0) {
          ctx.fail(
            `${cmd.op}-outside-loop`,
            `${cmd.op} 必须在循环体内（while/for/foreach）`,
          );
          return;
        }
        if (cmd.op === "break") {
          ctx.frames.length = depth; // 弹出循环帧与其内部块帧（作用域随之销毁）
        } else {
          ctx.frames.length = depth + 1; // 保留循环帧，弹内部块帧
          const loopFrame = ctx.frames[ctx.frames.length - 1]!;
          loopFrame.index = loopFrame.commands.length; // 走到帧耗尽分支 → 重判/推进
        }
        continue;
      }
      case "set":
      case "let":
      case "local":
        if (!execAssign(ctx, frame, cmd, cmd.op)) return;
        frame.index += 1;
        continue;
      case "define":
        if (!execDefine(ctx, cmd)) return;
        frame.index += 1;
        continue;
      case "undef":
        if (!execUndef(ctx, frame, cmd)) return;
        frame.index += 1;
        continue;
      case "func":
        if (!execFunc(ctx, cmd)) return;
        frame.index += 1;
        continue;
      case "call":
        if (!execCall(ctx, frame, cmd)) return;
        continue;
      case "return":
        if (!execReturn(ctx)) return;
        continue;
      case "input":
        execInput(ctx, frame, cmd);
        return; // 进入输入等待
      case "array":
        if (!execArray(ctx, cmd)) return;
        frame.index += 1;
        continue;
      case "array_push":
        if (!execArrayPush(ctx, cmd)) return;
        frame.index += 1;
        continue;
      case "array_pop":
        if (!execArrayPop(ctx, cmd)) return;
        frame.index += 1;
        continue;
      case "dict":
        if (!execDict(ctx, cmd)) return;
        frame.index += 1;
        continue;
      case "dict_set":
        if (!execDictSet(ctx, cmd)) return;
        frame.index += 1;
        continue;
      case "notify":
        execNotify(ctx, cmd);
        frame.index += 1;
        continue;
      case "random":
        if (!execRandom(ctx, cmd)) return;
        frame.index += 1;
        continue;
      case "nvl":
        execNvl(ctx, cmd);
        frame.index += 1;
        continue;
      case "character":
        execCharacter(ctx, cmd);
        frame.index += 1;
        continue;
      case "bgm":
      case "se":
      case "ambient":
      case "stop_bgm":
      case "stop_ambient":
      case "voice":
      case "stop_voice":
        if (!execAudio(ctx, cmd)) return;
        frame.index += 1;
        continue;
      case "video":
      case "seek_video":
      case "pause_video":
      case "resume_video":
      case "stop_video":
      case "video_skipable":
        if (!execVideo(ctx, frame, cmd)) return;
        frame.index += 1;
        continue;
      case "cutscene":
        if (!execVideo(ctx, frame, cmd, true)) return;
        return; // 进入视频等待（ended/跳过解除；index 已前移）
      case "minigame":
        execMinigame(ctx, frame, cmd);
        return; // 进入小游戏等待（resolveMinigame 解除）
      case "interaction":
        execInteraction(ctx, frame, cmd);
        return; // 进入玩法系统接管等待（resolveInteraction 解除）
      case "show":
      case "hide":
      case "background":
      case "bg_switch":
      case "zindex":
      case "style":
        // 元素增删改：非阻塞（写 SYS.elements，随快照/回溯），故事继续
        if (!execElementVisual(ctx, cmd)) return;
        frame.index += 1;
        continue;
      case "window":
        // 对话框显隐三态（写 SYS.dialogVisible，UI 据此控层）
        if (!execWindow(ctx, cmd)) return;
        frame.index += 1;
        continue;
      case "animate":
      case "animate_block":
        // 元素动画：核心只写动画描述（UI 每帧插值，播毕回调写回终值）
        if (!execAnimate(ctx, cmd)) return;
        frame.index += 1;
        continue;
      case "transition":
      case "shake":
        // 屏幕级效果：写启动键（UI 帧驱动，播毕回调清除）
        if (!execScreenEffect(ctx, cmd)) return;
        frame.index += 1;
        continue;
      case "text_typewriter":
        // 故事级打字机设置（玩家偏好可覆盖）
        if (!execTextTypewriter(ctx, cmd)) return;
        frame.index += 1;
        continue;
      default:
        // fail-closed：未知/未实现 op 不静默跳过
        ctx.fail("unknown-op", `未知或未实现的命令：${cmd.op}`);
        return;
    }
  }
}
