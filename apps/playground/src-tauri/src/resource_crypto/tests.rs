//! 资源加密与打包的行为测试。

use crate::http::RangeSpec;
use crate::http::parse_range;
use crate::paths::PathRuleError;
use crate::resource_crypto::block_cache::v2_block_cache_stats;
use std::fs;
use std::path::PathBuf;
use super::*;
use crate::resource_fs::StdFs;

const KEY: &[u8; 32] = b"0123456789abcdef0123456789abcdef";

#[test]
fn lfen2_round_trip() {
    // 加密往返：解密回读 == 源明文
    let plain = b"audio-bytes".to_vec();
    let sealed = encrypt_lfen2(&plain, KEY, "Audio/x.mp3").unwrap();
    assert!(sealed.starts_with(MAGIC_LFEN2));
    assert_eq!(
        decrypt_resource_bytes(sealed, KEY, "Audio/x.mp3").unwrap(),
        plain
    );
}

#[test]
fn lfen_legacy_read() {
    // LFEN（magic4|version1|nonce12|tag16|ct，无 AAD）兼容解密
    let legacy = [
        b"LFEN".as_slice(),
        &[1u8],
        &[7u8; 12], // nonce
        b"legacy-plain".as_slice(),
        &[0u8; 16], // tag 占位（实际由 gcm 生成，这里构造非法 tag 走失败路径；成功路径见下）
    ]
    .concat();
    // 存量样本：用 gcm_seal（无 AAD）手工构造
    let sealed = crate::crypto::gcm_seal(KEY, b"legacy-plain", &[]).unwrap();
    let real = [b"LFEN".as_slice(), &[1u8], sealed.as_slice()].concat();
    assert_eq!(
        decrypt_resource_bytes(real, KEY, "whatever").unwrap(),
        b"legacy-plain".to_vec()
    );
    // 坏 tag 的样本必须 fail-closed
    assert!(matches!(
        decrypt_resource_bytes(legacy, KEY, "whatever"),
        Err(ResourceCryptoError::Crypto(_))
    ));
}

#[test]
fn aad_binds_resource_path() {
    // AAD 绑路径：加密时路径 A，按路径 B 解密必拒
    let sealed = encrypt_lfen2(b"data", KEY, "Audio/a.mp3").unwrap();
    assert!(matches!(
        decrypt_resource_bytes(sealed, KEY, "Audio/b.mp3"),
        Err(ResourceCryptoError::Crypto(_))
    ));
}

#[test]
fn tamper_and_bad_magic_fail_closed() {
    // 篡改必拒、非密文不降级明文
    let mut sealed = encrypt_lfen2(b"secret", KEY, "Video/v.mp4").unwrap();
    let last = sealed.len() - 1;
    sealed[last] ^= 0xFF;
    assert!(matches!(
        decrypt_resource_bytes(sealed, KEY, "Video/v.mp4"),
        Err(ResourceCryptoError::Crypto(_))
    ));
    assert!(matches!(
        decrypt_resource_bytes(b"plain-bytes".to_vec(), KEY, "x"),
        Err(ResourceCryptoError::BadFormat(_))
    ));
}

#[test]
fn path_traversal_rejected() {
    // `..`/空段/绝对路径拒绝
    for bad in ["../x", "a//b", "/abs", "a/./b", "a\\b", ""] {
        assert!(matches!(
            crate::paths::validate_resource_path(bad),
            Err(PathRuleError::Empty | PathRuleError::Absolute | PathRuleError::RelativeSegment)
        ));
    }
}

#[test]
fn encrypt_directory_filters_and_preserves_structure() {
    // 加密目录：扩展名过滤 + 结构保留 + .enc 命名 + 已加密幂等复制
    let base = std::env::temp_dir().join(format!(
        "lf3-res-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let input = base.join("in");
    let output = base.join("out");
    fs::create_dir_all(input.join("Audio")).unwrap();
    fs::create_dir_all(input.join("Stories")).unwrap();
    fs::write(input.join("Audio/x.mp3"), b"mp3-data").unwrap();
    fs::write(input.join("Stories/start.json"), b"{}").unwrap();
    fs::write(input.join("README.md"), b"skip-me").unwrap();

    let written = encrypt_directory(&input, &output, KEY, &["mp3", "json"], &[]).unwrap();
    assert_eq!(written.len(), 2);
    assert!(output.join("Audio/x.mp3.enc").is_file());
    assert!(output.join("Stories/start.json.enc").is_file());
    assert!(!output.join("README.md.enc").exists());

    // 解密回读（打包路径 AAD = 相对路径）
    let sealed = fs::read(output.join("Audio/x.mp3.enc")).unwrap();
    assert_eq!(
        decrypt_resource_bytes(sealed, KEY, "Audio/x.mp3").unwrap(),
        b"mp3-data".to_vec()
    );
    // 幂等：已加密输入原样复制
    let again = encrypt_directory(&input, &output, KEY, &["mp3", "json"], &[]).unwrap();
    assert_eq!(again.len(), 2);
    fs::remove_dir_all(&base).ok();
}

#[test]
fn pack_project_round_trip_and_layout() {
    // 拟态打包——清单明文转换 + 内容全加密 + 排除集 + seed + round-trip 自检
    let base = temp_base("lf3-pack");
    let input = base.join("in");
    let output = base.join("out");
    fs::create_dir_all(input.join("Stories")).unwrap();
    fs::create_dir_all(input.join("Audio")).unwrap();
    fs::create_dir_all(input.join("Lang/en")).unwrap();
    fs::create_dir_all(input.join("Saves")).unwrap();
    fs::write(
        input.join("project.json"),
        r#"{"formatVersion":1,"id":"demo","entry":"a"}"#,
    )
    .unwrap();
    fs::write(input.join("Stories/a.json"), b"{\"commands\":[]}").unwrap();
    fs::write(input.join("Audio/x.mp3"), b"mp3-bytes").unwrap();
    fs::write(input.join("Lang/en/main.json"), "{\"你好\":\"Hello\"}").unwrap();
    fs::write(input.join("Saves/slot_1.lfs3"), b"runtime-save").unwrap();
    fs::write(input.join(".hidden"), b"secret").unwrap();
    fs::write(input.join("README.md"), b"not-content").unwrap();

    let report = pack_project(&input, &output).unwrap();
    assert_eq!(report.files, 3); // Stories/a.json + Audio/x.mp3 + Lang/en/main.json

    // 清单明文可读且形态已翻转（运行时形态判定依赖清单先可读）
    let manifest: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output.join("project.json")).unwrap())
            .unwrap();
    assert_eq!(
        manifest["resourceEncryption"],
        serde_json::Value::Bool(true)
    );
    assert_eq!(manifest["id"], "demo");

    // seed 随包（32B）；密文齐全；明文内容零泄漏（用户命题：包内只有密文形态的内容）
    assert_eq!(fs::read(output.join("__key__.seed")).unwrap().len(), 32);
    assert!(output.join("Stories/a.json.enc").is_file());
    assert!(output.join("Audio/x.mp3.enc").is_file());
    assert!(output.join("Lang/en/main.json.enc").is_file());
    assert!(!output.join("Stories/a.json").exists());
    assert!(!output.join("Audio/x.mp3").exists());
    assert!(!output.join("Saves/slot_1.lfs3").exists());
    assert!(!output.join(".hidden").exists());
    assert!(!output.join("README.md.enc").exists());

    // 解密回读 == 源明文（AAD 绑逻辑路径）
    let seed = fs::read(output.join("__key__.seed")).unwrap();
    let sealed = fs::read(output.join("Stories/a.json.enc")).unwrap();
    assert_eq!(
        decrypt_resource_bytes(sealed, &seed, "Stories/a.json").unwrap(),
        b"{\"commands\":[]}".to_vec()
    );
    fs::remove_dir_all(&base).ok();
}

#[test]
fn pack_report_classifies_dispositions() {
    // 报告四分类各有代表（加密 / 明文有因 / 排除 / 未入包）+ strict 例外判定
    let base = temp_base("lf3-pack-report");
    let input = base.join("in");
    let output = base.join("out");
    fs::create_dir_all(input.join("Stories")).unwrap();
    fs::create_dir_all(input.join("Saves")).unwrap();
    fs::create_dir_all(input.join("docs")).unwrap();
    fs::write(
        input.join("project.json"),
        r#"{"formatVersion":1,"id":"demo"}"#,
    )
    .unwrap();
    fs::write(input.join("Stories/a.json"), b"{}").unwrap();
    fs::write(input.join("Saves/slot_1.lfs3"), b"save").unwrap();
    fs::write(input.join(".hidden"), b"h").unwrap();
    fs::write(input.join("docs/notes.txt"), b"n").unwrap();

    let report = pack_project(&input, &output).unwrap();
    assert_eq!(report.encrypted, vec!["Stories/a.json".to_string()]);
    assert_eq!(report.files, 1);
    // 明文（有因）恒两条：清单（工程元数据）+ seed（密钥引导），措辞与加密要求一致
    assert_eq!(report.plaintext.len(), 2);
    assert_eq!(report.plaintext[0].path, "project.json");
    assert_eq!(report.plaintext[1].path, DEK_SEED);
    // 排除：Saves 子树 + 点文件（read_dir 顺序不定，按集合断言）
    let excluded: Vec<&str> = report.excluded.iter().map(|e| e.path.as_str()).collect();
    assert!(excluded.contains(&"Saves/slot_1.lfs3"));
    assert!(excluded.contains(&".hidden"));
    // 未入包：白名单外 = 打包者须决断的例外
    assert_eq!(report.skipped.len(), 1);
    assert_eq!(report.skipped[0].path, "docs/notes.txt");
    assert!(report.has_exceptions());
    // 未入包文件确实没进包（不静默明文）
    assert!(!output.join("docs").exists());
    fs::remove_dir_all(&base).ok();
}

#[test]
fn pack_report_clean_project_has_no_exceptions() {
    // 边界：纯净工程（全部白名单内）→ strict 零例外
    let base = temp_base("lf3-pack-report-clean");
    let input = base.join("in");
    let output = base.join("out");
    fs::create_dir_all(input.join("Stories")).unwrap();
    fs::write(
        input.join("project.json"),
        r#"{"formatVersion":1,"id":"demo"}"#,
    )
    .unwrap();
    fs::write(input.join("Stories/a.json"), b"{}").unwrap();
    let report = pack_project(&input, &output).unwrap();
    assert_eq!(report.files, 1);
    assert!(report.skipped.is_empty());
    assert!(!report.has_exceptions());
    fs::remove_dir_all(&base).ok();
}

#[test]
fn pack_project_with_dist_collects_frontend() {
    // dist 收录（dist/ 逻辑路径前缀）+ html 落报告 skipped + 清单 frontend 段
    // + dist 逻辑路径走运行时解密面（与故事资源同管线，形态透明）
    let base = temp_base("lf3-pack-dist");
    let input = base.join("in");
    let output = base.join("out");
    let dist = base.join("distenc"); // 模拟 prepare-dist 移出位 dist-enc/
    fs::create_dir_all(input.join("Stories")).unwrap();
    fs::create_dir_all(dist.join("assets")).unwrap();
    fs::write(
        input.join("project.json"),
        r#"{"formatVersion":1,"id":"demo","entry":"a"}"#,
    )
    .unwrap();
    fs::write(input.join("Stories/a.json"), b"{}").unwrap();
    // vite 产物名字符集（[A-Za-z0-9_.-]）：encodeURIComponent 与 Rust 编码输出一致
    fs::write(dist.join("assets/index-Cx1Ab.js"), b"console.log(1)").unwrap();
    fs::write(dist.join("assets/index-Cx1Ab.css"), b"body{}").unwrap();
    // html = 明文例外（壳嵌入），不进 dist 白名单 → skipped
    fs::write(dist.join("splashscreen.html"), b"<html></html>").unwrap();

    let report = pack_project_with_dist(&input, &output, Some(&dist)).unwrap();
    let has = |p: &str| report.encrypted.iter().any(|s| s == p);
    assert!(has("Stories/a.json"));
    assert!(has("dist/assets/index-Cx1Ab.js"));
    assert!(has("dist/assets/index-Cx1Ab.css"));
    assert_eq!(report.files, 3);
    let skipped: Vec<&str> = report.skipped.iter().map(|e| e.path.as_str()).collect();
    assert!(skipped.contains(&"dist/splashscreen.html"));
    assert!(report.has_exceptions());
    // 输出清单补 frontend 映射段（包自描述：加密前端面有哪些资产）
    let manifest: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output.join("project.json")).unwrap())
            .unwrap();
    assert_eq!(manifest["frontend"]["assets"].as_array().unwrap().len(), 2);

    // dist 逻辑路径经同一解密契约可读（AAD 绑 dist/ 前缀逻辑路径）
    let seed = fs::read(output.join("__key__.seed")).unwrap();
    let sealed = fs::read(output.join("dist/assets/index-Cx1Ab.js.enc")).unwrap();
    // dist 资产强制 v2 存储（协议 v2 路径供给的前置形态——小文件也是 v2 单块特例）
    assert!(sealed.starts_with(MAGIC_LFEN2) && sealed[5] == FORMAT_VERSION_V2);
    assert_eq!(
        decrypt_resource_bytes(sealed, &seed, "dist/assets/index-Cx1Ab.js").unwrap(),
        b"console.log(1)".to_vec()
    );
    fs::remove_dir_all(&base).ok();
}

#[test]
fn pack_project_rejects_nonempty_output() {
    // 故意错误：输出已存在且非空 = 拒绝（不覆盖创作者成果）
    let base = temp_base("lf3-pack-nonempty");
    let input = base.join("in");
    let output = base.join("out");
    fs::create_dir_all(&input).unwrap();
    fs::create_dir_all(&output).unwrap();
    fs::write(
        input.join("project.json"),
        r#"{"formatVersion":1,"id":"demo"}"#,
    )
    .unwrap();
    fs::write(output.join("stale.txt"), b"keep-me").unwrap();
    assert!(pack_project(&input, &output).is_err());
    assert_eq!(fs::read(output.join("stale.txt")).unwrap(), b"keep-me");
    fs::remove_dir_all(&base).ok();
}

#[test]
fn pack_project_bad_or_missing_manifest_fails_closed() {
    // 故意错误：无清单 / 坏 JSON 清单——打包期即拦，输出零副作用（连目录都不建）
    let base = temp_base("lf3-pack-badmanifest");
    let input = base.join("in");
    let output = base.join("out");
    fs::create_dir_all(input.join("Stories")).unwrap();
    fs::write(input.join("Stories/a.json"), b"{}").unwrap();
    assert!(pack_project(&input, &output).is_err()); // 无清单
    assert!(!output.exists());
    fs::write(input.join("project.json"), "{not-json").unwrap();
    assert!(pack_project(&input, &output).is_err()); // 坏清单
    assert!(!output.exists());
    fs::remove_dir_all(&base).ok();
}

#[test]
fn pack_rejects_output_equal_or_nested_to_input() {
    // 路径关系防护（同路径 / 子目录 / 父目录全拒）——
    // 若无防护，`--force` 下output == input 时 remove_dir_all 会删光源工程
    let base = temp_base("lfen-guard");
    let input = base.join("Res");
    fs::create_dir_all(input.join("Stories")).unwrap();
    fs::write(
        input.join("project.json"),
        r#"{"formatVersion":1,"id":"g","entry":"start"}"#,
    )
    .unwrap();
    fs::write(
        input.join("Stories/a.json"),
        r#"{"formatVersion":1,"id":"a","kind":"flow","commands":[]}"#,
    )
    .unwrap();

    // 相同路径
    assert!(ensure_pack_paths_distinct(&input, &input).is_err());
    assert!(pack_project(&input, &input).is_err());
    // output 不存在但位于 input 内（子目录打包 = 源污染）
    assert!(ensure_pack_paths_distinct(&input, &input.join("packed")).is_err());
    assert!(pack_project(&input, &input.join("packed")).is_err());
    // input 位于 output 内（父目录清空 = 连带毁源）
    assert!(ensure_pack_paths_distinct(&input, &base).is_err());
    // 兄弟目录（不存在）⇒ 通过；打包正例不回归
    assert!(ensure_pack_paths_distinct(&input, &base.join("out")).is_ok());
    let report = pack_project(&input, &base.join("out")).unwrap();
    assert_eq!(report.files, 1);
    assert!(base.join("out").join("Stories/a.json.enc").is_file());
    fs::remove_dir_all(&base).ok();
}

#[test]
fn encrypt_directory_rejects_same_path() {
    // in-place 加密（output = input）= 明文/密文同目录共存的根源形态，防护拒绝
    let base = temp_base("lfen-guard-enc");
    let input = base.join("Res");
    fs::create_dir_all(&input).unwrap();
    fs::write(input.join("a.mp3"), b"audio").unwrap();
    assert!(encrypt_directory(&input, &input, KEY, &["mp3"], &[]).is_err());
    assert!(!input.join("a.mp3.enc").exists()); // 零副作用
    fs::remove_dir_all(&base).ok();
}

fn temp_base(tag: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "{tag}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

#[test]
fn parse_range_specifications() {
    // RFC 7233 单区间解析：显式区间/开放尾/后缀/越界 416/畸形宽容回全量
    assert_eq!(parse_range(None, 100), RangeSpec::Full);
    assert_eq!(
        parse_range(Some("bytes=0-"), 100),
        RangeSpec::Partial(0, 99)
    );
    assert_eq!(
        parse_range(Some("bytes=10-19"), 100),
        RangeSpec::Partial(10, 19)
    );
    // end 超界钳到文件尾
    assert_eq!(
        parse_range(Some("bytes=90-999"), 100),
        RangeSpec::Partial(90, 99)
    );
    // suffix：最后 n 字节
    assert_eq!(
        parse_range(Some("bytes=-10"), 100),
        RangeSpec::Partial(90, 99)
    );
    // start 越界 = 416
    assert_eq!(
        parse_range(Some("bytes=100-"), 100),
        RangeSpec::Unsatisfiable
    );
    // 畸形 = 宽容回全量
    assert_eq!(parse_range(Some("garbage"), 100), RangeSpec::Full);
    assert_eq!(parse_range(Some("bytes=xx-yy"), 100), RangeSpec::Full);
}

#[test]
fn stream_range_response_codes_and_headers() {
    // 200/206/416/404 全码 + Content-Range 精确字节
    let base = temp_base("lf3-stream");
    fs::create_dir_all(&base).unwrap();
    let file = base.join("abc.mp4");
    fs::write(&file, b"0123456789").unwrap(); // 10 字节

    // 206：显式区间字节精确
    let resp = stream_range_response(&file, Some("bytes=2-5"));
    assert_eq!(resp.status(), tauri::http::StatusCode::PARTIAL_CONTENT);
    assert_eq!(resp.body().as_slice(), b"2345");
    assert_eq!(
        resp.headers()["content-range"],
        "bytes 2-5/10".as_bytes() as &[u8]
    );
    assert_eq!(resp.headers()["content-type"], "video/mp4");
    assert_eq!(resp.headers()["accept-ranges"], "bytes");

    // 200：无 Range 回全量 + Accept-Ranges
    let full = stream_range_response(&file, None);
    assert_eq!(full.status(), tauri::http::StatusCode::OK);
    assert_eq!(full.body().as_slice(), b"0123456789");
    assert_eq!(full.headers()["accept-ranges"], "bytes");

    // 416：start 越界
    let bad = stream_range_response(&file, Some("bytes=100-"));
    assert_eq!(bad.status(), tauri::http::StatusCode::RANGE_NOT_SATISFIABLE);
    assert_eq!(
        bad.headers()["content-range"],
        "bytes */10".as_bytes() as &[u8]
    );

    // 404：文件不存在
    let missing = stream_range_response(&base.join("ghost.mp4"), None);
    assert_eq!(missing.status(), tauri::http::StatusCode::NOT_FOUND);
    fs::remove_dir_all(&base).ok();
}

#[test]
fn lfstream_token_and_v2_path_trust_boundaries() {
    // v1 token：{hex64.ext} 形态判定（防穿越/防探测）
    let token = "a".repeat(64);
    assert!(is_v1_token(&format!("{token}.mp4")));
    assert!(!is_v1_token("short.mp4"));
    assert!(!is_v1_token("x/y.mp4"));
    assert!(!is_v1_token("../project.json"));
    assert!(!is_v1_token(&format!("{token}.ex/tra")));
    // v2 逻辑路径：validate_resource_path 信任边界（穿越/绝对路径拒绝）
    assert!(crate::paths::validate_resource_path("Video/m2.mp4").is_ok());
    assert!(crate::paths::validate_resource_path("../project.json").is_err());
    assert!(crate::paths::validate_resource_path("").is_err());
}

/// 命中面 = Android ∧ 音视频扩展名（大小写不敏感）；
/// 桌面恒不命中（同资源在桌面继续走 lfstream，行为零变化，也不起端口）
#[test]
fn media_loopback_routing_is_pure_and_narrow() {
    for media in [
        "Video/m2.mp4",
        "Video/x.MP4",
        "Audio/bgm.mp3",
        "SFX/x.ogg",
        "Video/a.webm",
        "Audio/x.m4a",
    ] {
        assert!(is_media_ext(media), "{media} 应判为媒体");
        assert!(loopback_eligible(true, media));
        assert!(!loopback_eligible(false, media), "桌面不得命中（不起端口）");
    }
    for other in [
        "Images/bg.png",
        "Fonts/x.ttf",
        "Stories/start.json",
        "dist/assets/index-a1b2.js",
        "Video/noext",
        "Video/trailing.",
    ] {
        assert!(!is_media_ext(other), "{other} 不应判为媒体");
        assert!(!loopback_eligible(true, other));
    }
}

#[test]
fn stream_decrypt_to_cache_round_trip_and_idempotent() {
    // 流式解密：LFEN2 封装 → in-place 解密落盘 → 内容 == 源明文；二次调用幂等复用
    let base = temp_base("lf3-stream-decrypt");
    let root = base.join("res");
    let app_data = base.join("data");
    fs::create_dir_all(root.join("Video")).unwrap();
    let plain = b"4k-video-bytes-500mb-class".to_vec();
    fs::write(
        root.join("Video/m2.mp4.enc"),
        encrypt_lfen2(&plain, KEY, "Video/m2.mp4").unwrap(),
    )
    .unwrap();

    let name = stream_decrypt_to_cache(&StdFs, &root, &app_data, KEY, "Video/m2.mp4").unwrap();
    assert!(name.ends_with(".mp4"));
    let cached = tmp_stream_dir(&app_data).join(&name);
    assert_eq!(fs::read(&cached).unwrap(), plain);

    // 幂等：第二次调用直接命中缓存（改坏源包不影响已缓存——进程内 DEK 不变）
    let name2 = stream_decrypt_to_cache(&StdFs, &root, &app_data, KEY, "Video/m2.mp4").unwrap();
    assert_eq!(name, name2);

    // 启动清理后可重建
    cleanup_tmp_stream(&app_data);
    assert!(!cached.exists());
    let name3 = stream_decrypt_to_cache(&StdFs, &root, &app_data, KEY, "Video/m2.mp4").unwrap();
    assert_eq!(
        fs::read(tmp_stream_dir(&app_data).join(&name3)).unwrap(),
        plain
    );
    fs::remove_dir_all(&base).ok();
}

#[test]
fn lfen2_v2_round_trip_and_tail_chunk() {
    // 尾块短块合法；块对齐/跨块/后缀 Range 全形态回读 == 源明文；全量解密等价
    let base = temp_base("lf3-v2-rt");
    fs::create_dir_all(&base).unwrap();
    let src = base.join("m.bin");
    let out = base.join("m.mp4.enc");
    let mut plain = Vec::new();
    for i in 0..(3 * 1024 + 777u32) {
        plain.extend_from_slice(&i.to_le_bytes());
    } // 12244 + 777*4 = 非对齐尾块
    fs::write(&src, &plain).unwrap();
    encrypt_lfen2_v2_file(&src, &out, KEY, "Video/m.mp4", 10).unwrap(); // 1KiB 块
    let sealed = fs::read(&out).unwrap();
    assert!(sealed.starts_with(MAGIC_LFEN2) && sealed[5] == FORMAT_VERSION_V2);

    // 全量解密（与逐块 Range 路径同一份密文：v2 走 decrypt_resource_bytes 透明分流）
    assert_eq!(
        decrypt_resource_bytes(sealed, KEY, "Video/m.mp4").unwrap(),
        plain
    );

    // 块对齐区间 / 跨块区间 / 后缀区间
    assert_eq!(
        decrypt_v2_block_range(&StdFs, &out, KEY, "Video/m.mp4", 1024, 2047).unwrap(),
        plain[1024..2048]
    );
    assert_eq!(
        decrypt_v2_block_range(&StdFs, &out, KEY, "Video/m.mp4", 1000, 3000).unwrap(),
        plain[1000..3001]
    );
    let total = plain.len() as u64;
    assert_eq!(
        decrypt_v2_block_range(&StdFs, &out, KEY, "Video/m.mp4", total - 5, total - 1).unwrap(),
        plain[plain.len() - 5..]
    );
    fs::remove_dir_all(&base).ok();
}

#[test]
fn lfen2_v2_guards() {
    // chunk_log2 超限 / 块数超 u32::MAX（nonce 空间）拒绝——纯算术不占内存
    assert!(v2_validate(100, 27).is_err());
    // chunk_log2 = 0 → 块长 1B：total = 2^32 字节 = 2^32 块，超 nonce 空间必拒
    assert!(v2_validate(u64::from(u32::MAX) + 1, 0).is_err());
    assert!(v2_validate(100, 22).is_ok());
}

#[test]
fn lfen2_v2_block_swap_rejected() {
    // 块 AAD 绑 index——交换块 0/块 1 密文段后解密必拒（防跨块重排）
    let base = temp_base("lf3-v2-swap");
    fs::create_dir_all(&base).unwrap();
    let src = base.join("m.bin");
    let out = base.join("m.mp4.enc");
    let mut plain = (0u32..2048)
        .flat_map(|i| i.to_le_bytes())
        .collect::<Vec<u8>>();
    plain.extend_from_slice(b"tail");
    fs::write(&src, &plain).unwrap();
    encrypt_lfen2_v2_file(&src, &out, KEY, "Video/m.mp4", 10).unwrap(); // 1KiB 块
    let mut sealed = fs::read(&out).unwrap();
    let header = V2_HEADER_LEN;
    let block_len = 1024 + 16;
    let (a, b) = (header, header + block_len);
    let mut block0 = sealed[a..b].to_vec();
    let mut block1 = sealed[b..b + block_len].to_vec();
    std::mem::swap(&mut block0, &mut block1);
    sealed[a..b].copy_from_slice(&block0);
    sealed[b..b + block_len].copy_from_slice(&block1);
    assert!(decrypt_resource_bytes(sealed, KEY, "Video/m.mp4").is_err());
    fs::remove_dir_all(&base).ok();
}

#[test]
fn lfen2_v2_truncation_rejected() {
    // 截断密文（total_len 与实际不符）→ 解密必拒
    let base = temp_base("lf3-v2-trunc");
    fs::create_dir_all(&base).unwrap();
    let src = base.join("m.bin");
    let out = base.join("m.mp4.enc");
    let plain = vec![7u8; 3000];
    fs::write(&src, &plain).unwrap();
    encrypt_lfen2_v2_file(&src, &out, KEY, "Video/m.mp4", 10).unwrap();
    let mut sealed = fs::read(&out).unwrap();
    sealed.truncate(sealed.len() - 40); // 截掉部分密文
    assert!(decrypt_resource_bytes(sealed, KEY, "Video/m.mp4").is_err());
    fs::remove_dir_all(&base).ok();
}

#[test]
fn lfen2_v2_protocol_range_serves_plain_bytes() {
    // 协议 v2 路径：Range → 206 字节 == 源明文对应段（与 AppHandle 解耦的可测核心）
    let base = temp_base("lf3-v2-proto");
    let root = base.join("res");
    fs::create_dir_all(&root).unwrap();
    let mut plain = (0u32..1024)
        .flat_map(|i| i.to_le_bytes())
        .collect::<Vec<u8>>();
    plain.extend_from_slice(b"4K-TAIL"); // total = 4103，chunk = 1KiB
    let src = root.join("src.bin");
    fs::write(&src, &plain).unwrap();
    encrypt_lfen2_v2_file(
        &src,
        &root.join("Video/m2.mp4.enc"),
        KEY,
        "Video/m2.mp4",
        10,
    )
    .unwrap();

    let req_for = |range: Option<String>| {
        let mut b =
            tauri::http::Request::builder().uri("http://lfstream.localhost/v2/Video%2Fm2.mp4");
        if let Some(r) = range {
            b = b.header("range", r);
        }
        b.body(Vec::new()).unwrap()
    };

    // 206：跨块区间字节精确
    let resp = handle_v2_range_with(
        &StdFs,
        req_for(Some("bytes=100-2059".into())),
        "Video%2Fm2.mp4",
        &root,
        KEY,
    );
    assert_eq!(resp.status(), tauri::http::StatusCode::PARTIAL_CONTENT);
    assert_eq!(resp.body().as_slice(), &plain[100..=2059]);
    assert_eq!(resp.headers()["content-type"], "video/mp4");
    assert_eq!(
        resp.headers()["content-range"],
        "bytes 100-2059/4103".as_bytes() as &[u8]
    );

    // 越界 Range → 416
    let bad = handle_v2_range_with(
        &StdFs,
        req_for(Some("bytes=999999-".into())),
        "Video%2Fm2.mp4",
        &root,
        KEY,
    );
    assert_eq!(bad.status(), tauri::http::StatusCode::RANGE_NOT_SATISFIABLE);

    // 无 Range → 200 全量
    let full = handle_v2_range_with(&StdFs, req_for(None), "Video%2Fm2.mp4", &root, KEY);
    assert_eq!(full.status(), tauri::http::StatusCode::OK);
    assert_eq!(full.body().as_slice(), plain.as_slice());
    fs::remove_dir_all(&base).ok();
}

#[test]
fn range_query_channel_parsing() {
    // URL-query 通道取值：percent 解码 + 只认第一个 range 键 + 其余键忽略
    assert_eq!(range_query_value(None), None);
    assert_eq!(range_query_value(Some("")), None);
    assert_eq!(
        range_query_value(Some("range=bytes%3D0-1023")),
        Some("bytes=0-1023".to_string())
    );
    assert_eq!(
        range_query_value(Some("a=1&range=bytes%3D10-19&b=2")),
        Some("bytes=10-19".to_string())
    );
    assert_eq!(range_query_value(Some("start=0&end=9")), None);
}

#[test]
fn android_range_query_channel_serves_exact_200() {
    // URL-query 区间通道（请求不带 `Range` 头）→
    // 200 精确切片 + `X-Total-Size`，且**不带** `Content-Range`/`Accept-Ranges`
    // （请求本无 Range 头，若仍以 range 语义回响应会再次落进 WebView 的二次偏移）。
    let base = temp_base("lf3-range-query");
    let root = base.join("res");
    fs::create_dir_all(&root).unwrap();
    let mut plain = (0u32..1024)
        .flat_map(|i| i.to_le_bytes())
        .collect::<Vec<u8>>();
    plain.extend_from_slice(b"4K-TAIL"); // total = 4103，chunk = 1KiB
    let src = root.join("src.bin");
    fs::write(&src, &plain).unwrap();
    encrypt_lfen2_v2_file(
        &src,
        &root.join("Video/m2.mp4.enc"),
        KEY,
        "Video/m2.mp4",
        10,
    )
    .unwrap();

    let call = |uri: &str, range: Option<&str>| {
        let mut b = tauri::http::Request::builder().uri(uri);
        if let Some(r) = range {
            b = b.header("range", r);
        }
        let req = b.body(Vec::new()).unwrap();
        handle_v2_range_with(&StdFs, req, "Video%2Fm2.mp4", &root, KEY)
    };

    // 200 + 字节精确 + 头集合收敛（无 Content-Range/Accept-Ranges）
    let resp = call(
        "http://lfstream.localhost/v2/Video%2Fm2.mp4?range=bytes%3D100-2059",
        None,
    );
    assert_eq!(resp.status(), tauri::http::StatusCode::OK);
    assert_eq!(resp.body().as_slice(), &plain[100..=2059]);
    assert_eq!(resp.headers()["x-total-size"], "4103".as_bytes() as &[u8]);
    assert_eq!(resp.headers()["content-type"], "video/mp4");
    assert!(resp.headers().get("content-range").is_none());
    assert!(resp.headers().get("accept-ranges").is_none());

    // query 优先于头：并存的冲突 `Range` 头不参与（仍是 query 的窗口）
    let resp = call(
        "http://lfstream.localhost/v2/Video%2Fm2.mp4?range=bytes%3D100-2059",
        Some("bytes=0-9"),
    );
    assert_eq!(resp.body().as_slice(), &plain[100..=2059]);

    // 后缀形态同源复用
    let resp = call(
        "http://lfstream.localhost/v2/Video%2Fm2.mp4?range=bytes%3D-8",
        None,
    );
    assert_eq!(resp.status(), tauri::http::StatusCode::OK);
    assert_eq!(resp.body().as_slice(), &plain[4095..4103]);

    // 畸形/越界 = 416（fail-closed：显式通道静默退化会放大成一次全文件解密）
    for bad in [
        "bytes%3Dxx-yy",
        "bytes%3D999999-",
        "garbage",
        "bytes%3D50-10",
    ] {
        let resp = call(
            &format!("http://lfstream.localhost/v2/Video%2Fm2.mp4?range={bad}"),
            None,
        );
        assert_eq!(
            resp.status(),
            tauri::http::StatusCode::RANGE_NOT_SATISFIABLE,
            "query 值 {bad} 应 fail-closed"
        );
        assert!(resp.body().is_empty());
    }

    // 头通道语义未受影响（同一资源、同一函数）：206 + Content-Range 字节精确
    let resp = call(
        "http://lfstream.localhost/v2/Video%2Fm2.mp4",
        Some("bytes=100-2059"),
    );
    assert_eq!(resp.status(), tauri::http::StatusCode::PARTIAL_CONTENT);
    assert_eq!(resp.body().as_slice(), &plain[100..=2059]);
    assert_eq!(
        resp.headers()["content-range"],
        "bytes 100-2059/4103".as_bytes() as &[u8]
    );
    fs::remove_dir_all(&base).ok();
}

#[test]
fn v2_block_lru_cache_bounds_and_isolation() {
    // 有界 LRU（容量/淘汰序/刷新保真）+ 路径参与键不串味 + 计数
    let mut cache = V2BlockCache::new(2_400); // 恰容 2 块（1000B 块）
    let fp = v2_key_fp(KEY);
    let k = |name: &str, index: u64| V2CacheKey {
        enc: PathBuf::from(format!("/{name}.enc")),
        logical: name.to_string(),
        index,
        key_fp: fp,
    };
    cache.put(k("a", 0), vec![7u8; 1000]);
    cache.put(k("a", 1), vec![8u8; 1000]);
    assert!(cache.get(&k("a", 0)).is_some()); // 刷新 a0 → a1 变最旧
    cache.put(k("a", 2), vec![9u8; 1000]); // 超容 → 淘汰 a1
    assert!(cache.get(&k("a", 1)).is_none()); // 被淘 = miss
    assert_eq!(cache.get(&k("a", 2)).unwrap(), vec![9u8; 1000]); // 新入未被误淘
    assert_eq!(cache.get(&k("a", 0)).unwrap(), vec![7u8; 1000]); // LRU 刷新保真
    cache.put(k("b", 0), vec![1u8; 1000]); // 淘汰 a2（此时最旧）
    assert_eq!(cache.get(&k("a", 0)).unwrap()[0], 7); // 同块号不同路径不串味
    assert_eq!(cache.get(&k("b", 0)).unwrap()[0], 1);
    assert_eq!((cache.hits, cache.misses), (5, 1));
    assert_eq!(cache.bytes, 2000);
    assert_eq!(cache.entries.len(), 2);
    cache.put(k("c", 0), vec![0u8; 5_000]); // 单块超上限 → 跳过缓存
    assert!(cache.get(&k("c", 0)).is_none());
    let mut disabled = V2BlockCache::new(0); // cap=0 = 禁用
    disabled.put(k("d", 0), vec![1u8; 10]);
    assert!(disabled.get(&k("d", 0)).is_none());
}

#[test]
fn v2_block_lru_cache_wired_through_block_range() {
    // 全局缓存经 decrypt_v2_block_range 生效：同块二次 Range 命中（计数上升）且逐字节一致；
    // 同块号不同资源（路径参与键）互不串味
    let base = temp_base("lf3-v2-lru");
    fs::create_dir_all(&base).unwrap();
    let mk = |name: &str, fill: u8| -> (PathBuf, Vec<u8>) {
        let src = base.join(format!("{name}.bin"));
        let plain = vec![fill; 3 * 1024]; // 3 块（1KiB 块）
        fs::write(&src, &plain).unwrap();
        let out = base.join(format!("{name}.mp4.enc"));
        encrypt_lfen2_v2_file(&src, &out, KEY, &format!("Video/{name}.mp4"), 10).unwrap();
        (out, plain)
    };
    let (enc_a, plain_a) = mk("lru-a", 0xAA);
    let (enc_b, plain_b) = mk("lru-b", 0xBB);
    let (h0, _) = v2_block_cache_stats();
    let r1 = decrypt_v2_block_range(&StdFs, &enc_a, KEY, "Video/lru-a.mp4", 0, 1023).unwrap();
    let r2 = decrypt_v2_block_range(&StdFs, &enc_a, KEY, "Video/lru-a.mp4", 0, 1023).unwrap();
    assert_eq!(r1, r2);
    assert_eq!(r1, &plain_a[..1024]);
    let (h1, _) = v2_block_cache_stats();
    assert!(h1 > h0, "缓存命中计数应上升：{h0} → {h1}");
    let rb = decrypt_v2_block_range(&StdFs, &enc_b, KEY, "Video/lru-b.mp4", 0, 1023).unwrap();
    assert_eq!(rb, &plain_b[..1024]);
    assert_ne!(rb, r1);
    // 跨块 Range（块 1 miss 后回填）→ 复取命中
    let s1 =
        decrypt_v2_block_range(&StdFs, &enc_a, KEY, "Video/lru-a.mp4", 1024, 2047).unwrap();
    let s2 =
        decrypt_v2_block_range(&StdFs, &enc_a, KEY, "Video/lru-a.mp4", 1024, 2047).unwrap();
    assert_eq!(s1, s2);
    assert_eq!(s1, &plain_a[1024..2048]);
    let (h2, m2) = v2_block_cache_stats();
    assert!(h2 > h1);
    assert!(m2 > 0);
    fs::remove_dir_all(&base).ok();
}

#[test]
fn seed_import_writes_envelope() {
    // seed 存在 → 导入并写 KEK 信封；信封优先
    let base = std::env::temp_dir().join(format!(
        "lf3-dek-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&base).unwrap();
    let resource_root = base.join("res");
    fs::create_dir_all(&resource_root).unwrap();
    // 生成 seed（不打 keyring：直接写 32B）
    let seed = generate_resource_seed().unwrap();
    fs::write(resource_root.join(DEK_SEED), &seed).unwrap();
    // resource_dek 走 keyring（本机 KEK）——信封写入后 seed 仍在，但信封优先路径生效
    let dek = resource_dek(&base, &resource_root, &StdFs).unwrap();
    assert_eq!(dek, seed);
    assert!(base.join(DEK_ENVELOPE).is_file());
    // 信封已存在 → seed 删除后仍可取（运行时产出形态回退信封）
    fs::remove_file(resource_root.join(DEK_SEED)).unwrap();
    let dek2 = resource_dek(&base, &resource_root, &StdFs).unwrap();
    assert_eq!(dek2, seed);
    // 包更新语义：seed 换新 → DEK 跟随新 seed（信封幂等重导入，覆盖旧 DEK）
    fs::remove_file(base.join(DEK_ENVELOPE)).unwrap();
    let new_seed = generate_resource_seed().unwrap();
    fs::write(resource_root.join(DEK_SEED), &new_seed).unwrap();
    let dek3 = resource_dek(&base, &resource_root, &StdFs).unwrap();
    assert_eq!(dek3, new_seed);
    // 无信封无 seed → MissingKey
    fs::remove_file(base.join(DEK_ENVELOPE)).unwrap();
    fs::remove_file(resource_root.join(DEK_SEED)).unwrap();
    assert!(matches!(
        resource_dek(&base, &resource_root, &StdFs),
        Err(ResourceCryptoError::MissingKey)
    ));
    fs::remove_dir_all(&base).ok();
}
