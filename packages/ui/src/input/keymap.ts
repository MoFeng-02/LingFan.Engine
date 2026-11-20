/**
 * 键位匹配：把一次按键判给某个动作。
 *
 * 玩家改绑后的键位（override）优先于内建默认（fallback）；两者都按大小写不敏感比较，
 * 于是「绑了 A」与「按下 a」是同一件事。override 缺席（没改绑 / 该动作被逐项降级清空）
 * 就落回 fallback——缺省不等于「这个动作没有键」。
 *
 * 键位字符串支持组合键 `[mod+]<key>`（mod = ctrl/shift/alt/meta，如 "ctrl+s"）：
 * 修饰键须精确匹配——绑 "ctrl+s" 只在按住 Ctrl 时命中，绑纯 "s" 只在没按修饰键时命中。
 * 修饰键本身可作键（如快进绑 "Control" 按住持续）：按下该修饰键即命中，不再校验旗标。
 * 纯键（无 mod 前缀）向后兼容：只比 key，修饰旗标按缺席（false）处理。
 *
 * 纯函数、不碰 DOM：宿主（原生模板 / 框架壳）与改绑面板共用这一份判定，
 * 避免「面板里绑的键」和「游戏里认的键」各算各的而出现两套口径。
 */

/** 一次按键里本判定用得到的最小面（KeyboardEvent 满足它，测试替身也只需给 key） */
export interface KeyLike {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
}

/** 可作键位本身的修饰键名（按下即命中，不再校验对应旗标） */
const MODIFIER_KEYS = new Set(["control", "shift", "alt", "meta"]);

/** 判定单个键位串是否命中本次按键（大小写不敏感；组合键修饰旗标精确匹配） */
function matchOne(event: KeyLike, binding: string): boolean {
  const parts = binding.toLowerCase().split("+");
  const key = parts[parts.length - 1];
  if (event.key.toLowerCase() !== key) return false;
  // 修饰键本身（如快进绑 Control）：按下即命中
  if (MODIFIER_KEYS.has(key)) return true;
  const mods = parts.slice(0, -1);
  return (
    (event.ctrlKey ?? false) === mods.includes("ctrl") &&
    (event.shiftKey ?? false) === mods.includes("shift") &&
    (event.altKey ?? false) === mods.includes("alt") &&
    (event.metaKey ?? false) === mods.includes("meta")
  );
}

/**
 * 判定按键是否命中某动作的键位。
 * @param override 玩家改绑后的键位（缺席 = 未改绑，落回默认）
 * @param fallback 内建默认键位
 * @param event 本次按键（取 `key` 与修饰旗标，大小写不敏感）
 */
export function matchesKeybinding(
  override: readonly string[] | undefined,
  fallback: readonly string[],
  event: KeyLike,
): boolean {
  return (override ?? fallback).some((binding) => matchOne(event, binding));
}
