//! i18n overlay 读取：按语言收集键值对，兼容目录、单文件与加密形态。

use crate::project_files::languages::{LANG_ROOT};
use crate::project_files::supply::{ProjectFilesError, resource_root_with_key};
use crate::resource_fs::ResourceFs;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;

/// 单个 overlay 译文文件：overlay 根内相对路径（`/` 分隔；`main.json` = 全局兜底）
/// → 原文→译文映射。BTreeMap<String, String> 反序列化（字符串字典）：
/// 含非字符串值/坏 JSON 的文件整体无效 → 跳过（宽松口径）。
#[derive(Debug, Serialize, Clone)]
pub struct OverlayFile {
    pub path: String,
    pub entries: BTreeMap<String, String>,
}

/// lang 路径段校验（fail-closed：字母数字/_/-，1..32，防路径穿越）——字符集与长度走通用段规则
fn valid_lang(lang: &str) -> bool {
    const LANG_RULE: crate::paths::SegmentRule = crate::paths::SegmentRule::alnum_ext(Some(32));
    crate::paths::validate_plain_segment(lang, &LANG_RULE).is_ok()
}

/// 读取某语言 overlay 文件（按需加载策略）：
/// 目录形式 `Lang/{lang}/` 递归收集 .json（含 `.json.enc` 加密译文），按路径排序输出确定性；
/// 目录缺失 → 降级单文件 `Lang/{lang}.json`（以 `main.json` 供给 = 全局兜底语义）。
/// 合并序（main.json 最先、其余按序覆盖）归引擎 TS 侧（mergeOverlayFiles——叙事语义引擎可测）；
/// key = 清单声明 resourceEncryption 时的 DEK（`.enc` 译文解密，AAD 与故事同规则 = 资源根相对路径去 .enc）。
pub(crate) fn load_overlay_files(
    resfs: &dyn ResourceFs,
    root: &Path,
    lang: &str,
    key: Option<&[u8]>,
) -> Result<Vec<OverlayFile>, ProjectFilesError> {
    if !valid_lang(lang) {
        return Err(ProjectFilesError::Io(format!("非法语言段：{lang}")));
    }
    let lang_dir = root.join(LANG_ROOT).join(lang);
    let single = root.join(LANG_ROOT).join(format!("{lang}.json"));
    let mut paths: Vec<std::path::PathBuf> = Vec::new();
    if resfs.is_dir(&lang_dir) {
        for entry in resfs
            .walk(&lang_dir)
            .map_err(|e| ProjectFilesError::Io(e.to_string()))?
        {
            if entry.is_dir {
                continue; // walk 已递归下钻
            }
            let name = entry
                .path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            if crate::paths::hidden_name(&name) {
                continue;
            }
            if name.ends_with(".json") || name.ends_with(".json.enc") {
                paths.push(entry.path);
            }
        }
    } else if resfs.is_file(&single) {
        paths.push(single);
    }
    paths.sort();
    let lang_prefix = format!("{LANG_ROOT}/{lang}/");
    let mut out = Vec::new();
    for path in paths {
        // 根相对逻辑路径（`\` 归一 `/`）——收集判据与其它遍历点共用
        let root_rel = crate::paths::relative_slash_path(root, &path);
        let bytes = resfs
            .read(&path)
            .map_err(|e| ProjectFilesError::Io(e.to_string()))?;
        let (logical, text) = if let Some(stripped) = root_rel.strip_suffix(".enc") {
            let k = key.ok_or_else(|| {
                ProjectFilesError::Decrypt(format!(
                    "加密译文 {root_rel} 但清单未声明 resourceEncryption（fail-closed）"
                ))
            })?;
            let plain = crate::resource_crypto::decrypt_resource_bytes(bytes, k, stripped)
                .map_err(|e| ProjectFilesError::Decrypt(format!("{root_rel}：{e}")))?;
            (
                stripped.to_string(),
                String::from_utf8(plain).map_err(|_| {
                    ProjectFilesError::Decrypt(format!("{root_rel} 解密后非 UTF-8"))
                })?,
            )
        } else {
            (
                root_rel.clone(),
                String::from_utf8(bytes)
                    .map_err(|_| ProjectFilesError::Io(format!("非 UTF-8 译文文件：{root_rel}")))?,
            )
        };
        // overlay 内相对路径：`Lang/{lang}/` 前缀剥离；单文件降级（Lang/{lang}.json）→ "main.json"
        let overlay_rel = logical
            .strip_prefix(&lang_prefix)
            .map_or_else(|| "main.json".to_string(), str::to_string);
        let Ok(entries) = serde_json::from_str::<BTreeMap<String, String>>(&text) else {
            continue; // 单文件宽松：坏 JSON / 含非字符串值 → 跳过（宽松口径）
        };
        out.push(OverlayFile {
            path: overlay_rel,
            entries,
        });
    }
    Ok(out)
}

/// I18N overlay 供给命令（按需：setLanguage 时调用，启动零成本）
#[tauri::command]
pub fn load_i18n_overlay(
    app: tauri::AppHandle,
    lang: String,
) -> Result<Vec<OverlayFile>, ProjectFilesError> {
    let (root, key) = resource_root_with_key(&app)?;
    let resfs = crate::resource_fs::resource_fs(&app);
    load_overlay_files(&*resfs, &root, &lang, key.as_deref())
}
