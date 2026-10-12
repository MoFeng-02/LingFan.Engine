/**
 * Script 词汇层 · **叙事域**（say / menu / input / notify / nvl / character）。
 * 产物 = StoryCommand 数据（与 JSON 同族）；形状知识只在此处，作者只说人话。
 * 返回类型 = `CommandOf<op>`（派生自 OP_SCHEMA_MAP，与 validateCommand 同源）——
 * builder 形状漂移（漏字段 / 错字段）编译期报红，不再只靠互锁测试兜底。
 */
import type { CommandOf } from "../../schema";
import type { KnownColumnName, KnownInterpolationKey } from "./cells";

// —— `{key}` 插值键的编译期校验（纯类型层，零运行期成本）——
//
// 只在**字符串字面量**上生效：模板串、变量、宽 string 全部放行（动态文本没法查，
// 也不该吓唬作者）；键表来自生成物 `Stories.src/gen/stories.gen.d.ts`。
// 富文本行内标记必须豁免——`{b}`/`{color=#FFD700}` 这类与插值共用一个花括号语法，
// 豁免表对齐引擎 `runtime/expr/interpolate.ts` 的行内标记集。
type TrimText<S extends string> = S extends ` ${infer R}`
  ? TrimText<R>
  : S extends `${infer R} `
    ? TrimText<R>
    : S;

type InlineTextTag =
  | "b"
  | "/b"
  | "i"
  | "/i"
  | "u"
  | "/u"
  | "w"
  | "fast"
  | "p"
  | `color=${string}`
  | "/color"
  | `font=${string}`
  | "/font"
  | `size=${string}`
  | "/size";

/** `{key:00}` 的 `:格式` 后缀先剥掉再查表 */
type StripTextFormat<S extends string> = S extends `${infer K}:${string}`
  ? TrimText<K>
  : TrimText<S>;

/** 查表失败时把这个键留在参数类型里，报错信息即可读出是哪个键 */
type BadInterpolationKey<K extends string> = {
  readonly __插值键未登记: K;
};

type CheckTextAt<
  S extends string,
  Whole extends string,
> = S extends `${string}{${infer Inner}}${infer Rest}`
  ? StripTextFormat<Inner> extends InlineTextTag
    ? CheckTextAt<Rest, Whole>
    : StripTextFormat<Inner> extends KnownInterpolationKey
      ? CheckTextAt<Rest, Whole>
      : BadInterpolationKey<StripTextFormat<Inner>>
  : Whole;

/** 文本参数类型：字面量按 `{…}` 逐键校验，非字面量原样放行 */
export type InterpolatedText<S extends string> = S & CheckTextAt<S, S>;

/** say 的可选项（say 负载中除 text / speaker 外的全部字段，均可省略） */
export type SayOptions = Omit<CommandOf<"say">, "op" | "text" | "speaker">;

/**
 * 让角色说一句话：玩家看到一句对话，点击或按键后故事才继续。
 *
 * - 文本先查翻译表，再做 `{var}` 插值（`{var:00}` 保留两位小数）；插值失败
 *   保留原文显示并发出错误事件，不中断故事。
 * - 进入等待的这一刻就是回溯检查点；开启 autoSave 时这里是自动存档点。
 * - `color` 只覆盖本句说话人颜色（优先于角色定义）；`voice` 播放本句语音，
 *   句子推进后自动停止；`instant` / `typewriter` 控制打字机显示；
 *   `template` 指定本句对话框模板（优先于角色定义的 screen）。
 *
 * @param text 台词；可含 `{var}` 插值，在显示时求值。必填非空。
 *   字面量文本的插值键在编译期对表（生成物注册表），拼错即红；富文本行内标记豁免。
 * @param speaker 说话人显示名（同样支持翻译与插值）；省略则本句不显示说话人名。
 * @param opts 其余可选项，见 {@link SayOptions}。
 * @returns `say` 故事命令，写进当前列即为一句对话。
 * @example
 * say("欢迎来到 {place}！", "向导");
 * say("上好绸缎，客官……", "商人", { color: "#FFD700", voice: "audio/hi.ogg" });
 */
export function say<const S extends string>(
  text: InterpolatedText<S>,
  speaker?: string,
  opts?: SayOptions,
): CommandOf<"say"> {
  return {
    op: "say",
    text,
    ...(speaker === undefined ? {} : { speaker }),
    ...opts,
  };
}

/** 菜单选项：一项显示文字 + 选中后要跳去的目标列名 */
export type MenuOption = CommandOf<"menu">["options"][number];

/**
 * 构造一个菜单选项，配合 {@link menu} 使用：玩家点中这一项后，
 * 故事跳进 `target` 指向的那一列（列名即标签）继续。
 * @param text 选项上显示的文字（支持翻译与插值）。
 * @param target 选中后进入的目标列名（`stories.gen.d.ts` 存在时收窄为列名字面量联合）。
 * @returns 菜单选项数据。
 * @example
 * menu("去哪儿？", [
 *   option("酒馆", "to_inn"),
 *   option("广场", "to_square"),
 * ]);
 */
export function option(text: string, target: KnownColumnName): MenuOption {
  return { text, target };
}

/**
 * 弹出一张选项菜单：玩家看到 `prompt`（可省略）与若干选项，选中一项后
 * 故事跳进该选项的目标列继续。
 *
 * - 选项文字与提示语都走翻译表；等待期间建立回溯检查点。
 * - 菜单出现前会清掉上一句对话的残留画面。
 *
 * @param prompt 菜单上方的问题/提示语；省略则只显示选项。
 * @param options 选项列表（至少一项），用 {@link option} 构造。
 * @returns `menu` 故事命令。
 * @example
 * menu("先做什么？", [
 *   option("买药水", "shop"),
 *   option("打听消息", "gossip"),
 * ]);
 */
export function menu(
  prompt: string | undefined,
  options: readonly MenuOption[],
): CommandOf<"menu"> {
  return {
    op: "menu",
    ...(prompt === undefined ? {} : { prompt }),
    options: [...options],
  };
}

/**
 * 向玩家要一段文字：弹出输入框显示 `prompt`，玩家提交后，输入内容写进
 * 状态键 `store`，故事从下一句继续。
 *
 * 等待期间建立回溯检查点；开启 autoSave 时此处自动存档。
 *
 * @param prompt 输入框上方显示的问题/提示语（必填非空）。
 * @param store 收纳玩家输入的状态变量名（写进全局状态，之后可用 `{store}` 插值显示）。
 * @returns `input` 故事命令。
 * @example
 * input("主角叫什么名字？", "playerName");
 * say("你好，{playerName}！");
 */
export function input(prompt: string, store: string): CommandOf<"input"> {
  return { op: "input", prompt, store };
}

/** type 保持手写的窄联合（schema 是 string）——作者侧补全优于校验面放宽 */
export interface NotifyOptions {
  type?: "info" | "success" | "warning" | "error";
  duration?: number;
  z?: number;
}

/**
 * 弹一条系统通知（toast）：在画面上短暂显示 `text` 后自动消失，
 * 故事不等待、立即执行下一句。
 *
 * - 通知是一次性画面效果，不进存档/回溯状态。
 * - 文本先查翻译表再做 `{var}` 插值（同 {@link say}）。
 *
 * @param text 通知内容（必填非空）；插值键同 {@link say} 在编译期对表。
 * @param opts 可选项：type 决定样式（info/success/warning/error，缺省 info）、
 *   duration 控制停留时长、z 控制层级。
 * @returns `notify` 故事命令。
 * @example
 * notify("已保存", { type: "success" });
 */
export function notify<const S extends string>(
  text: InterpolatedText<S>,
  opts?: NotifyOptions,
): CommandOf<"notify"> {
  return { op: "notify", text, ...opts };
}

export type NvlMode = NonNullable<CommandOf<"nvl">["mode"]>;

/**
 * 切换 NVL（整屏文本）模式。本命令立即生效、故事继续，不等待。
 *
 * - `"enter"`（缺省）：激活 NVL，此后每句 {@link say} 的文本都会累积
 *   显示在整屏文本框里，直到退出。
 * - `"auto"`：同 enter，激活累积层。
 * - `"clear"`：清空已累积的文本，但仍处于 NVL 模式。
 * - `"exit"`：清空并退出 NVL，回到普通对话框显示。
 *
 * 累积文本属于核心状态：回溯、存档/读档自动保持一致。
 *
 * @param mode NVL 动作，缺省 `"enter"`。
 * @returns `nvl` 故事命令。
 * @example
 * nvl();            // 进入整屏文本模式
 * say("第一段……");
 * nvl("clear");     // 清屏，继续整屏
 * nvl("exit");      // 退出整屏，恢复对话框
 */
export function nvl(mode?: NvlMode): CommandOf<"nvl"> {
  return { op: "nvl", ...(mode === undefined ? {} : { mode }) };
}

export type CharacterOptions = Omit<CommandOf<"character">, "op" | "key">;

/**
 * 注册（或更新）一名角色：说话人名字、颜色、字号、字体、文字颜色、
 * 对话框模板。立即生效、故事继续，不等待。
 *
 * 注意：对同一 `key` 重复调用会**整体替换**定义——本次没传的字段
 * 会回到无定义状态，而不是保留上次值。
 *
 * @param key 角色键（say 的 speaker 名按它查表取样式）。
 * @param opts 角色属性：name 显示名、color 说话人颜色、size 字号、
 *   font 字体、textColor 台词文字颜色、screen 对话框模板。
 * @returns `character` 故事命令。
 * @example
 * character("向导", { name: "阿岚", color: "#7FD4FF" });
 * say("跟上我。", "向导");
 */
export function character(
  key: string,
  opts?: CharacterOptions,
): CommandOf<"character"> {
  return { op: "character", key, ...opts };
}
