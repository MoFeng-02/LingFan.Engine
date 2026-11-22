/**
 * 第六章 · 功能演示枢纽：把引擎的玩家功能逐站陈列——persistent 已读 / skip·auto 节奏 /
 * 音频实例多轨 / 不可回溯段 / 小游戏与交互分流（含文本创作列）。各站演示真机制，演毕回枢纽。
 */
import { script } from "@lingfan-engine/editor";

const { menu, option, say } = script;

import { moodThinking, portraitNeutral } from "../lib/portraits";

export default function feat_hub(): void {
  portraitNeutral();
  say("功能演示章——这里逐站陈列引擎的玩家功能，每一站都是真机制。", "灵泛");
  say("选一站进去体验；演毕可回枢纽，或去词汇全席继续巡览。", "灵泛");
  moodThinking();
  menu("体验哪一站？", [
    option("已读与快进（persistent·skip）", "feat_skip"),
    option("音频实例多轨（四通道）", "feat_audio"),
    option("不可回溯段（rollback 锁）", "feat_rollback"),
    option("小游戏与交互（分流文本列）", "feat_play"),
    option("回词汇巡览", "tour"),
    option("回主线菜单", "start"),
  ]);
}
