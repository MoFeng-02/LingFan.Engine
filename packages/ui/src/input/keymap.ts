/**
 * 键位匹配：把一次按键判给某个动作。
 *
 * 玩家改绑后的键位（override）优先于内建默认（fallback）；两者都按大小写不敏感比较，
 * 于是「绑了 A」与「按下 a」是同一件事。override 缺席（没改绑 / 该动作被逐项降级清空）
 * 就落回 fallback——缺省不等于「这个动作没有键」。
 *
 * 纯函数、不碰 DOM：宿主（原生模板 / 框架壳）与改绑面板共用这一份判定，
 * 避免「面板里绑的键」和「游戏里认的键」各算各的而出现两套口径。
 */

/** 一次按键里本判定用得到的最小面（KeyboardEvent 满足它，测试替身也只需给 key） */
export interface KeyLike {
  readonly key: string;
}

/**
 * 判定按键是否命中某动作的键位。
 * @param override 玩家改绑后的键位（缺席 = 未改绑，落回默认）
 * @param fallback 内建默认键位
 * @param event 本次按键（取 `key`，大小写不敏感）
 */
export function matchesKeybinding(
  override: readonly string[] | undefined,
  fallback: readonly string[],
  event: KeyLike,
): boolean {
  const pressed = event.key.toLowerCase();
  return (override ?? fallback).some((key) => key.toLowerCase() === pressed);
}
