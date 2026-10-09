//! 资源读取原语与打包形态守卫的行为测试。

use super::*;
use crate::fs::seek_len;
use std::io::{Cursor, Read, Seek, SeekFrom};

/// 底层「大文件」：区间只是其中一段（Android 未压缩 asset 的 fd 指向整个 APK 同形）。
/// 区间 = [16, 32)，内容 10..26；区间外全为 0xAA，越界读取必然暴露。
fn backing() -> Cursor<Vec<u8>> {
    let mut v = vec![0xAAu8; 64];
    for (i, b) in v[16..32].iter_mut().enumerate() {
        *b = 10 + i as u8;
    }
    Cursor::new(v)
}

#[test]
fn ranged_file_read_stops_at_window_end() {
    let mut f = RangedFile::new(backing(), 16, 16).unwrap();
    let mut out = Vec::new();
    f.read_to_end(&mut out).unwrap();
    assert_eq!(
        out,
        (10u8..26).collect::<Vec<u8>>(),
        "必须只读到区间内，不得越界"
    );
}

#[test]
fn ranged_file_len_is_window_len() {
    let mut f = RangedFile::new(backing(), 16, 16).unwrap();
    assert_eq!(
        seek_len(&mut f).unwrap(),
        16,
        "长度 = 区间长，而非底层文件长"
    );
    assert_eq!(f.stream_position().unwrap(), 0, "seek_len 必须还原位置");
}

#[test]
fn ranged_file_seek_is_window_relative() {
    let mut f = RangedFile::new(backing(), 16, 16).unwrap();
    assert_eq!(f.seek(SeekFrom::Start(4)).unwrap(), 4);
    let mut b = [0u8; 2];
    f.read_exact(&mut b).unwrap();
    assert_eq!(b, [14, 15]);
    assert_eq!(f.seek(SeekFrom::End(-1)).unwrap(), 15);
    f.read_exact(&mut b[..1]).unwrap();
    assert_eq!(b[0], 25);
    assert_eq!(f.stream_position().unwrap(), 16);
    assert_eq!(
        f.seek(SeekFrom::Current(-1)).unwrap(),
        15,
        "Current 相对区间原点"
    );
    f.read_exact(&mut b[..1]).unwrap();
    assert_eq!(b[0], 25);
    assert_eq!(f.read(&mut b).unwrap(), 0, "区间末尾即 EOF");
    assert_eq!(f.seek(SeekFrom::Start(16)).unwrap(), 16);
    assert_eq!(f.read(&mut b).unwrap(), 0);
    assert!(f.seek(SeekFrom::Current(-17)).is_err(), "负偏移必须拒绝");
}

#[test]
fn ranged_file_zero_len_asset_is_empty() {
    let mut f = RangedFile::new(backing(), 0, 0).unwrap();
    let mut out = Vec::new();
    f.read_to_end(&mut out).unwrap();
    assert!(out.is_empty());
    assert_eq!(seek_len(&mut f).unwrap(), 0);
}

/// 防回归（`no-self-maintained-kotlin-plugin`）：`gen/android` 下不得再出现自维护 Kotlin
/// 插件。历史形态是「Rust 契约 + Kotlin 实现」成对演进——两侧字符串契约靠 `bridge_check`
/// 互锁，一旦有人只改一侧就静默失配。现供给与方向都收进 Rust（APK-ZIP 直读 + JNI 直调），
/// 该形态不应回流：这条守卫在有人重新引入时立刻变红。
#[test]
fn no_self_maintained_kotlin_plugin_in_gen() {
    let root = concat!(env!("CARGO_MANIFEST_DIR"), "/gen/android/app/src/main/java");
    // 自维护插件的历史包路径：assets/（枚举+打开）与 shell/（方向）
    for legacy in ["com/langfeng/lingfanengine/assets", "com/langfeng/lingfanengine/shell"] {
        let dir = format!("{root}/{legacy}");
        assert!(
            !std::path::Path::new(&dir).exists(),
            "自维护 Kotlin 插件目录不应存在：{dir}（供给与方向已收进 Rust）"
        );
    }
    // Rust 侧也不得再出现「注册 Android 插件」的调用面
    let rs = concat!(include_str!("mod.rs"), include_str!("contract.rs"), include_str!("std_fs.rs"), include_str!("apk_zip.rs"), include_str!("plugin.rs"), include_str!("tests.rs"));
    assert!(
        !rs.contains(concat!("register_", "android_plugin")),
        "Rust 侧不应再注册自维护 Android 插件"
    );
}
