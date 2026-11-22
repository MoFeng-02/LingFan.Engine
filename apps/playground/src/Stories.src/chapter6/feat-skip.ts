/**
 * 第六章 · 已读与快进站：persistent 跨档已读 + skip/auto 节奏。
 * 推进过的 say 记入 persistent 已读层（跨存档、跨会话存活）；偏好「仅未读停」开启后
 * skip 快进已读、遇未读即停，二周目已读段可快进。noskip 句是硬闸门：skip/auto 都不推进。
 */
import { script } from "@lingfan-engine/editor";

const { jump, say, wait } = script;

import { moodNeutral, moodSerious, portraitNeutral } from "../lib/portraits";

export default function feat_skip(): void {
  portraitNeutral();
  say("已读与快进站。先正常读一遍下面的句子——推进过的会被记为已读。", "灵泛");
  say(
    "引擎把每句 say 的已读坐标存进 persistent 层，跨存档、跨会话存活。",
    "灵泛",
  );
  say(
    "打开工具栏 Skip，并在偏好里启用「仅未读停」：skip 快进已读、遇到未读停下。",
    "灵泛",
  );
  say("这一句故意未读——开了「仅未读停」时，skip 会在这里停住等你。", "灵泛");
  say("Auto 则按偏好延时自动推进，与 skip 共用节奏闸门。", "灵泛");
  moodSerious();
  say(
    "下面这句是 noskip 硬闸门：skip 与 auto 都不推进它，只能手动点击前进。",
    "灵泛",
    {
      noskip: true,
    },
  );
  moodNeutral();
  wait(0.8, { skipable: true });
  say(
    "读完后离开再回来（或读档重来），已读段就能被 skip 快进——这就是跨档已读。",
    "灵泛",
  );
  say(
    "提示：工具栏 Auto/Skip 快捷按钮与偏好开关由宿主提供，状态实时生效。",
    "灵泛",
  );
  jump("feat_hub");
}
