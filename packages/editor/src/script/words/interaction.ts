/**
 * Script 词汇层 · **玩法系统域**（interaction op）。
 *
 * 外部玩法系统（行走 / 战斗 / QTE…）由宿主注册制挂载（未知 system 运行期 fail-closed）——
 * builder 只产数据。onSuccess/onFail 是作者侧驼峰词，builder 负责映射到 op 的 snake_case 字段。
 */
import type { CommandOf } from "../../schema";

export interface InteractionOptions {
  config?: Record<string, unknown>;
  /** 成功/失败分流目标列 */
  onSuccess?: string;
  onFail?: string;
  z?: number;
}

/**
 * 让外部玩法系统接管整屏（行走 / 战斗 / QTE…）：系统名由宿主注册制提供
 * （未注册的 system 报错停机）。接管期间建立回溯检查点；开启 autoSave 时
 * 此处自动存档。
 *
 * 系统回报结果后：成功走 `onSuccess` 列、失败走 `onFail` 列；
 * 两者都省略则在原列继续。系统附带的状态由引擎归档，回溯/存档一致。
 *
 * @param system 外部玩法系统标识（宿主已注册的）。
 * @param opts 可选项：config 透传给系统的配置（任意 JSON）、
 *   onSuccess/onFail 分流目标列、z 实例层级。
 * @returns `interaction` 故事命令。
 * @example
 * interaction("walk", { onSuccess: "arrived", onFail: "cancelled" });
 */
export function interaction(
  system: string,
  opts?: InteractionOptions,
): CommandOf<"interaction"> {
  return {
    op: "interaction",
    system,
    ...(opts?.config === undefined ? {} : { config: { ...opts.config } }),
    ...(opts?.onSuccess === undefined ? {} : { on_success: opts.onSuccess }),
    ...(opts?.onFail === undefined ? {} : { on_fail: opts.onFail }),
    ...(opts?.z === undefined ? {} : { z: opts.z }),
  };
}
