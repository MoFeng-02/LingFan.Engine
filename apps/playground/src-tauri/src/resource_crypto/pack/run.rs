//! 打包入口：输入输出路径互斥校验，以及不带 dist 与带 dist 两种打包流程。

use crate::resource_crypto::dek::{DEK_SEED, generate_resource_seed};
use crate::resource_crypto::error::{ResourceCryptoError, io};
use crate::resource_crypto::format::{MAGIC_LFEN2, decrypt_resource_bytes};
use crate::resource_crypto::pack::report::{PackEntry, PackReport, PackScan};
use crate::resource_crypto::pack::scan::{PACK_DIST_EXTENSIONS, PACK_EXCLUSIONS, PACK_EXTENSIONS, encrypt_directory_inner};
use crate::resource_crypto::v2::{FORMAT_VERSION_V2, V2_HEADER_LEN, verify_v2_file};
use std::fs;
use std::path::Path;
use std::path::PathBuf;

/// 打包路径关系防护（**数据安全红线**）：输出根与工程根**相同或存在嵌套关系**一律拒绝。
/// - output == input：`lfenpack --force` 清空输出 = 删光源工程（自毁）；
/// - output 在 input 内：打包产物嵌进源工程（源污染 + 二次打包吸收风险）；
/// - input 在 output 内：清空 output 会连带毁掉源工程。
///
/// canonicalize 统一真实大小写与 verbatim 前缀后再做组件级前缀比较；
/// output 不存在时向上归一其最近存在祖先再拼回剩余段。
pub fn ensure_pack_paths_distinct(input: &Path, output: &Path) -> Result<(), ResourceCryptoError> {
    let normalize = |path: &Path| -> Result<PathBuf, ResourceCryptoError> {
        let mut tail: Vec<std::ffi::OsString> = Vec::new();
        let mut cur = path.to_path_buf();
        loop {
            match fs::canonicalize(&cur) {
                Ok(real) => {
                    let mut out = real;
                    for seg in tail.iter().rev() {
                        out.push(seg);
                    }
                    return Ok(out);
                }
                Err(_) => match (cur.file_name(), cur.parent()) {
                    (Some(name), Some(parent)) => {
                        tail.push(name.to_os_string());
                        cur = parent.to_path_buf();
                    }
                    _ => {
                        return Err(ResourceCryptoError::Io(format!(
                            "路径无法归一：{}",
                            path.display()
                        )))
                    }
                },
            }
        }
    };
    let input_n = normalize(input)?;
    let output_n = normalize(output)?;
    if input_n == output_n || output_n.starts_with(&input_n) || input_n.starts_with(&output_n) {
        return Err(ResourceCryptoError::Io(format!(
            "输出根与工程根相同或存在嵌套关系（工程根 {}，输出根 {}）——拒绝打包：防自毁与源工程污染，请把输出根放到工程根之外",
            input.display(),
            output.display()
        )));
    }
    Ok(())
}

/// 打包编排：明文工程根 → 加密发布根（lfenpack CLI 的可测核心）。
/// - 输出根 fail-closed：已存在且非空 = 拒绝（不覆盖创作者成果；`--force` 由 CLI 显式清空后重入）
/// - 清单恒明文转换：`resourceEncryption` 置 true（运行时形态判定依赖清单先可读）
/// - DEK 新生成 → 写输出根 `__key__.seed`（运行时首次导入即 KEK 封装）
/// - 内容文件全量 LFEN2（白名单扩展 + 排除集），`原路径 + .enc`，结构保留
/// - `dist`：前端构建产物目录，以 `dist/` 逻辑路径前缀收录（html 落报告 skipped）；
///   收录非空时输出清单补 `frontend.assets` 映射段（清单恒明文，只多一组路径）
/// - 完整性自检：输出逐文件解密回读 == 源明文（round-trip，打包完整性 fail-closed）
#[allow(dead_code)]
pub(crate) fn pack_project(input: &Path, output: &Path) -> Result<PackReport, ResourceCryptoError> {
    pack_project_with_dist(input, output, None)
}

/// `dist` 提供时以前端产物白名单收录（`dist/` 逻辑路径前缀，html 落报告 skipped）
pub fn pack_project_with_dist(
    input: &Path,
    output: &Path,
    dist: Option<&Path>,
) -> Result<PackReport, ResourceCryptoError> {
    // 路径关系防护最前置（先于非空检查——语义优先级：自毁/污染红线 > 覆盖确认）
    ensure_pack_paths_distinct(input, output)?;
    if output.exists() {
        let non_empty = fs::read_dir(output)
            .map(|mut it| it.next().is_some())
            .unwrap_or(true);
        if non_empty {
            return Err(ResourceCryptoError::Io(format!(
                "输出目录已存在且非空：{}（清空或换目录后再打包）",
                output.display()
            )));
        }
    }

    // 清单明文转换（先校验后落盘：坏清单零副作用——输出目录都不建）
    let manifest_raw = fs::read_to_string(input.join("project.json")).map_err(io)?;
    let mut manifest: serde_json::Value = serde_json::from_str(&manifest_raw)
        .map_err(|e| ResourceCryptoError::Io(format!("清单不是合法 JSON：{e}")))?;
    manifest["resourceEncryption"] = serde_json::Value::Bool(true);

    fs::create_dir_all(output).map_err(io)?;
    // DEK：新随机 → 包内 seed（运行时 resource_dek 信封缺失时从此导入）
    let seed = generate_resource_seed()?;
    fs::write(output.join(DEK_SEED), &seed).map_err(io)?;
    fs::write(
        output.join("project.json"),
        serde_json::to_string_pretty(&manifest)
            .map_err(|e| ResourceCryptoError::Io(format!("清单序列化失败：{e}")))?,
    )
    .map_err(io)?;

    // 内容文件批量加密 + 完整性自检（v2 逐块回读 / v1 全量回读）
    use std::io::Read;
    let mut written = Vec::new();
    let mut scan = PackScan::default();
    encrypt_directory_inner(
        input,
        input,
        output,
        &seed,
        PACK_EXTENSIONS,
        PACK_EXCLUSIONS,
        "",
        false,
        &mut written,
        &mut scan,
    )?;
    // 前端产物收录：dist/ 逻辑路径前缀；html 落报告 skipped（见 PACK_DIST_EXTENSIONS）；
    // 强制 v2 存储（协议 v2 路径供给的前置形态，见 encrypt_directory_inner 的 force_v2 注释）
    if let Some(dist_root) = dist {
        encrypt_directory_inner(
            dist_root,
            dist_root,
            output,
            &seed,
            PACK_DIST_EXTENSIONS,
            &[],
            "dist/",
            true,
            &mut written,
            &mut scan,
        )?;
    }
    for out_path in &written {
        let rel_str = out_path
            .strip_prefix(output)
            .map_err(|e| ResourceCryptoError::Io(e.to_string()))?
            .to_string_lossy()
            .replace('\\', "/");
        let logical = rel_str
            .strip_suffix(".enc")
            .ok_or_else(|| ResourceCryptoError::Io(format!("加密输出缺 .enc 后缀：{rel_str}")))?;
        // dist 收录文件的源在前端产物根，不在工程资源根
        let src = match logical.strip_prefix("dist/") {
            Some(rest) => dist
                .ok_or_else(|| {
                    ResourceCryptoError::Io(format!(
                        "包内出现 dist 文件但未提供 dist 输入：{logical}"
                    ))
                })?
                .join(rest),
            None => input.join(logical),
        };
        let mut head = [0u8; V2_HEADER_LEN];
        let n = fs::File::open(out_path)
            .map_err(io)?
            .read(&mut head)
            .map_err(io)?;
        if n == V2_HEADER_LEN && head.starts_with(MAGIC_LFEN2) && head[5] == FORMAT_VERSION_V2 {
            verify_v2_file(out_path, &seed, logical, &src)?;
        } else {
            let sealed = fs::read(out_path).map_err(io)?;
            let plain = decrypt_resource_bytes(sealed, &seed, logical)?;
            if fs::read(&src).map_err(io)? != plain {
                return Err(ResourceCryptoError::Io(format!(
                    "打包自检失败（回读 ≠ 源明文）：{logical}"
                )));
            }
        }
    }
    // dist 收录非空 → 输出清单补 frontend 映射段（清单恒明文，只多一组路径；
    // dist 产物名与 assets 路径一一对应：`assets/x.js` ↔ `dist/assets/x.js.enc`）
    let dist_assets: Vec<String> = scan
        .encrypted
        .iter()
        .filter(|p| p.starts_with("dist/"))
        .cloned()
        .collect();
    if !dist_assets.is_empty() {
        manifest["frontend"] = serde_json::json!({ "assets": dist_assets });
        fs::write(
            output.join("project.json"),
            serde_json::to_string_pretty(&manifest)
                .map_err(|e| ResourceCryptoError::Io(format!("清单序列化失败：{e}")))?,
        )
        .map_err(io)?;
    }

    Ok(PackReport {
        files: written.len(),
        encrypted: scan.encrypted,
        plaintext: vec![
            PackEntry {
                path: "project.json".into(),
                reason: "工程元数据（非资源，运行期形态判定先决读取）",
            },
            PackEntry {
                path: DEK_SEED.into(),
                reason: "DEK 密钥引导（首启信封化输入）",
            },
        ],
        excluded: scan
            .excluded
            .into_iter()
            // project.json 的实际处置 = 明文转换（见 plaintext），排除集条目只是防重复加密，不进报告
            .filter(|e| e.path != "project.json")
            .collect(),
        skipped: scan.skipped,
    })
}
