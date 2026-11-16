/**
 * 叙事域 op 负载：say / menu / input / notify / nvl / character / uncharacter。
 *
 * 负载用 type 别名而非 interface：TS 只给对象字面量类型隐式索引签名，
 * interface 没有；CommandOf 产物要能赋给 StoryCommand（开放索引签名），
 * 负载必须是字面量类型形态。字段面与 editor zod 校验器一一对应，
 * 运行期约束（非空 / 颜色判据 / 选项数下限）留在校验器侧。
 */

/** say：对白。color 的合法判据（isValidSayColor）在校验器侧 refine */
export type SayOpPayload = {
  text: string;
  speaker?: string;
  color?: string;
  font?: string;
  clickable?: boolean;
  noskip?: boolean;
  instant?: boolean;
  typewriter?: number;
  voice?: string;
  template?: string;
  /** dialogue 层实例 z */
  z?: number;
};

/** menu 选项：text 展示、target 跳转列名 */
export type MenuOptionPayload = {
  text: string;
  target: string;
};

/** menu：分支选项。options 至少一项（min(1) 在校验器侧） */
export type MenuOpPayload = {
  prompt?: string;
  options: MenuOptionPayload[];
  /** choices 层实例 z */
  z?: number;
};

/** input 候选：与 menu 选项刻意不同形（value 是写入值而非跳转目标） */
export type InputCandidatePayload = {
  text: string;
  value: string;
};

/** input：文本输入，store 是写入的状态槽键 */
export type InputOpPayload = {
  prompt: string;
  store: string;
  options?: InputCandidatePayload[];
  /** choices 层实例 z */
  z?: number;
};

/** notify：轻提示。type 是宽 string（作者侧窄联合留词函数 Options） */
export type NotifyOpPayload = {
  text: string;
  type?: string;
  duration?: number;
  /** notifications 层实例 z */
  z?: number;
};

/**
 * nvl：全屏叙事模式切换。mode 用内联字面量联合，不新建命名类型
 * （NvlCommandMode 是词函数侧声明；contracts 的 NvlMode 是运行期实体类型，各归其位）。
 */
export type NvlOpPayload = {
  mode?: "enter" | "auto" | "clear" | "exit";
};

/** character：登记角色样式，key 是之后 say 的说话人引用键 */
export type CharacterOpPayload = {
  key: string;
  name?: string;
  color?: string;
  size?: string;
  font?: string;
  textColor?: string;
  screen?: string;
};

/** uncharacter：注销角色，之后该 key 作说话人不再套角色样式 */
export type UncharacterOpPayload = {
  key: string;
};

/** 叙事域 op → 负载登记（域 map 住域文件，总登记只 extends） */
export interface NarrativePayloadMap {
  say: SayOpPayload;
  menu: MenuOpPayload;
  input: InputOpPayload;
  notify: NotifyOpPayload;
  nvl: NvlOpPayload;
  character: CharacterOpPayload;
  uncharacter: UncharacterOpPayload;
}
