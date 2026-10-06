/**
 * 演示扩展（声明制全链路的活教材）：
 * 清单 `extensions` 声明本模块 → `stories:build` 构建期放行校验（T5）→ 宿主（main.ts）
 * 静态打包表装载注册 → 故事经词汇层 `extOp("quest", …)` 使用。
 *
 * op `quest` = 任务进度标记：写入 `ext.demoquest.step`（前缀门卫物理强制命名空间），
 * 状态进 SSOT ⇒ 随快照/存档/回溯随行。执行不抛（fail-closed 返回失败结果，同引擎纪律）。
 * 编辑器未注册 schema ⇒ 编辑器按 unknown-op 口径报（与引擎一致，不假红）。
 *
 * ⚠️ id 取 `demoquest`（无连字符）：**插值 `{ext.<id>.<key>}` 的名字段不含连字符**——
 * 带连字符的 id 写得出状态却插不进台词（探针实测），任务进度要在画面上看到就得用它。
 */
import type { OpExtension } from "@lingfan/engine";

const extension: OpExtension = {
  id: "demoquest",
  stateVersion: 1,
  ops: [
    {
      op: "quest",
      exec: (cmd, ctx) => {
        const step = cmd.step;
        if (typeof step !== "string" || step === "") {
          return {
            ok: false,
            code: "quest-bad-step",
            message: "quest 需要 step 为非空字符串",
          };
        }
        ctx.set("step", step);
        return { ok: true };
      },
    },
  ],
};

export default extension;
