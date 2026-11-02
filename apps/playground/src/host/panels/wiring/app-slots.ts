/**
 * 槽位面板的宿主侧装配：存/读共用槽位面板（槽位数与缩略图参数来自 shell.saves
 * 配置）。打开时 list() + 逐槽 read() 取标题/缩略图（读取失败按空槽呈现，点选时
 * 再走引擎 fail-closed）。
 *
 * 存的路上多一个「存档名」：面板顶部的输入框是**这次要用的名字**，留空就由
 * `resolveSaveTitle` 兜底（沿用该槽旧名，旧名也没有就自动生成）。点槽位即写盘，
 * 不再多一步确认——名字是标签，写盘才是动作，玩家想改名就在输入框里填新名字再点。
 */

import { ref, type ComputedRef, type Ref } from "vue";
import {
  slotIds,
  type SavePort,
  type SavesConfig,
  type StoryEngine,
} from "@lingfan-engine/core";
import type { DialogueTemplateView } from "@lingfan-engine/ui";
import {
  captureSaveThumbnail,
  captureStageComposite,
  collectStageMedia,
  stripHtml,
} from "../../../stage-capture";
import {
  loadSlotViews,
  type SlotPanelMode,
  type SlotView,
} from "@lingfan-engine/shell";
import { resolveSaveTitle } from "../views/index.ts";

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

/** 槽位面板能力：显隐模式、逐槽视图、存档名草稿与存读点选 */
export interface AppSlots {
  /** 槽位面板显隐与模式（save/load/null） */
  slotPanel: Ref<SlotPanelMode | null>;
  /** 逐槽快照视图（打开面板时刷新） */
  slotViews: Ref<SlotView[]>;
  /** 这次存档要用的名字（留空 = 沿用旧名 / 自动起名，见 `resolveSaveTitle`） */
  titleDraft: Ref<string>;
  /** 打开面板：list + 逐槽 read */
  openSlotPanel: (mode: SlotPanelMode) => Promise<void>;
  /** 点选槽位：存（带名字写盘）/读（load） */
  chooseSlot: (view: SlotView) => Promise<void>;
}

/** 装配槽位面板：打开时拉取逐槽视图，点选按模式走带名写盘或读 */
export function createAppSlots(options: AppSlotsOptions): AppSlots {
  const { props, dialogView, stageEl, getEngine } = options;
  const slotPanel = ref<SlotPanelMode | null>(null);
  const slotViews = ref<SlotView[]>([]);
  const titleDraft = ref("");
  const slotIdList = (): string[] => slotIds(props.saves.slots);
  /** 重读逐槽视图：写盘后槽位上的名字/时间/缩略图都变了 */
  async function refreshViews(): Promise<void> {
    slotViews.value = await loadSlotViews({
      savePort: props.savePort,
      slotIds: slotIdList(),
    });
  }
  async function openSlotPanel(mode: SlotPanelMode): Promise<void> {
    slotPanel.value = mode;
    titleDraft.value = "";
    await refreshViews();
  }
  /** 合成缩略图：真像素分层优先（元素图/视频帧），污染或失败降级合成卡（尽力而为） */
  function capture(): string {
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
    // 基准取舞台根的实际占位（含适配变换）：媒体包围盒也是变换后的真像素，
    // 两者同基准才能等比例映射进缩略图（clientWidth 是变换前的布局尺寸，会错档）
    const stageBox = stageEl.value?.getBoundingClientRect();
    try {
      return captureStageComposite({
        ...base,
        stage: { width: stageBox?.width ?? 0, height: stageBox?.height ?? 0 },
        media: collectStageMedia(stageEl.value),
      });
    } catch {
      return captureSaveThumbnail(base);
    }
  }
  async function chooseSlot(view: SlotView): Promise<void> {
    if (slotPanel.value === "load") {
      slotPanel.value = null;
      getEngine().load(view.id);
      return;
    }
    if (slotPanel.value !== "save") return;
    // 名字先定下来再关面板：`resolveSaveTitle` 要读该槽原有的名字，
    // 那是关闭前的 `slotViews` 才有的事实
    const title = resolveSaveTitle({
      typed: titleDraft.value,
      previous: view.title,
      now: Date.now(),
    });
    getEngine().save(view.id, { screenshot: capture(), title });
    titleDraft.value = "";
    await refreshViews();
  }
  return { slotPanel, slotViews, titleDraft, openSlotPanel, chooseSlot };
}
