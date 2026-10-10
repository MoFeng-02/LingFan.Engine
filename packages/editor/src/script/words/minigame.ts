/**
 * Script 词汇层 · **小游戏域**（minigame op + reward 句柄）。
 * UI 组件由注册制挂载（未知 gameId 运行期 fail-closed）——builder 只产数据。
 * onSuccess/onFail 是作者侧驼峰词，builder 负责映射到 op 的 snake_case 字段。
 */
import type { CommandOf, ScriptValue } from "../../schema";

export interface MinigameOptions {
  config?: Record<string, unknown>;
  /** 成功/失败分流目标列 */
  onSuccess?: string;
  onFail?: string;
  reward?: ReadonlyArray<{ readonly key: string; readonly value: ScriptValue }>;
  z?: number;
}

export function minigame(
  game: string,
  opts?: MinigameOptions,
): CommandOf<"minigame"> {
  return {
    op: "minigame",
    game,
    ...(opts?.config === undefined ? {} : { config: { ...opts.config } }),
    ...(opts?.onSuccess === undefined ? {} : { on_success: opts.onSuccess }),
    ...(opts?.onFail === undefined ? {} : { on_fail: opts.onFail }),
    ...(opts?.reward === undefined
      ? {}
      : { reward: opts.reward.map((r) => ({ key: r.key, value: r.value })) }),
    ...(opts?.z === undefined ? {} : { z: opts.z }),
  };
}

export function reward(
  key: string,
  value: ScriptValue,
): { key: string; value: ScriptValue } {
  return { key, value };
}
