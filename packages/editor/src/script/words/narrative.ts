/**
 * Script 词汇层 · **叙事域**（say / menu / input / notify / nvl / character）。
 * 产物 = StoryCommand 数据（与 JSON 同族）；形状知识只在此处，作者只说人话。
 * 返回类型 = `CommandOf<op>`（派生自 OP_SCHEMA_MAP，与 validateCommand 同源）——
 * builder 形状漂移（漏字段 / 错字段）编译期报红，不再只靠互锁测试兜底。
 */
import type { CommandOf } from "../../schema/opSchemas";

export type SayOptions = Omit<CommandOf<"say">, "op" | "text" | "speaker">;

export function say(
  text: string,
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

export type MenuOption = CommandOf<"menu">["options"][number];

export function option(text: string, target: string): MenuOption {
  return { text, target };
}

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

export function input(prompt: string, store: string): CommandOf<"input"> {
  return { op: "input", prompt, store };
}

/** type 保持手写的窄联合（schema 是 string）——作者侧补全优于校验面放宽 */
export interface NotifyOptions {
  type?: "info" | "success" | "warning" | "error";
  duration?: number;
  z?: number;
}

export function notify(
  text: string,
  opts?: NotifyOptions,
): CommandOf<"notify"> {
  return { op: "notify", text, ...opts };
}

export type NvlMode = NonNullable<CommandOf<"nvl">["mode"]>;

export function nvl(mode?: NvlMode): CommandOf<"nvl"> {
  return { op: "nvl", ...(mode === undefined ? {} : { mode }) };
}

export type CharacterOptions = Omit<CommandOf<"character">, "op" | "key">;

export function character(
  key: string,
  opts?: CharacterOptions,
): CommandOf<"character"> {
  return { op: "character", key, ...opts };
}
