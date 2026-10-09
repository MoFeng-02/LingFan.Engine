//! 工程写回的行为测试。

use crate::project_writer::whitelist::{MANIFEST_FILE, STORIES_DIR};
use std::fs;
use std::path::Path;

use super::*;
use std::path::PathBuf;

fn test_root(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "lf3-writer-{tag}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(dir.join(STORIES_DIR)).unwrap();
    dir
}

fn write(root: &Path, rel: &str, content: &str) {
    let path = root.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

fn change(path: &str, text: &str) -> ProjectFileChange {
    ProjectFileChange {
        path: path.into(),
        text: text.into(),
    }
}

#[test]
fn writes_columns_then_manifest_and_deletes_stale() {
    // 写回不变量：先写后删、manifest 是提交点
    let root = test_root("happy");
    write(&root, "Stories/old.json", "{旧列}");
    let report = apply_project_files(
        root.to_string_lossy().into_owned(),
        vec![
            change("project.json", "{清单v2}"),
            change("Stories/a.json", "{列a}"),
            change("Stories/sub/b.json", "{列b}"),
        ],
        vec!["Stories/old.json".into()],
    )
    .unwrap();
    assert_eq!(
        report.written,
        ["Stories/a.json", "Stories/sub/b.json", "project.json"]
    );
    assert_eq!(report.deleted, ["Stories/old.json"]);
    assert_eq!(
        fs::read_to_string(root.join("Stories/a.json")).unwrap(),
        "{列a}"
    );
    assert_eq!(
        fs::read_to_string(root.join("Stories/sub/b.json")).unwrap(),
        "{列b}"
    );
    assert_eq!(
        fs::read_to_string(root.join("project.json")).unwrap(),
        "{清单v2}"
    );
    assert!(!root.join("Stories/old.json").exists());
}

#[test]
fn invalid_path_rejects_whole_batch_with_zero_writes() {
    let root = test_root("escape");
    write(&root, "Stories/keep.json", "{保持}");
    for evil in [
        "Stories/../evil.json",
        "src/main.rs",
        "Stories/a\\b.json",
        "",
    ] {
        let result = apply_project_files(
            root.to_string_lossy().into_owned(),
            vec![change("Stories/keep.json", "改"), change(evil, "x")],
            vec![],
        );
        assert!(
            matches!(result, Err(ProjectWriterError::BadPath(_))),
            "{evil}"
        );
    }
    // 零写入：原有文件未被改动，非法目标也不存在
    assert_eq!(
        fs::read_to_string(root.join("Stories/keep.json")).unwrap(),
        "{保持}"
    );
    assert!(!root.join("evil.json").exists());
    assert!(!root.join("src").exists());
}

#[test]
fn manifest_cannot_be_deleted() {
    let root = test_root("delmanifest");
    write(&root, "project.json", "{清单}");
    let result = apply_project_files(
        root.to_string_lossy().into_owned(),
        vec![],
        vec![MANIFEST_FILE.into()],
    );
    assert!(matches!(result, Err(ProjectWriterError::BadDelete(_))));
    assert_eq!(
        fs::read_to_string(root.join("project.json")).unwrap(),
        "{清单}"
    );
}

#[test]
fn delete_missing_file_is_idempotent() {
    let root = test_root("idempotent");
    let report = apply_project_files(
        root.to_string_lossy().into_owned(),
        vec![],
        vec!["Stories/gone.json".into()],
    )
    .unwrap();
    assert_eq!(report.deleted, ["Stories/gone.json"]);
}

#[test]
fn write_failure_happens_before_any_delete() {
    // 先写后删不变量：写入阶段失败（目标路径是目录）→ 删除阶段绝不执行
    let root = test_root("failbeforedelete");
    write(&root, "Stories/stale.json", "{陈旧}");
    fs::create_dir_all(root.join("Stories/dir-as-file")).unwrap();
    let result = apply_project_files(
        root.to_string_lossy().into_owned(),
        vec![change("Stories/dir-as-file", "写目录必失败")],
        vec!["Stories/stale.json".into()],
    );
    assert!(matches!(result, Err(ProjectWriterError::Io(_))));
    assert!(root.join("Stories/stale.json").exists()); // 陈旧文件未删
}

#[test]
fn missing_root_fails_closed() {
    let result = apply_project_files(
        std::env::temp_dir()
            .join(format!("lf3-missing-{}", std::process::id()))
            .to_string_lossy()
            .into_owned(),
        vec![],
        vec![],
    );
    assert!(matches!(result, Err(ProjectWriterError::Root(_))));
}

#[test]
fn stamps_report_mtime_and_size_and_skip_missing() {
    // 指纹 = mtime 毫秒 + size；缺失路径不出现在结果里（调用方判冲突）
    let root = test_root("stamp");
    write(&root, "Stories/a.json", "{列a}");
    write(&root, "project.json", "{清单}");
    let stamps = stamp_project_files(
        root.to_string_lossy().into_owned(),
        vec![
            "Stories/a.json".into(),
            "project.json".into(),
            "Stories/gone.json".into(),
        ],
    )
    .unwrap()
    .stamps;
    assert_eq!(stamps.len(), 2);
    let a = stamps.iter().find(|s| s.path == "Stories/a.json").unwrap();
    assert_eq!(a.size, "{列a}".len() as u64);
    assert!(a.last_modified > 0);
    assert!(stamps.iter().all(|s| s.path != "Stories/gone.json"));
}

#[test]
fn stamp_rejects_paths_outside_write_whitelist() {
    let root = test_root("stampwhitelist");
    let result = stamp_project_files(
        root.to_string_lossy().into_owned(),
        vec!["src/main.rs".into()],
    );
    assert!(matches!(result, Err(ProjectWriterError::BadPath(_))));
}
