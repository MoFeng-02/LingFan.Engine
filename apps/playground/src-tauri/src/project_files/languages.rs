//! 可用语言枚举：语言目录与语言文件的名称收集。

use crate::project_files::supply::{resource_root_with_key};
use crate::resource_fs::ResourceFs;
use std::path::Path;

/// i18n 译文根目录名（资源根内）。
pub(crate) const LANG_ROOT: &str = "Lang";

/// 可用语言列表：
/// 扫描资源根 `Lang/` 的子目录名与单文件名（.json 与 .json.enc 均识别——
/// 通配 *.json 在加密形态会漏 .json.enc 单文件语言，此处修正）；
/// 恒含默认语言 "zh-CN"（大小写不敏感去重）；其余按字典序输出确定性。
/// `Lang/` 缺失 = 仅默认语言（目录存在性同语义，不报错）。
pub(crate) fn scan_i18n_languages(resfs: &dyn ResourceFs, root: &Path) -> Vec<String> {
    const DEFAULT_LANG: &str = "zh-CN";
    let mut langs: Vec<String> = vec![DEFAULT_LANG.to_string()];
    let lang_root = root.join(LANG_ROOT);
    let entries = match resfs.walk(&lang_root) {
        Ok(entries) => entries,
        Err(_) => return langs,
    };
    for entry in entries {
        // 仅直接子项（单层扫描语义不变；walk 是递归的，深层条目在此剔除）
        let Ok(rel) = entry.path.strip_prefix(&lang_root) else {
            continue;
        };
        if rel.components().count() != 1 {
            continue;
        }
        let Some(name) = entry
            .path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
        else {
            continue;
        };
        if crate::paths::hidden_name(&name) {
            continue;
        }
        let lang = if entry.is_dir {
            Some(name)
        } else {
            name.strip_suffix(".json.enc")
                .or_else(|| name.strip_suffix(".json"))
                .map(|s| s.to_string())
        };
        if let Some(lang) = lang {
            if !lang.is_empty() && !langs.iter().any(|l| l.eq_ignore_ascii_case(&lang)) {
                langs.push(lang);
            }
        }
    }
    langs[1..].sort();
    langs
}

/// 可用语言列表命令：资源根定位失败（含移动端 asset 形态）宽容降级 = 仅默认语言
/// （语言选择器恒可用；供给能力归 load_i18n_overlay 自己 fail-closed）。
#[tauri::command]
pub fn list_i18n_languages(app: tauri::AppHandle) -> Vec<String> {
    let resfs = crate::resource_fs::resource_fs(&app);
    match resource_root_with_key(&app) {
        Ok((root, _)) => scan_i18n_languages(&*resfs, &root),
        Err(_) => vec!["zh-CN".to_string()],
    }
}
