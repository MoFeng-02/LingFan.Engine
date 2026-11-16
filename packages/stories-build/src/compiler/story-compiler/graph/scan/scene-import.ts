import type { StoriesBuildTexts } from "../../../../shared/index.ts";
import type { DiagBag, ModuleRecord } from "../core.ts";
import {
  resolveComponentImports,
  sceneImportHooks,
} from "./component-import.ts";
import type { SceneChannel } from "./scene-specifier.ts";

/**
 * 场景导入通道的落账一段：组件导入通道的场景实例。
 *
 * 与 UI 那一遍形状完全一样，只有通道、落账表（`scenes`）与措辞不同——两张表各记各的，
 * 一个模块里同时导入 UI 与场景也不会互相盖掉名字。
 */
export function resolveSceneImports(
  record: ModuleRecord,
  diags: DiagBag,
  channel: SceneChannel,
  texts: StoriesBuildTexts,
): void {
  resolveComponentImports(
    record,
    diags,
    channel.component,
    sceneImportHooks(texts),
  );
}
