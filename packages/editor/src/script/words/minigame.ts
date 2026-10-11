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

/**
 * 进入一个小游戏（UI 组件由注册制挂载，未知 game 报错停机）：
 * 玩家玩完这局后故事按胜负分流——成功走 `onSuccess` 列并发放奖励，
 * 失败走 `onFail` 列；两者都省略则在原列继续。
 *
 * 建立等待时就是回溯检查点；开启 autoSave 时此处自动存档。
 * 奖励的 `value` 在运行期求值（支持 `"{expr}"`），回溯重放保持确定。
 *
 * @param game 小游戏标识（宿主已注册的）。
 * @param opts 可选项：config 透传给组件的配置（任意 JSON）、
 *   onSuccess/onFail 分流目标列、reward 奖励键值表（用 {@link reward} 构造）、
 *   z 实例层级。
 * @returns `minigame` 故事命令。
 * @example
 * minigame("cook", {
 *   reward: [reward("coin", "+= 20")],
 *   onSuccess: "dish_done",
 * });
 */
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

/**
 * 构造一条奖励条目，配合 {@link minigame} 的 `reward` 使用：
 * 小游戏成功后把 `value` 写进状态键 `key`（`value` 支持 `"{expr}"`
 * 运行期求值，如 `"+= 20"` 复合赋值）。
 * @param key 收纳奖励的状态变量名。
 * @param value 奖励值（字面量或 `"{expr}"` 表达式串）。
 * @returns 奖励键值对。
 */
export function reward(
  key: string,
  value: ScriptValue,
): { key: string; value: ScriptValue } {
  return { key, value };
}
