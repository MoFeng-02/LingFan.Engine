/**
 * 玩家偏好的优先级链解析（纯函数，core 零 DOM，宿主只消费不另写）。
 *
 * 三层模型：玩家显式偏好 > 工程/故事声明 > 内建默认。解析函数把「缺省 ≠ 显式」
 * 的三态语义收敛成一个确定值；系统级事实（如「减弱动态效果」）由宿主测得后作为
 * 入参注入，核心不触碰 DOM。偏好与存档分离，回溯/读档不改偏好，整局稳定。
 */
import type { TextSpeedSource } from "../../contracts/index.ts";

/** 字速解析的输入：玩家偏好值与归属声明、故事声明值、内建兜底 */
export interface TextSpeedResolution {
  /** 玩家偏好字速（字符/秒；偏好层已保证 ≥1，这里仍做防御校验）；缺省 = 未接偏好层 */
  player?: number;
  /** 字速归属声明；缺省 = 玩家偏好覆盖故事设置（既有行为） */
  source?: TextSpeedSource;
  /** 故事 `text_typewriter` 声明的字速；未声明或非法时缺席 */
  story?: number;
  /** 内建兜底字速（玩家与故事都没给合法值时用） */
  fallback: number;
}

/**
 * 字速三级链的单一解析口径（纯函数，宿主只消费不另写）：
 * - 显式 "story"：锁作者声明——故事给了合法值就用它，否则内建兜底；玩家滑杆
 *   仍记住偏好值，但不作用于当前故事。
 * - 缺省或显式 "player"：玩家偏好 > 故事声明 > 内建兜底（缺省保持既有覆盖行为）。
 *
 * 合法值口径：有限正数；玩家值另夹下限 1（0 会让打字机永远推不完）。
 * 偏好与存档分离：回溯/读档不改偏好，所以同一台机器上字速整局稳定。
 */
export function resolveTextSpeed(input: TextSpeedResolution): number {
  const story = input.story;
  const storyValid =
    typeof story === "number" && Number.isFinite(story) && story > 0;
  if (input.source === "story") {
    return storyValid ? story : input.fallback;
  }
  const player = input.player;
  if (typeof player === "number" && Number.isFinite(player) && player > 0) {
    return Math.max(1, player);
  }
  return storyValid ? story : input.fallback;
}

/** 减弱动效解析的输入：玩家显式声明、系统「减弱动态效果」事实（宿主测得注入） */
export interface ReducedMotionResolution {
  /** 玩家显式偏好；缺省 = 跟随系统（三态，不补默认） */
  player?: boolean;
  /** 系统级「减弱动态效果」开关（宿主从媒体查询测得）；缺省按 false */
  system?: boolean;
}

/**
 * 减弱动效三级链：玩家显式 > 系统媒体查询 > 内建 false。
 * 玩家没表态时跟随系统；系统与玩家都缺席则不减动效。纯函数，系统事实由宿主注入。
 */
export function resolveReducedMotion(input: ReducedMotionResolution): boolean {
  return input.player ?? input.system ?? false;
}

/** 语言解析的输入：存档语言、玩家偏好种子、工程默认语言 */
export interface LanguageResolution {
  /** 存档里的语言（读档时传入；语言是故事事实，读档时它赢） */
  save?: string;
  /** 玩家偏好语言（仅作新会话启动种子） */
  player?: string;
  /** 工程默认语言（manifest.lang） */
  manifest?: string;
}

/**
 * 语言优先级链（存档语言赢 + 偏好会话种子 + 工程默认）：
 * - 读档：存档语言是故事事实，优先于玩家偏好；
 * - 新会话：玩家偏好种子 > 工程默认；
 * - 都缺席返回 undefined，由宿主回落内建语言。
 * 会话中切换语言由宿主写故事状态并记住到偏好，不经过本函数。
 */
export function resolveLanguage(input: LanguageResolution): string | undefined {
  return input.save ?? input.player ?? input.manifest;
}
