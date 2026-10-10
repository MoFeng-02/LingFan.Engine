/**
 * 槽位面板的宿主侧装配：存/读共用槽位面板（槽位数与缩略图参数来自 shell.saves
 * 配置）。打开时 list() + 逐槽 read() 取标题/缩略图（读取失败按空槽呈现，点选时
 * 再走引擎 fail-closed）。存 = 合成缩略图（canvas 卡片）+ engine.save(slot,
 * { screenshot })；读 = engine.load(slot)。
 */

import { ref, type ComputedRef, type Ref } from "vue";
import { slotIds, type SavePort, type SavesConfig, type StoryEngine } from "@lingfan/engine";
import type { DialogueTemplateView } from "@lingfan/ui";
import {
  captureSaveThumbnail,
  captureStageComposite,
  collectStageMedia,
  stripHtml,
} from "../shell";
import { loadSlotViews, type SlotPanelMode, type SlotView } from "./slot-panel";

/** 装配入参：存档端口与壳配置、对话框视图、舞台根与引擎句柄 */
export interface AppSlotsOptions {
  /** 组合根注入的宿主属性（存档端口与存档壳配置） */
  props: {
    savePort: SavePort;
    saves: SavesConfig;
  };
  /** 对话框视图（存档缩略图的说话人与正文摘录来源） */
  dialogView: ComputedRef<DialogueTemplateView>;
  /** 舞台根（真像素合成时取舞台尺寸与媒体分层） */
  stageEl: Ref<HTMLElement | null>;
  /** 引擎句柄取用（存读命令；重启重建后指向新实例） */
  getEngine: () => StoryEngine;
}

/** 槽位面板能力：显隐模式、逐槽视图、打开面板与存读点选 */
export interface AppSlots {
  /** 槽位面板显隐与模式（save/load/null） */
  slotPanel: Ref<SlotPanelMode | null>;
  /** 逐槽快照视图（打开面板时刷新） */
  slotViews: Ref<SlotView[]>;
  /** 打开面板：list + 逐槽 read */
  openSlotPanel: (mode: SlotPanelMode) => Promise<void>;
  /** 点选槽位：存（合成缩略图 + save）/读（load） */
  chooseSlot: (view: SlotView) => Promise<void>;
}

/** 装配槽位面板：打开时拉取逐槽视图，点选按模式走存（合成缩略图）或读 */
export function createAppSlots(options: AppSlotsOptions): AppSlots {
  const { props, dialogView, stageEl, getEngine } = options;
  const slotPanel = ref<SlotPanelMode | null>(null);
  const slotViews = ref<SlotView[]>([]);
  async function openSlotPanel(mode: SlotPanelMode): Promise<void> {
    slotPanel.value = mode;
    slotViews.value = await loadSlotViews({
      savePort: props.savePort,
      slotIds: slotIds(props.saves.slots),
    });
  }
  async function chooseSlot(view: SlotView): Promise<void> {
    const mode = slotPanel.value;
    slotPanel.value = null;
    if (mode === "save") {
      const base = {
        width: props.saves.thumbnail.width,
        height: props.saves.thumbnail.height,
        quality: props.saves.thumbnail.quality,
        showText: props.saves.thumbnail.showText,
        speaker: dialogView.value.speakerHtml
          ? stripHtml(dialogView.value.speakerHtml)
          : undefined,
        text: stripHtml(dialogView.value.bodyHtml),
        timestamp: Date.now(),
      };
      // 真像素分层合成优先（元素图/视频帧）；污染/失败降级合成卡（尽力而为）
      let shot: string;
      try {
        shot = captureStageComposite({
          ...base,
          stage: {
            width: stageEl.value?.clientWidth ?? 0,
            height: stageEl.value?.clientHeight ?? 0,
          },
          media: collectStageMedia(stageEl.value),
        });
      } catch {
        shot = captureSaveThumbnail(base);
      }
      getEngine().save(view.id, { screenshot: shot }); // 标题沿用 save op 参数（如有）
    } else if (mode === "load") {
      getEngine().load(view.id);
    }
  }
  return { slotPanel, slotViews, openSlotPanel, chooseSlot };
}
