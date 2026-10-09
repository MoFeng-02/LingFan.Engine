/**
 * 存档接线：槽位下拉与存 / 读两个按钮。
 *
 * 槽位有几个、叫什么，由引擎按工程配置裁定（`project.json` 的 `shell.saves.slots`），
 * 宿主只负责把 id 放进 `<option>`。槽位口径若搬进宿主，「改工程配置却不生效」就会变成
 * 难查的静默失败。
 *
 * 存 / 读都走引擎既有命令面：宿主不自己拼存档数据；写档失败的可见诊断由引擎出站事件
 * 统一给出（见 `engine-wiring.ts`）。
 */

import { resolveSavesConfig, slotIds, type StoryEngine } from "@lingfan/engine";
import type { StageDom } from "./stage-dom";

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

/** 接线存 / 读按钮：槽位取下拉当前选中值 */
export function wireSaveSlots(dom: StageDom, engine: StoryEngine): void {
  dom.save.addEventListener("click", () => {
    engine.save(dom.slot.value);
  });
  dom.load.addEventListener("click", () => {
    engine.load(dom.slot.value);
  });
}
