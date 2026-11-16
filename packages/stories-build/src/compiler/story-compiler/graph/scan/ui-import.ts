import type { StoriesBuildTexts } from "../../../../shared/index.ts";
import type { DiagBag, ModuleRecord } from "../core.ts";
import { resolveComponentImports, uiImportHooks } from "./component-import.ts";
import type { UiChannel } from "./ui-specifier.ts";

/**
 * UI 导入通道的落账一段：组件导入通道的 UI 实例。
 *
 * 判定与落账的实体都在组件通道里（`component-import.ts`）；这里只把 UI 自己的通道、
 * 落账表（`uis`）与措辞绑在一起，好让调用方继续按「UI」说话。
 */
export function resolveUiImports(
  record: ModuleRecord,
  diags: DiagBag,
  channel: UiChannel,
  texts: StoriesBuildTexts,
): void {
  resolveComponentImports(
    record,
    diags,
    channel.component,
    uiImportHooks(texts),
  );
}
