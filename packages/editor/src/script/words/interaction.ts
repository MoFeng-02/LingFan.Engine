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
