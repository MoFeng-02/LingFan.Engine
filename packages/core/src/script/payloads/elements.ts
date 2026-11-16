/**
 * 元素域 op 负载：元素增删改（show / hide / background / bg_switch / zindex /
 * style / window）+ 帧驱动表现类（animate / animate_block / transition / shake /
 * text_typewriter）。
 *
 * 负载用 type 别名（对象字面量带隐式索引签名，CommandOf 产物可赋给
 * StoryCommand 的开放索引签名）；域 map 用 interface。字段面以执行器为权威；
 * x/y 收数字（px）或 CSS 长度串；运行期约束（非空 / 有限）归 editor 校验器。
 */
import type { ScriptValue } from "./shared.ts";

/** show：追加元素（x/y 数字 px 或 CSS 长度串；background 背景位） */
export type ShowOpPayload = {
  target: string;
  x?: number | string;
  y?: number | string;
  id?: string;
  name?: string;
  background?: boolean;
};

/** hide：按 id / name / 资源路径移除元素（幂等，未找到不动作） */
export type HideOpPayload = {
  target: string;
};

/** background：换背景（先清旧背景再追加固定最底层的新背景） */
export type BackgroundOpPayload = {
  resource: string;
};

/** bg_switch：切换背景（与 background 同语义的另一形式） */
export type BgSwitchOpPayload = {
  resource: string;
};

/** zindex：调整元素层级（数字越大越靠上） */
export type ZindexOpPayload = {
  target: string;
  value: number;
};

/** style：批量改元素展示属性（键限元素系统支持的属性集） */
export type StyleOpPayload = {
  target: string;
  props: Record<string, ScriptValue>;
};

/** window：对话框显隐（auto 跟随对话 / show 显示 / hide 隐藏） */
export type WindowOpPayload = {
  mode: "auto" | "show" | "hide";
};

/** animate：单属性平滑过渡（故事不等待动画播完） */
export type AnimateOpPayload = {
  target: string;
  property: string;
  value: number;
  duration?: number;
  easing?: string;
};

/** animate_block：多属性同时过渡（共用 duration 并行插值） */
export type AnimateBlockOpPayload = {
  target: string;
  x?: number;
  y?: number;
  opacity?: number;
  rotation?: number;
  scale?: number;
  duration?: number;
  easing?: string;
};

/** transition：全屏转场（type 转场名 / duration 时长秒） */
export type TransitionOpPayload = {
  type: string;
  duration?: number;
};

/** shake：画面震动（intensity 强度 / duration 时长秒） */
export type ShakeOpPayload = {
  intensity?: number;
  duration?: number;
};

/** text_typewriter：全局打字机效果（enabled 开关 / speed 字符每秒） */
export type TextTypewriterOpPayload = {
  enabled?: boolean;
  speed?: number;
};

export interface ElementsPayloadMap {
  show: ShowOpPayload;
  hide: HideOpPayload;
  background: BackgroundOpPayload;
  bg_switch: BgSwitchOpPayload;
  zindex: ZindexOpPayload;
  style: StyleOpPayload;
  window: WindowOpPayload;
  animate: AnimateOpPayload;
  animate_block: AnimateBlockOpPayload;
  transition: TransitionOpPayload;
  shake: ShakeOpPayload;
  text_typewriter: TextTypewriterOpPayload;
}
