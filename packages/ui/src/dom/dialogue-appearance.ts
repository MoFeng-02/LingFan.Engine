/**
 * 对话框外观偏好 → CSS 变量投影。变量名以本文件导出的常量为单一声明，宿主样式表
 * 用 `var()` 引用同一组名字，避免两侧各写一份字面量而漂移。
 *
 * 玩家偏好只改「显示」，不改叙事语义：透明度/字号倍率/高度倍率落成 CSS 自定义属性，
 * 由宿主样式表消费（`var(--lf-dialogue-*)`，缺省回退内建外观）；位置落成 data 属性，
 * 由宿主按 bottom/top/center 换定位规则。装配时投影一次，并订阅偏好改动即时重投。
 *
 * 字体族（fontFamily）不在此投影：它依赖宿主 storyFonts 注册表校验链（无效字体须
 * fail-closed 而非静默），属后续批；逐句 say.font/character.font 显式声明仍优先。
 *
 * 落 DOM 物化域：投影直接写元素的 style/属性，是 ui 内唯一允许碰 DOM 的目录职责。
 */
import type { PlayerPreferences } from "@lingfan-engine/core";

/** 对话框背景透明度倍率（0..1，乘宿主底色 alpha；缺省=不透明外观） */
export const DIALOGUE_OPACITY_VAR = "--lf-dialogue-opacity";
/** 对话框正文字号倍率（0.5..3；缺省 1=宿主默认字号） */
export const DIALOGUE_FONT_SCALE_VAR = "--lf-dialogue-font-scale";
/** 对话框最小高度倍率（0.5..2；缺省=宿主默认高度） */
export const DIALOGUE_HEIGHT_SCALE_VAR = "--lf-dialogue-height-scale";
/** 对话框位置（bottom/top/center；缺省 bottom=宿主默认定位） */
export const DIALOGUE_POSITION_ATTR = "data-lf-dialogue-position";

/**
 * 把对话框外观偏好投影到对话框元素，返回退订函数。
 * 三态字段（透明度/高度/位置）未设置时移除对应变量/属性，让宿主样式回退内建外观；
 * 字号倍率恒有值（缺省 1），始终投影。偏好改动经 onChange 即时重投（滑杆 live）。
 */
export function applyDialogueAppearance(
  el: HTMLElement,
  preferences: PlayerPreferences,
): () => void {
  const project = (): void => {
    const opacity = preferences.dialogueOpacity;
    if (opacity === undefined) el.style.removeProperty(DIALOGUE_OPACITY_VAR);
    else el.style.setProperty(DIALOGUE_OPACITY_VAR, String(opacity));

    el.style.setProperty(
      DIALOGUE_FONT_SCALE_VAR,
      String(preferences.fontScale),
    );

    const heightScale = preferences.dialogueHeightScale;
    if (heightScale === undefined)
      el.style.removeProperty(DIALOGUE_HEIGHT_SCALE_VAR);
    else el.style.setProperty(DIALOGUE_HEIGHT_SCALE_VAR, String(heightScale));

    const position = preferences.dialoguePosition;
    if (position === undefined) el.removeAttribute(DIALOGUE_POSITION_ATTR);
    else el.setAttribute(DIALOGUE_POSITION_ATTR, position);
  };
  project();
  return preferences.onChange(project);
}
