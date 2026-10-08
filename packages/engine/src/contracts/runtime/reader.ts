/**
 * 状态读口契约：把引擎状态里的系统键读成**有类型的值**。
 *
 * **为什么要有这一层**：系统键的值一律是 `unknown`——它可能来自被改坏的存档、
 * 异版本的载荷，也可能只是引擎自己刚写下的。界面直接按键读，就得各自强转、
 * 或各写一份形状校验；同一份形状知识散在多个界面里，改一处必漏一处。
 * 读口把「键 → 类型化取值 + 畸形载荷降级」收成**一处**：消费方拿到的是已经判过
 * 形状的值，不必也不应再写第二份校验。
 *
 * **降级口径（fail-closed）**：形状不合契约一律退回该字段的安全默认值
 * （空串 / 空数组 / `null` / `0` / `"none"`），**绝不把畸形值翻译成有意义的读结果**
 * ——被篡改的存档不能让界面去播放一个不存在的资源。
 *
 * **读口只读**：它不改状态、不驱动帧，也不替代通用读口 `StoryEngine.get`
 * （后者仍供引擎内部与「按任意键取值」的场景使用）。
 */
import type { ElementInstance } from "../element";
import type { AudioChannel, AudioChannelState, VideoCommand } from "../media";
import type { LayerZOverrides } from "../shell";

/**
 * 取值来源：任何能按键读状态的对象都满足。
 *
 * 只要求这一个方法是有意为之——引擎实例满足它，测试替身、只读快照、状态代理也满足，
 * 于是读口不必依赖 `StoryEngine` 的全部能力，凡是「能读」的地方都能复用同一份校验。
 */
export interface StateSource {
  get(key: string): unknown;
}

/** 菜单选项：文本与目标列成对（数组顺序即呈现顺序） */
export interface MenuChoice {
  text: string;
  target: string;
}

/**
 * 类型化读口：按用途分组读状态。
 *
 * 每个方法都自带形状校验与降级（见文件头），返回值即界面可直接使用的形态；
 * 引擎写入的值总是合法的，校验是为「值可能被外部改坏」的路径准备的。
 */
export interface StateReader {
  /** 音频通道当前状态；从未触碰或形状不合 = `null`（界面据此判「无媒体」） */
  audioChannel(channel: AudioChannel): AudioChannelState | null;
  /** 背景乐播放位置（秒；帧级键，缺省 0） */
  mediaPosition(): number;
  /** 视频命令；无命令或形状不合 = `null` */
  videoCommand(): VideoCommand | null;
  /** 菜单选项（文本与目标列成对；两键分属不同状态条目，任一畸形都按空处理） */
  menuChoices(): MenuChoice[];
  /** 当前说话人（缺省空串） */
  dialogSpeaker(): string;
  /** 当前正文（缺省空串） */
  dialogText(): string;
  /** 说话人颜色覆盖值（**空串 = 无覆盖**，界面回落角色定义色） */
  dialogColor(): string;
  /** 对话框模板名（**`null` = 全局默认**） */
  dialogTemplate(): string | null;
  /** 对话框是否隐藏（`window hide`） */
  dialogHidden(): boolean;
  /** 等待状态（`__waiting`；**缺省空串** = 尚未建立等待，界面按 `none` 呈现） */
  waiting(): string;
  /** 菜单提示语（缺省空串） */
  menuPrompt(): string;
  /** 输入提示语（缺省空串） */
  inputPrompt(): string;
  /** NVL 模式（`__nvl_mode`；**缺省空串** = 未进入累积层，界面按 `none` 呈现） */
  nvlMode(): string;
  /** NVL 累积行（缺省空数组） */
  nvlLines(): string[];
  /** 舞台元素（缺省空数组） */
  elements(): ElementInstance[];
  /** 实例级 z 覆盖：只含显式指定过的层（缺省 = 层默认） */
  instanceZOverrides(): LayerZOverrides;
}
