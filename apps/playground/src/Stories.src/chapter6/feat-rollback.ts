/**
 * 第六章 · 不可回溯段站：op 级 block_rollback 开头锁定、fix_rollback 收尾解锁。
 * 锁定期间 engine.rollbackAvailable()=false，宿主据此禁用 back/滚轮回退/历史按钮（段级 scoped）。
 * 这是剧情关键节点的「不可反悔」真机制；historyLimit 是工程级 shell.historyLimit，非列级。
 */
import { script } from "@lingfan-engine/editor";

const { blockRollback, fixRollback, jump, say, wait } = script;

import { moodNeutral, moodSerious, portraitNeutral } from "../lib/portraits";

export default function feat_rollback(): void {
  portraitNeutral();
  say("不可回溯段站。锁定前，back/滚轮/历史按钮都可用。", "灵泛");
  blockRollback();
  moodSerious();
  say("已锁定回退：此刻起 back、滚轮回退、历史按钮都被宿主禁用。", "灵泛");
  say("这是不可回溯段——剧情关键节点，玩家无法反悔。", "灵泛");
  wait(0.6, { skipable: true });
  say("段内推进若干句，锁定持续生效；快照仍记录，只是不允许回退。", "灵泛");
  fixRollback();
  moodNeutral();
  say("解锁回退：back 恢复可用。不可回溯段演示完毕。", "灵泛");
  jump("feat_hub");
}
