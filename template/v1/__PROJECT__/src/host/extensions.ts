/**
 * 示例扩展：演示自定义 op 的「等待第三态」。
 *
 * 一个扩展 = 一个稳定 id + 若干自定义 op。这里提供一个会请求挂起的 op：
 * exec 同步写一笔本命名空间状态（`ext.demo.note`，随快照/存档/回溯随行），
 * 再返回 `ok:"wait"` 让引擎建立等待点并出站 `extension.mount`；宿主覆盖层「确认」
 * 经 `engine.resolveExtensionOp` 解除，故事继续。扩展不触达平台 API，只经上下文窄接口读写。
 */
import type { OpExtension } from "@lingfan-engine/core";

/** 脚手架自带的示例扩展（组合根注入引擎构造；作者可照此追加自己的扩展）。 */
export const templateExtensions: readonly OpExtension[] = [
  {
    id: "demo",
    stateVersion: 1,
    ops: [
      {
        op: "demo_wait",
        // 声明本 op 会请求等待：未声明而 exec 返回 wait 会被引擎运行期 fail-closed 拒绝
        wait: true,
        exec: (cmd, ctx) => {
          const note = typeof cmd.note === "string" ? cmd.note : "示例扩展等待";
          ctx.set("note", note);
          // 挂起负载随 extension.mount 出站（不进 SSOT）；详情供宿主覆盖层展示
          return { ok: "wait", config: { detail: note } };
        },
      },
    ],
  },
];
