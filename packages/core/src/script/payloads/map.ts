/**
 * op → 负载总登记：extends 各域 map。
 *
 * 域 map 住域文件——新增负载只改域文件（加负载类型 + 加 map 条目），
 * 本文件一次定型，不随 op 数量增长。
 */
import type { NarrativePayloadMap } from "./narrative.ts";
import type { FlowPayloadMap } from "./flow.ts";
import type { VarsPayloadMap } from "./vars.ts";
import type { SavePayloadMap } from "./save.ts";
import type { AudioPayloadMap } from "./audio.ts";
import type { VideoPayloadMap } from "./video.ts";
import type { ElementsPayloadMap } from "./elements.ts";
import type { GameplayPayloadMap } from "./gameplay.ts";
import type { UiPayloadMap } from "./ui.ts";

export interface OpPayloadMap
  extends
    NarrativePayloadMap,
    FlowPayloadMap,
    VarsPayloadMap,
    SavePayloadMap,
    AudioPayloadMap,
    VideoPayloadMap,
    ElementsPayloadMap,
    GameplayPayloadMap,
    UiPayloadMap {}
