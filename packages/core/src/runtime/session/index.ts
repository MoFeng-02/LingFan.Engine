/**
 * 会话挂起与等待的出口：引擎级暂停的执行面（`pause.ts`）与等待声明表（`waitingOps.ts`）。
 *
 * **名字消歧（重要）**：本目录的「会话」指**一次执行的挂起与恢复**——暂停时挂起等待定时器、
 * 让出声的媒体收声、记下暂停标记，恢复时按剩余毫秒续上。它与
 * `runtime/internal/session.ts` **不是同一件事**：后者是 op 上下文生命周期
 * （启动、推进、选择、导航、存读档、语言切换与热重载），属运行层内部、不进包出口。
 * 两者不同层，不要合并理解。
 *
 * **暂停标记的读口不在本目录**：`SYS.paused` 的唯一读口是
 * `runtime/internal/waiting.ts` 的 `pausedSession`（该函数注释已写明别的模块不要自己
 * `get` 一次再判）。本目录只是调用方，不再另开一次 `get(SYS.paused)`。
 */
export { pauseSession, resumeSession } from "./pause.ts";
export {
  collectWaitSpecs,
  waitSpecOfOp,
  WAITING_OPS,
  waitingStateOfOp,
  type WaitSpec,
} from "./waitingOps.ts";
