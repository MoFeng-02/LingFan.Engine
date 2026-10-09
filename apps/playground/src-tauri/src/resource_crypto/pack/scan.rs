//! 打包扫描：按扩展名与排除规则加密目录，并保留相对结构。

use crate::paths::hidden_name;
use crate::resource_crypto::error::{ResourceCryptoError, io};
use crate::resource_crypto::format::{encrypt_lfen2, is_encrypted};
use crate::resource_crypto::pack::report::{PackEntry, PackScan};
use crate::resource_crypto::pack::run::{ensure_pack_paths_distinct};
use crate::resource_crypto::v2::{V2_AUTO_THRESHOLD, V2_DEFAULT_CHUNK_LOG2, encrypt_lfen2_v2_file};
use std::fs;
use std::path::Path;
use std::path::PathBuf;

/// 打包工具：目录批量加密——按扩展名过滤、
/// 已加密（魔数检测）直接复制、结构保留、输出 = 原路径 + `.enc`。
/// `exclusions` = 相对路径排除集（精确匹配 `project.json` 或目录前缀 `Saves/`——
/// 运行时生成的目录与明文清单不进加密流）。
#[allow(dead_code)]
pub(crate) fn encrypt_directory(
    input: &Path,
    output: &Path,
    key: &[u8],
    extensions: &[&str],
    exclusions: &[&str],
) -> Result<Vec<PathBuf>, ResourceCryptoError> {
    // 同路径防护：output = input 会把 .enc 写回源目录旁（明文/密文同目录共存形态）
    ensure_pack_paths_distinct(input, output)?;
    let mut written = Vec::new();
    let mut scan = PackScan::default();
    encrypt_directory_inner(
        input,
        input,
        output,
        key,
        extensions,
        exclusions,
        "",
        false,
        &mut written,
        &mut scan,
    )?;
    Ok(written)
}

/// 排除判定：排除项精确匹配文件，或以 `目录/` 前缀匹配整棵子树
fn is_excluded(rel_str: &str, exclusions: &[&str]) -> bool {
    exclusions
        .iter()
        .any(|x| rel_str == *x || (x.ends_with('/') && rel_str.starts_with(*x)))
}

// 目录递归遍历的装配参数面（定位/输出/密钥/过滤/前缀/收集器）——收进结构体只挪参数不降复杂度

#[allow(clippy::too_many_arguments)]
/// 扫描目录并按扩展名加密命中的文件，把每项去向记进 `PackScan`。
pub(crate) fn encrypt_directory_inner(
    root: &Path,
    dir: &Path,
    output: &Path,
    key: &[u8],
    extensions: &[&str],
    exclusions: &[&str],
    prefix: &str,
    force_v2: bool,
    written: &mut Vec<PathBuf>,
    scan: &mut PackScan,
) -> Result<(), ResourceCryptoError> {
    let entries = fs::read_dir(dir).map_err(io)?;
    for entry in entries {
        let path = entry.map_err(io)?.path();
        if path.is_dir() {
            encrypt_directory_inner(
                root, &path, output, key, extensions, exclusions, prefix, force_v2, written, scan,
            )?;
            continue;
        }
        // 根相对逻辑路径（`\` 归一 `/`）——收集判据与其它遍历点共用
        let rel_str = format!(
            "{prefix}{}",
            crate::paths::relative_slash_path(root, &path)
        );
        if is_excluded(&rel_str, exclusions) {
            scan.excluded.push(PackEntry {
                path: rel_str,
                reason: "排除集（运行期产物 / 密钥引导 / 清单）",
            });
            continue;
        }
        // 点文件判定共用底座（含隐藏目录下的条目：段首点前缀与 `/` 后点前缀）
        if hidden_name(&rel_str) || rel_str.contains("/.") {
            scan.excluded.push(PackEntry {
                path: rel_str,
                reason: "点文件（隐藏 / 系统）",
            });
            continue; // 排除项与点文件（隐藏/系统）不进包
        }
        let ext = path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if !extensions.iter().any(|e| *e == ext) {
            scan.skipped.push(PackEntry {
                path: rel_str,
                reason: "扩展名白名单外（不静默明文；如属资源请扩充白名单）",
            });
            continue;
        }
        scan.encrypted.push(rel_str.clone());
        let out = output.join(format!("{rel_str}.enc"));
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(io)?;
        }
        let data_len = path.metadata().map_err(io)?.len();
        // 强制 v2（前端产物 dist 收录）：这些文件按协议 v2 路径按需供给——小文件也必须存成 v2
        // 分块形态（单块特例），否则读取端按 v2 读头会失败并返回 404
        if force_v2 || data_len > V2_AUTO_THRESHOLD {
            // 大文件走 v2 分块流式加密（内存 = 单块；lfstream 按需解密不落明文缓存）
            encrypt_lfen2_v2_file(&path, &out, key, &rel_str, V2_DEFAULT_CHUNK_LOG2)?;
        } else {
            let data = fs::read(&path).map_err(io)?;
            if is_encrypted(&data) {
                fs::write(&out, &data).map_err(io)?; // 已加密：原样复制（幂等重打包）
            } else {
                fs::write(&out, encrypt_lfen2(&data, key, &rel_str)?).map_err(io)?;
            }
        }
        written.push(out);
    }
    Ok(())
}

/// 打包内容文件扩展白名单：故事/文本（json/story）+ 图/音/视频/字体——
/// 白名单外文件不进包（缺类型时运行期资源缺失 fail-closed 暴露，不静默明文）。
pub(crate) const PACK_EXTENSIONS: &[&str] = &[
    "json", "story", // 故事与译文件（清单除外，由排除规则处理）
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", // 图
    "ogg", "wav", "mp3", "m4a", "aac", "flac", "opus", // 音
    "mp4", "webm", "mov", "mkv", "avi", // 视频
    "ttf", "otf", "woff", "woff2", // 字体
];

/// 前端构建产物（dist）收录白名单：js/css + 字体/图——
/// **html 除外**（入口 html 是壳嵌入的明文例外，绝不能混进加密输入；
/// html 出现在 dist 输入 = 上游流程错，落报告 skipped 由打包者决断）。
pub(crate) const PACK_DIST_EXTENSIONS: &[&str] = &[
    "js", "css", // 业务产物（含编译后的 js/ts）
    "png", "jpg", "jpeg", "gif", "webp", "svg", // 产物内静态图
    "woff", "woff2", "ttf", "otf", // 字体
];

/// 打包输出排除集：清单（明文转换）+ 运行时生成的存档目录 + 包内密钥种子（输出侧专属）
pub(crate) const PACK_EXCLUSIONS: &[&str] = &["project.json", "Saves/", "__key__.seed"];
