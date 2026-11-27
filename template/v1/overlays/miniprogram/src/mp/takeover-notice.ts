/**
 * 不支持的外部接管等待态诊断：minigame / interaction / extension 三种挂载事件
 * 在没有渲染通道的宿主上必须显式出声——故事会停在这些等待态，静默只改状态
 * 等于「永久停滞且无从下手」，比报一行错难查得多。
 *
 * 判据与 mount 诊断同口径：同一次接管只报一次（重放 = 新 seq 新 signal，会重新报），
 * 文案说清「哪个系统 / 什么后果 / 怎么离开」。本模块纯逻辑，不碰平台与 DOM。
 */
import type { OutboundPayload } from "@lingfan-engine/core";

/** 一条接管诊断：去重键 + 展示文案；非接管事件返回 null */
export interface TakeoverNotice {
  /** 去重键（种类 + 身份 + seq：重放重新挂载要能重新出声） */
  key: string;
  /** 展示给作者/玩家的整句诊断 */
  text: string;
}

/**
 * 把一条出站事件翻成接管诊断。三种等待形态各有身份键：
 * minigame 用 `game`、interaction 用 `system`、extension 用 `op`。
 *
 * @param payload 引擎出站负载
 * @param hostName 宿主称谓（进文案，如「小程序宿主」）
 */
export function takeoverNoticeOf(
  payload: OutboundPayload,
  hostName: string,
): TakeoverNotice | null {
  switch (payload.kind) {
    case "minigame.mount":
      return {
        key: `minigame:${payload.game}:${payload.seq}`,
        text: `${hostName}不支持小游戏（minigame）：${payload.game} 已进入等待但不会被挂载（故事会停在这里；回溯 / 导航可离开，或改在支持 minigame 的宿主运行）`,
      };
    case "interaction.mount":
      return {
        key: `interaction:${payload.system}:${payload.seq}`,
        text: `${hostName}不支持玩法系统接管（interaction）：${payload.system} 已进入等待但不会被挂载（故事会停在这里；回溯 / 导航可离开，或改在支持 interaction 的宿主运行）`,
      };
    case "extension.mount":
      return {
        key: `extension:${payload.op}:${payload.seq}`,
        text: `${hostName}不支持扩展等待界面（extension）：${payload.op} 已进入等待但没有确认界面（故事会停在这里；回溯 / 导航可离开，或改在支持扩展覆盖层的宿主运行）`,
      };
    default:
      return null;
  }
}

/**
 * 接管诊断的去重出口：同一 key 只报一次，直到 `reset`（可见集合清空 / 宿主重建）。
 * 报与不报都返回布尔，调用方据此决定是否落诊断口——本模块不持有诊断口本身。
 */
export interface TakeoverNoticeGate {
  /** 首次见到该 key 返回 true（应上报）；重复返回 false（不刷屏） */
  admit(key: string): boolean;
  /** 忘掉全部已报 key（下一次同 key 会重新出声） */
  reset(): void;
}

/** 造一个去重出口 */
export function createTakeoverNoticeGate(): TakeoverNoticeGate {
  const seen = new Set<string>();
  return {
    admit(key: string): boolean {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
    reset(): void {
      seen.clear();
    },
  };
}
