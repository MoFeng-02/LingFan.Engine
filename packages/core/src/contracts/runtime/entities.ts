/**
 * 运行实体契约：等待状态、NVL 模式与角色定义——引擎运行期对外表达状态时用的值。
 * 这些值经系统键或命令面进出，不是端口。
 */

/** 等待状态（`__waiting` 取值全集；闭集增员不折员——扩展 op 等待态不折入 "interaction"） */
export type WaitingState =
  | "none"
  | "dialog"
  | "menu"
  | "wait"
  | "minigame"
  | "interaction"
  | "input"
  | "video"
  | "extension";

/** NVL 模式（`__nvl_mode` 取值）：累积层开关与清屏动作 */
export type NvlMode = "none" | "active" | "clear" | "exit";

/**
 * 一条挂载记录：某个 UI 组件该不该出现在渲染树上、带什么入参。
 *
 * `visible: false` 的语义是**从渲染树移除**（卸载组件），不是 `display: none`——
 * 隐藏的组件不该继续跑生命周期、计时器与副作用。
 */
export interface MountEntry {
  /** 是否挂在渲染树上 */
  visible: boolean;
  /** 传给组件的入参（JSON 安全；缺省 = 空对象） */
  props: Record<string, unknown>;
}

/**
 * 挂载表（`__mounts` 取值）：UI 名 → 挂载记录。
 *
 * 核心只认识名字与显隐，不认识组件内部；整表一个值 ⇒ 快照 / 存档 / 回溯零特判随行。
 * 写时整表新建（写时复制），原地改会与快照共享引用。
 */
export type MountTable = Readonly<Record<string, MountEntry>>;

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
