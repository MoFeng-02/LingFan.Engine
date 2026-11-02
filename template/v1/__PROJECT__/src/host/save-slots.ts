/**
 * 存档接线：槽位下拉、存 / 读两个按钮，以及存档缩略图。
 *
 * 槽位有几个、叫什么，由引擎按工程配置判定（`project.json` 的 `shell.saves.slots`），
 * 宿主只负责把 id 放进 `<option>`。槽位口径若搬进宿主，「改工程配置却不生效」就会变成
 * 难查的静默失败。缩略图的尺寸/质量/是否带文本同理，全部来自 `shell.saves.thumbnail`。
 *
 * 存 / 读都走引擎既有命令面：宿主不自己拼存档数据；写档失败的可见诊断由引擎出站事件
 * 统一给出（见 `engine-wiring.ts`）。
 *
 * 缩略图是**可选增强**：合成失败（老 WebView 没有 canvas 2d 上下文）就存一张没有图的档，
 * 而不是让这次存档整体失败——存档能用优先于卡片好看。
 */

import {
  SYS,
  resolveProjectName,
  resolveSavesConfig,
  slotIds,
  type StoryEngine,
} from "@lingfan-engine/core";
import type { StageDom } from "./stage-dom";
import { captureSaveThumbnail, stripHtml } from "./thumbnails";

/** 按工程清单里的存档壳配置填充槽位下拉（调用方保证只填一次） */
export function fillSaveSlots(dom: StageDom, manifest: unknown): void {
  const saves = resolveSavesConfig(manifest);
  for (const id of slotIds(saves.slots)) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    dom.slot.append(option);
  }
}

/** 从引擎状态取一个字符串（缺键 / 非字符串都当空串，避免把 undefined 画进卡片） */
function readText(engine: StoryEngine, key: string): string {
  const value = engine.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * 合成当前存档的缩略图（data URL）；失败返回 undefined 让存档照常落盘。
 *
 * 取的是**当前对话帧**：此刻玩家点的「存」，看到的就是这一句，卡片理应也是这一句。
 * 标题用工程展示名——存档列表里认出「这是哪个工程」比认出「这是第几槽」更有用。
 */
function captureThumbnail(
  engine: StoryEngine,
  manifest: unknown,
): string | undefined {
  const { thumbnail } = resolveSavesConfig(manifest);
  try {
    return captureSaveThumbnail({
      width: thumbnail.width,
      height: thumbnail.height,
      quality: thumbnail.quality,
      showText: thumbnail.showText,
      title: resolveProjectName(manifest),
      speaker: readText(engine, SYS.currentDialogSpeaker),
      text: stripHtml(readText(engine, SYS.currentDialogText)),
      timestamp: Date.now(),
    });
  } catch {
    // 没有 canvas 2d 上下文：降级为无图存档，不阻断存盘
    return undefined;
  }
}

/** 接线存 / 读按钮：槽位取下拉当前选中值 */
export function wireSaveSlots(
  dom: StageDom,
  engine: StoryEngine,
  manifest: unknown,
): void {
  dom.save.addEventListener("click", () => {
    const screenshot = captureThumbnail(engine, manifest);
    engine.save(
      dom.slot.value,
      screenshot === undefined ? undefined : { screenshot },
    );
  });
  dom.load.addEventListener("click", () => {
    engine.load(dom.slot.value);
  });
}
