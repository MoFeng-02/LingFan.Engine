/**
 * 玩法域 op 负载：minigame（小游戏）/ interaction（外部玩法系统接管）。
 *
 * 负载用 type 别名（对象字面量带隐式索引签名，CommandOf 产物可赋给
 * StoryCommand 的开放索引签名）；域 map 用 interface。config 原样透传
 * UI / 系统（任意 JSON）；reward 是小游戏专属语义（interaction 无 reward）。
 * 运行期约束（非空）归 editor 校验器。
 */
import type { ScriptValue } from "./shared.ts";

/** 奖励条目：成功后把 value 写进状态键 key（value 支持 {expr} 运行期求值） */
export type RewardSpec = {
  key: string;
  value: ScriptValue;
};

/** minigame：进入小游戏（胜负分流 on_success / on_fail + 奖励 reward） */
export type MinigameOpPayload = {
  game: string;
  config?: Record<string, unknown>;
  on_success?: string;
  on_fail?: string;
  reward?: RewardSpec[];
  z?: number;
};

/** interaction：外部玩法系统整屏接管（与 minigame 同形，无 reward） */
export type InteractionOpPayload = {
  system: string;
  config?: Record<string, unknown>;
  on_success?: string;
  on_fail?: string;
  z?: number;
};

export interface GameplayPayloadMap {
  minigame: MinigameOpPayload;
  interaction: InteractionOpPayload;
}
