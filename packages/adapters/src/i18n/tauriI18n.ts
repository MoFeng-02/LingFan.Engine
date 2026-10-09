/**
 * I18N overlay 供给（Tauri Desktop 原生实现）：invoke 调 Rust `load_i18n_overlay`
 * （目录形式 `Lang/{lang}/` 递归收集 + 降级单文件 `Lang/{lang}.json` 在 Rust 侧；
 * main.json 兜底合并序归引擎）。invoke 可注入（缺省取 Tauri 桥接域的缺省实现）：
 * 组合根无需注入，测试以契约替身注入（不依赖 Tauri 运行时，两侧各测一半的边界即在此）。
 * listLanguages = Rust `list_i18n_languages`。
 */
import type { I18nOverlayFile, I18nPort } from "@lingfan/engine";
import { defaultInvoke, type TauriInvoke } from "../platform";

/** Rust `load_i18n_overlay` 命令负载：overlay 内相对路径 → 原文→译文映射 */
export interface TauriOverlayFile {
  path: string;
  entries: Record<string, string>;
}

/**
 * 造一个多语言端口（桌面/移动原生）：`loadOverlayFiles` 调 Rust `load_i18n_overlay`
 * 取某语言的译文文件，`listLanguages` 调 `list_i18n_languages`。
 * 目录形式与单文件兜底、main.json 合并序都在 Rust 与引擎两侧，本侧只做转发与拷贝。
 */
export function createTauriI18nPort(
  invoke: TauriInvoke = defaultInvoke,
): I18nPort {
  return {
    async loadOverlayFiles(lang: string): Promise<I18nOverlayFile[]> {
      const files = await invoke<TauriOverlayFile[]>("load_i18n_overlay", {
        lang,
      });
      return files.map((f) => ({ path: f.path, entries: { ...f.entries } }));
    },
    async listLanguages(): Promise<string[]> {
      return invoke<string[]>("list_i18n_languages");
    },
  };
}
