/**
 * 运行实体契约：等待状态、NVL 模式与角色定义——引擎运行期对外表达状态时用的值。
 * 这些值经系统键或命令面进出，不是端口。
 */

/** 等待状态（`__waiting` 取值全集） */
export type WaitingState =
  | "none"
  | "dialog"
  | "menu"
  | "wait"
  | "minigame"
  | "interaction"
  | "input"
  | "video";

/** NVL 模式（`__nvl_mode` 取值）：累积层开关与清屏动作 */
export type NvlMode = "none" | "active" | "clear" | "exit";

/** 角色定义（character op 注册；say speaker 匹配自动套样式） */
export interface CharacterDef {
  key: string;
  name?: string;
  color?: string;
  size?: string;
  font?: string;
  textColor?: string;
  /** 角色级对话框模板（say.template 优先于此） */
  screen?: string;
}
