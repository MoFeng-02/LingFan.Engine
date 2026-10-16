/**
 * 演示宿主的引擎用户可见文案：只改槽位名一处，其余沿用引擎缺省。
 *
 * 面板怎么称呼槽位，报错里就怎么称呼——改名规则在 `withSlotLabels` 里，
 * 宿主只决定「拿哪张底表、要改哪几句」。
 */
import { defaultEngineTexts, type EngineTexts } from "@lingfan/engine";
import { withSlotLabels } from "@lingfan/shell";

/** 演示宿主注入引擎的文案表（未改写的句子 = 引擎缺省） */
export const playgroundEngineTexts: EngineTexts =
  withSlotLabels(defaultEngineTexts);
