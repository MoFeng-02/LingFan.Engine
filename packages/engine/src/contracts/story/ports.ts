/**
 * 故事格式的供给端口：语言文件从哪来（按需加载）。
 * 数据形态（故事、清单、译文文件）见同目录 `entities.ts`。
 */
import type { I18nOverlayFile } from "./entities";

/**
 * I18N overlay 供给端口（按需加载；组合根经 EngineOptions 注入；缺省 = 原文直出）。
 * 文件列举/解密归供给侧（Rust `load_i18n_overlay`：目录 `Lang/{lang}/` 递归收集 +
 * 降级单文件 `Lang/{lang}.json` 以 `main.json` 供给）；main.json 兜底合并序归引擎
 * （mergeOverlayFiles——叙事语义，引擎侧可测）。返回列表顺序必须确定（适配器保证）；
 * Promise 拒绝 = 载入失败（引擎 fail-closed 保持原语言不变）。
 */
export interface I18nPort {
  loadOverlayFiles(lang: string): Promise<I18nOverlayFile[]>;
  /**
   * 可用语言列表（扫描 `Lang/` 子目录与单文件，恒含默认语言 zh-CN）。
   * 可选——缺省 = ["zh-CN"]（组合根未实现时语言选择器只显默认语言）。
   */
  listLanguages?(): Promise<string[]>;
}
