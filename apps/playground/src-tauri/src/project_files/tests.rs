//! 工程文件供给的行为测试。

use crate::project_files::languages::{scan_i18n_languages};
use crate::project_files::overlay::{load_overlay_files};
use crate::project_files::supply::{read_project_files, read_project_files_with_key};
use crate::project_files::watch::{run_event_debouncer};
use std::path::Path;

use super::*;
use crate::resource_fs::StdFs;
use std::fs;
use std::path::PathBuf;

fn test_root(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "lf3-project-{tag}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(dir.join("Stories")).unwrap();
    dir
}

fn write(root: &Path, rel: &str, content: &str) {
    let path = root.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

#[test]
fn supplies_manifest_and_raw_story_texts() {
    // 故事以原始文本供给，解析归引擎组装器
    let root = test_root("happy");
    write(
        &root,
        "project.json",
        r#"{"formatVersion":1,"id":"demo","entry":"start"}"#,
    );
    write(
        &root,
        "Stories/start.json",
        r#"{"formatVersion":1,"id":"start"}"#,
    );
    write(
        &root,
        "Stories/chapter1/tail.story",
        "label tail:\n  say \"text\"\n",
    );
    let files = read_project_files(&StdFs, &root).unwrap();
    assert_eq!(files.manifest["entry"], "start");
    assert_eq!(files.stories.len(), 2);
    assert_eq!(
        files.stories["Stories/chapter1/tail.story"],
        "label tail:\n  say \"text\"\n"
    );
}

#[test]
fn logical_paths_use_forward_separators_and_relative_to_root() {
    // 逻辑路径相对资源根、`/` 分隔（与 fetch 供给一致）
    let root = test_root("paths");
    write(&root, "project.json", "{}");
    write(&root, "Stories/a/b/c.story", "x");
    let files = read_project_files(&StdFs, &root).unwrap();
    assert!(files.stories.contains_key("Stories/a/b/c.story"));
}

#[test]
fn missing_manifest_fails_closed() {
    // 清单缺失必须报错，不静默降级为空工程
    let root = test_root("no-manifest");
    write(&root, "Stories/start.json", "{}");
    assert!(matches!(
        read_project_files(&StdFs, &root),
        Err(ProjectFilesError::MissingManifest)
    ));
}

#[test]
fn malformed_manifest_rejected() {
    let root = test_root("bad-manifest");
    write(&root, "project.json", "{ not json");
    assert!(matches!(
        read_project_files(&StdFs, &root),
        Err(ProjectFilesError::BadManifest(_))
    ));
}

#[test]
fn missing_stories_dir_fails_closed() {
    let root = std::env::temp_dir().join(format!(
        "lf3-project-no-stories-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&root).unwrap();
    write(&root, "project.json", "{}");
    assert!(matches!(
        read_project_files(&StdFs, &root),
        Err(ProjectFilesError::MissingStories)
    ));
}

#[test]
fn dotfiles_excluded() {
    // 系统杂项（.DS_Store 等）不入工程
    let root = test_root("dot");
    write(&root, "project.json", "{}");
    write(&root, "Stories/.DS_Store", "junk");
    write(&root, "Stories/real.story", "x");
    let files = read_project_files(&StdFs, &root).unwrap();
    assert_eq!(files.stories.len(), 1);
    assert!(files.stories.contains_key("Stories/real.story"));
}

#[test]
fn non_utf8_story_fails_closed() {
    // 非 UTF-8 文件必须报错，不静默丢弃或替换
    let root = test_root("utf8");
    write(&root, "project.json", "{}");
    let path = root.join("Stories/binary.story");
    fs::write(&path, [0xFFu8, 0xFE, 0x00, 0xD8]).unwrap();
    assert!(matches!(
        read_project_files(&StdFs, &root),
        Err(ProjectFilesError::Io(_))
    ));
}

#[test]
fn encrypted_stories_decrypt_and_strip_enc_suffix() {
    // `.enc` 故事解密供给（去后缀逻辑路径），明文混存合法
    let root = test_root("enc");
    write(&root, "project.json", r#"{"resourceEncryption":true}"#);
    let key = [7u8; 32];
    let plain_story = r#"{"formatVersion":1,"id":"start","kind":"flow","commands":[]}"#;
    let sealed = crate::resource_crypto::encrypt_lfen2(
        plain_story.as_bytes(),
        &key,
        "Stories/start.json",
    )
    .unwrap();
    fs::write(root.join("Stories/start.json.enc"), &sealed).unwrap();
    write(&root, "Stories/plain.story", "label plain:\n  say \"x\"\n");
    let files = read_project_files_with_key(&StdFs, &root, &key).unwrap();
    assert_eq!(files.stories.len(), 2);
    assert_eq!(files.stories["Stories/start.json"], plain_story); // 去后缀逻辑路径
    assert!(files.stories.contains_key("Stories/plain.story")); // 明文混存
}

#[test]
fn encrypted_story_without_key_fails_closed() {
    // 无钥遇 `.enc` fail-closed，不喂组装器密文
    let root = test_root("nokey");
    write(&root, "project.json", "{}");
    fs::write(root.join("Stories/x.json.enc"), b"LFEN2garbage").unwrap();
    assert!(matches!(
        read_project_files(&StdFs, &root),
        Err(ProjectFilesError::Decrypt(_))
    ));
}

#[test]
fn packed_output_feeds_runtime_supply() {
    // 互锁：打包产物（清单 resourceEncryption=true + 内容 .enc + seed）
    // → 运行时供给链零改动可读（故事/多语言 overlay/媒体解密同规则）
    let base = std::env::temp_dir().join(format!(
        "lf3-pack-runtime-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let input = base.join("in");
    let output = base.join("out");
    fs::create_dir_all(input.join("Stories")).unwrap();
    fs::create_dir_all(input.join("Lang/en")).unwrap();
    fs::write(
        input.join("project.json"),
        r#"{"formatVersion":1,"id":"demo","entry":"start"}"#,
    )
    .unwrap();
    fs::write(
        input.join("Stories/start.json"),
        r#"{"formatVersion":1,"id":"start","kind":"flow","commands":[]}"#,
    )
    .unwrap();
    fs::write(input.join("Lang/en/main.json"), "{\"你好\":\"Hello\"}").unwrap();

    let report = crate::resource_crypto::pack_project(&input, &output).unwrap();
    assert_eq!(report.files, 2);
    let seed = fs::read(output.join("__key__.seed")).unwrap();

    // 故事供给：清单形态判定 → .enc 解密 → 逻辑路径（去 .enc）
    let files = read_project_files_with_key(&StdFs, &output, &seed).unwrap();
    assert_eq!(
        files.manifest["resourceEncryption"],
        serde_json::Value::Bool(true)
    );
    assert_eq!(files.stories.len(), 1);
    assert_eq!(
        files.stories["Stories/start.json"],
        r#"{"formatVersion":1,"id":"start","kind":"flow","commands":[]}"#
    );

    // 多语言 overlay 供给：main.json 兜底优先（明文源 → .enc 包 → 解密）
    let overlays = load_overlay_files(&StdFs, &output, "en", Some(&seed)).unwrap();
    assert_eq!(overlays.len(), 1);
    assert_eq!(overlays[0].path, "main.json");
    assert_eq!(overlays[0].entries["你好"], "Hello");
    fs::remove_dir_all(&base).ok();
}

#[test]
fn list_languages_without_lang_root_is_default_only() {
    // 无 Lang/ 目录 = 仅默认语言，不报错
    let root = test_root("langs-none");
    write(&root, "project.json", "{}");
    assert_eq!(
        scan_i18n_languages(&StdFs, &root),
        vec!["zh-CN".to_string()]
    );
}

#[test]
fn list_languages_scans_dirs_and_files_deterministically() {
    // 子目录名 + 单文件名（去扩展名）；恒含 zh-CN 居首；
    // .json.enc 单文件也识别（通配 *.json 会漏加密形态）；其余字典序
    let root = test_root("langs-scan");
    write(&root, "project.json", "{}");
    fs::create_dir_all(root.join("Lang/en-US")).unwrap();
    fs::create_dir_all(root.join("Lang/ja")).unwrap();
    write(&root, "Lang/fr.json.enc", "x");
    write(&root, "Lang/zh-TW.json", "x");
    write(&root, "Lang/notes.txt", "x"); // 非 json 文件不算语言
    fs::create_dir_all(root.join("Lang/.hidden")).unwrap(); // 点目录不算
    let langs = scan_i18n_languages(&StdFs, &root);
    assert_eq!(
        langs,
        vec![
            "zh-CN".to_string(),
            "en-US".to_string(),
            "fr".to_string(),
            "ja".to_string(),
            "zh-TW".to_string(),
        ]
    );
}

#[test]
fn list_languages_ignores_case_duplicates() {
    // 大小写不敏感去重
    let root = test_root("langs-case");
    write(&root, "project.json", "{}");
    fs::create_dir_all(root.join("Lang/ZH-cn")).unwrap();
    assert_eq!(
        scan_i18n_languages(&StdFs, &root),
        vec!["zh-CN".to_string()]
    );
}

fn dummy_event() -> notify::Result<notify::Event> {
    Ok(notify::Event::new(notify::EventKind::Any))
}

#[test]
fn debouncer_merges_burst_into_one_callback() {
    // 编辑器保存的突发多事件（截断+写入/替换）合并为一次通知
    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
    let fired = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counter = std::sync::Arc::clone(&fired);
    std::thread::spawn(move || {
        run_event_debouncer(rx, std::time::Duration::from_millis(80), move || {
            counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        })
    });
    for _ in 0..5 {
        tx.send(dummy_event()).unwrap(); // 突发
    }
    std::thread::sleep(std::time::Duration::from_millis(300));
    assert_eq!(fired.load(std::sync::atomic::Ordering::SeqCst), 1);
    tx.send(dummy_event()).unwrap(); // 第二轮突发
    std::thread::sleep(std::time::Duration::from_millis(300));
    assert_eq!(fired.load(std::sync::atomic::Ordering::SeqCst), 2);
    drop(tx); // 断开：防抖线程尾结算后退出
    std::thread::sleep(std::time::Duration::from_millis(80));
}

#[test]
fn debouncer_flushes_pending_on_disconnect() {
    // 断开时有未结算事件 → 补发一次后退出（不丢尾事件）
    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
    let fired = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counter = std::sync::Arc::clone(&fired);
    std::thread::spawn(move || {
        run_event_debouncer(rx, std::time::Duration::from_millis(80), move || {
            counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        })
    });
    tx.send(dummy_event()).unwrap();
    drop(tx);
    std::thread::sleep(std::time::Duration::from_millis(200));
    assert_eq!(fired.load(std::sync::atomic::Ordering::SeqCst), 1);
}

// —— I18N overlay 供给 ——

#[test]
fn overlay_dir_files_recursed_and_sorted() {
    // 目录形式递归收集（子文件夹分类合法），仅 .json，路径排序输出确定性
    let root = test_root("i18n-dir");
    write(&root, "Lang/en/main.json", r#"{"你好":"Hello"}"#);
    write(&root, "Lang/en/ui/battle.json", r#"{"攻击":"Attack"}"#);
    write(&root, "Lang/en/notes.txt", "not json");
    let files = load_overlay_files(&StdFs, &root, "en", None).unwrap();
    assert_eq!(files.len(), 2);
    assert_eq!(files[0].path, "main.json");
    assert_eq!(files[1].path, "ui/battle.json");
    assert_eq!(files[0].entries["你好"], "Hello");
}

#[test]
fn overlay_single_file_fallback_supplies_main_json() {
    // 降级：无 Lang/{lang}/ 目录 → 单文件 Lang/{lang}.json，以 "main.json" 供给（全局兜底语义）
    let root = test_root("i18n-single");
    write(&root, "Lang/ja.json", r#"{"早上好":"おはよう"}"#);
    let files = load_overlay_files(&StdFs, &root, "ja", None).unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, "main.json");
    assert_eq!(files[0].entries["早上好"], "おはよう");
}

#[test]
fn overlay_invalid_lang_fails_closed() {
    // lang 路径段校验（防路径穿越），fail-closed 显式报错
    let root = test_root("i18n-bad-lang");
    assert!(load_overlay_files(&StdFs, &root, "../etc", None).is_err());
    assert!(load_overlay_files(&StdFs, &root, "", None).is_err());
    assert!(load_overlay_files(&StdFs, &root, "a/b", None).is_err());
}

#[test]
fn overlay_bad_or_nonstring_json_skipped() {
    // 宽松口径：损坏 / 含非字符串值的文件跳过，其余照常供给
    let root = test_root("i18n-lenient");
    write(&root, "Lang/en/main.json", r#"{"ok":"Yes"}"#);
    write(&root, "Lang/en/broken.json", "{ not json");
    write(&root, "Lang/en/nonstring.json", r#"{"num":42}"#);
    let files = load_overlay_files(&StdFs, &root, "en", None).unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, "main.json");
}

#[test]
fn overlay_encrypted_translations_decrypt() {
    // 加密译文与故事同机制：LFEN2 + AAD = 资源根相对路径（去 .enc）
    let root = test_root("i18n-enc");
    write(&root, "project.json", r#"{"resourceEncryption":true}"#);
    let key = [9u8; 32];
    let plain = r#"{"你好":"Hi"}"#;
    let sealed =
        crate::resource_crypto::encrypt_lfen2(plain.as_bytes(), &key, "Lang/en/main.json")
            .unwrap();
    fs::create_dir_all(root.join("Lang/en")).unwrap();
    fs::write(root.join("Lang/en/main.json.enc"), &sealed).unwrap();
    let files = load_overlay_files(&StdFs, &root, "en", Some(&key)).unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, "main.json");
    assert_eq!(files[0].entries["你好"], "Hi");
}

#[test]
fn overlay_encrypted_without_key_fails_closed() {
    // 无钥遇加密译文 fail-closed，不喂引擎密文
    let root = test_root("i18n-enc-nokey");
    write(&root, "Lang/en/main.json.enc", "LFEN2garbage");
    assert!(matches!(
        load_overlay_files(&StdFs, &root, "en", None),
        Err(ProjectFilesError::Decrypt(_))
    ));
}
