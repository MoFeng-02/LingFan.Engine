//! ZIP 索引与条目读取的行为测试。

use crate::zip_index::entry::{LOCAL_MAGIC};
use crate::zip_index::index::{CENTRAL_MAGIC, EOCD_MAGIC, U32_MAX};

use super::*;
use std::io::Cursor;

// —— fixture 构造（测试内自建 ZIP 写入端，覆盖 Stored 与 Deflated）——

fn deflate(data: &[u8]) -> Vec<u8> {
    use std::io::Write;
    let mut encoder = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(data).unwrap();
    encoder.finish().unwrap()
}

struct FixtureEntry {
    name: String,
    method: u16,
    data: Vec<u8>,
}

fn entry(name: &str, data: &[u8]) -> FixtureEntry {
    FixtureEntry {
        name: name.to_string(),
        method: METHOD_STORED,
        data: data.to_vec(),
    }
}

fn deflated(name: &str, data: &[u8]) -> FixtureEntry {
    FixtureEntry {
        name: name.to_string(),
        method: METHOD_DEFLATED,
        data: data.to_vec(),
    }
}

fn build_zip(entries: &[FixtureEntry], trailing_comment: &[u8]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    let mut central: Vec<u8> = Vec::new();
    let count = entries.len() as u16;
    for e in entries {
        let local_offset = out.len() as u32;
        let payload = match e.method {
            METHOD_DEFLATED => deflate(&e.data),
            _ => e.data.clone(),
        };
        out.extend_from_slice(&LOCAL_MAGIC.to_le_bytes());
        out.extend_from_slice(&20u16.to_le_bytes()); // version needed
        out.extend_from_slice(&0x0800u16.to_le_bytes()); // flags: UTF-8 名称
        out.extend_from_slice(&e.method.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes()); // time
        out.extend_from_slice(&0u16.to_le_bytes()); // date
        out.extend_from_slice(&0u32.to_le_bytes()); // crc（本解析器不校验）
        out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        out.extend_from_slice(&(e.data.len() as u32).to_le_bytes());
        out.extend_from_slice(&(e.name.len() as u16).to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes()); // extra
        out.extend_from_slice(e.name.as_bytes());
        out.extend_from_slice(&payload);

        central.extend_from_slice(&CENTRAL_MAGIC.to_le_bytes());
        central.extend_from_slice(&20u16.to_le_bytes()); // version made
        central.extend_from_slice(&20u16.to_le_bytes()); // version needed
        central.extend_from_slice(&0x0800u16.to_le_bytes()); // flags
        central.extend_from_slice(&e.method.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes()); // time
        central.extend_from_slice(&0u16.to_le_bytes()); // date
        central.extend_from_slice(&0u32.to_le_bytes()); // crc
        central.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        central.extend_from_slice(&(e.data.len() as u32).to_le_bytes());
        central.extend_from_slice(&(e.name.len() as u16).to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes()); // extra
        central.extend_from_slice(&0u16.to_le_bytes()); // comment
        central.extend_from_slice(&0u16.to_le_bytes()); // disk start
        central.extend_from_slice(&0u16.to_le_bytes()); // internal attrs
        central.extend_from_slice(&0u32.to_le_bytes()); // external attrs
        central.extend_from_slice(&local_offset.to_le_bytes());
        central.extend_from_slice(e.name.as_bytes());
    }
    let central_offset = out.len() as u32;
    let central_size = central.len() as u32;
    out.extend_from_slice(&central);
    out.extend_from_slice(&EOCD_MAGIC.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // disk
    out.extend_from_slice(&0u16.to_le_bytes()); // central dir disk
    out.extend_from_slice(&count.to_le_bytes()); // 本卷条目数
    out.extend_from_slice(&count.to_le_bytes()); // 总条目数
    out.extend_from_slice(&central_size.to_le_bytes());
    out.extend_from_slice(&central_offset.to_le_bytes());
    out.extend_from_slice(&(trailing_comment.len() as u16).to_le_bytes());
    out.extend_from_slice(trailing_comment);
    out
}

fn index_of(bytes: Vec<u8>) -> ZipIndex {
    let mut cursor = Cursor::new(bytes);
    ZipIndex::read_from(&mut cursor).unwrap_or_else(|e| panic!("索引构建失败：{e}"))
}

// —— 拟态旅程：混合条目的全量枚举与逐字节读取 ——

#[test]
fn zip_index_fixture_journey_byte_exact() {
    let media: Vec<u8> = (0..64 * 1024u32).map(|i| (i % 251) as u8).collect();
    let source = vec![
        entry("assets/Resources/Stories/start.json", br#"{"formatVersion":1}"#),
        deflated(
            "assets/Resources/Lang/en/main.json",
            "{\"key\":\"值 {var}\"}".as_bytes(),
        ),
        entry("assets/Resources/Audio/bgm.mp3", &media),
        entry("assets/Resources/dir/", b""),
        FixtureEntry {
            name: "assets/Resources/Lang/ja/日本語.json".into(),
            method: METHOD_STORED,
            data: b"{}".to_vec(),
        },
    ];
    let bytes = build_zip(&source, b"builder comment");
    let index = index_of(bytes.clone());
    assert_eq!(index.len(), source.len());

    // 枚举顺序 = 条目名字典序；walk_prefix 空前缀 = 全量
    let all = index.walk_prefix("");
    assert_eq!(all.len(), source.len());
    assert!(all.windows(2).all(|w| w[0].name < w[1].name));

    // 逐条目读取与源数据逐字节一致（含 64KB Stored 媒体与 Deflated 文本）；
    // 目录条目按契约拒绝读取（EntryNotFound），不进本循环
    for e in source.iter().filter(|e| !e.name.ends_with('/')) {
        let mut cursor = Cursor::new(bytes.clone());
        let got = index.read_entry(&mut cursor, &e.name).unwrap();
        assert_eq!(got, e.data, "条目内容不一致：{}", e.name);
    }

    // 目录条目判定 + 子树前缀查询（en 与 ja 两文件 + 目录条目 dir/ 不在前缀内）
    assert!(index.get("assets/Resources/dir/").unwrap().is_dir);
    let lang = index.walk_prefix("assets/Resources/Lang/");
    assert_eq!(lang.len(), 2);
}

// —— 边界：空归档 / 注释 / 前缀 ——

#[test]
fn zip_index_empty_archive_is_empty() {
    let index = index_of(build_zip(&[], b""));
    assert!(index.is_empty());
    assert!(index.walk_prefix("").is_empty());
}

#[test]
fn zip_index_trailing_comment_parses() {
    let index = index_of(build_zip(&[entry("a.txt", b"x")], vec![0u8; 4096].as_slice()));
    assert_eq!(index.len(), 1);
}

#[test]
fn zip_index_decoy_signature_in_comment_is_skipped() {
    // 注释里塞一段「伪 EOCD」：签名相符但注释长度字段不自洽（声明 5 字节注释、
    // 实际位置剩余 27 字节）——扫描器必须跳过它，取文件末尾长度自洽的真 EOCD。
    let mut fake = Vec::new();
    fake.extend_from_slice(&EOCD_MAGIC.to_le_bytes());
    fake.extend_from_slice(&[0u8; 16]);
    fake.extend_from_slice(&5u16.to_le_bytes());
    let mut comment = fake;
    comment.extend_from_slice(&[0xABu8; 10]);
    let index = index_of(build_zip(&[entry("a.txt", b"x")], &comment));
    assert_eq!(index.len(), 1);
}

// —— 故意错误：每条都必须 fail-closed ——

#[test]
fn zip_index_truncated_file_reports_eocd_missing() {
    let mut bytes = build_zip(&[entry("a.txt", b"x")], b"");
    bytes.truncate(bytes.len() - 10);
    let mut cursor = Cursor::new(bytes);
    assert!(matches!(
        ZipIndex::read_from(&mut cursor),
        Err(ZipIndexError::EocdNotFound)
    ));
}

#[test]
fn zip_index_not_a_zip_reports_eocd_missing() {
    let mut cursor = Cursor::new(vec![0u8; 4096]);
    assert!(matches!(
        ZipIndex::read_from(&mut cursor),
        Err(ZipIndexError::EocdNotFound)
    ));
}

#[test]
fn zip_index_central_directory_out_of_bounds_rejected() {
    let mut bytes = build_zip(&[entry("a.txt", b"x")], b"");
    // EOCD 的中央目录偏移字段（e+16，空注释时 = 文件末尾回推 6 字节）改写到文件之外
    let len = bytes.len();
    bytes[len - 6..len - 2].copy_from_slice(&(len as u32 + 4096).to_le_bytes());
    let mut cursor = Cursor::new(bytes);
    assert!(matches!(
        ZipIndex::read_from(&mut cursor),
        Err(ZipIndexError::CentralDirectoryOutOfBounds { .. })
    ));
}

#[test]
fn zip_index_truncated_central_directory_rejected() {
    let mut bytes = build_zip(&[entry("a.txt", b"x"), entry("b.txt", b"y")], b"");
    // EOCD 的总条目数字段（e+10，空注释时 = 回推 12 字节）翻倍 → 目录放不下
    let len = bytes.len();
    let declared = u16::from_le_bytes([bytes[len - 12], bytes[len - 11]]);
    bytes[len - 12..len - 10].copy_from_slice(&(declared * 2).to_le_bytes());
    let mut cursor = Cursor::new(bytes);
    assert!(matches!(
        ZipIndex::read_from(&mut cursor),
        Err(ZipIndexError::CentralDirectoryTruncated)
    ));
}

#[test]
fn zip_index_zip64_markers_rejected() {
    let mut bytes = build_zip(&[entry("a.txt", b"x")], b"");
    // 中央目录记录的未压缩长度字段（记录头内偏移 24）改写为 ZIP64 标记值
    let cd_start = u32::from_le_bytes(bytes[bytes.len() - 6..bytes.len() - 2].try_into().unwrap())
        as usize;
    bytes[cd_start + 24..cd_start + 28].copy_from_slice(&U32_MAX.to_le_bytes());
    let mut cursor = Cursor::new(bytes);
    assert!(matches!(
        ZipIndex::read_from(&mut cursor),
        Err(ZipIndexError::Zip64Unsupported { .. })
    ));
}

#[test]
fn zip_index_corrupted_local_header_rejected() {
    // 索引构建只依赖中央目录 → 本地文件头改坏后索引仍可构建；
    // 读取阶段（本地头校验）必须 fail-closed。
    let mut broken = build_zip(&[entry("a.txt", b"x")], b"");
    broken[0..4].copy_from_slice(&0u32.to_le_bytes());
    let index = index_of(broken.clone());
    let mut cursor = Cursor::new(broken);
    assert!(matches!(
        index.read_entry(&mut cursor, "a.txt"),
        Err(ZipIndexError::BadSignature { .. })
    ));
}

#[test]
fn zip_index_unsupported_method_rejected_on_read() {
    let mut source = vec![entry("a.bin", b"x")];
    source[0].method = 12; // bzip2 —— 不在支持范围
    let bytes = build_zip(&source, b"");
    let index = index_of(bytes.clone());
    let mut cursor = Cursor::new(bytes);
    assert!(matches!(
        index.read_entry(&mut cursor, "a.bin"),
        Err(ZipIndexError::UnsupportedMethod { method: 12, .. })
    ));
}

#[test]
fn zip_index_missing_entry_reports_name() {
    let index = index_of(build_zip(&[entry("a.txt", b"x")], b""));
    let mut cursor = Cursor::new(Vec::new());
    assert!(matches!(
        index.read_entry(&mut cursor, "nope.txt"),
        Err(ZipIndexError::EntryNotFound { name }) if name == "nope.txt"
    ));
}

#[test]
fn zip_index_directory_entry_read_rejected() {
    let index = index_of(build_zip(&[entry("dir/", b"")], b""));
    let mut cursor = Cursor::new(Vec::new());
    assert!(matches!(
        index.read_entry(&mut cursor, "dir/"),
        Err(ZipIndexError::EntryNotFound { .. })
    ));
}

// —— 边界：同名条目 / 前缀 ——

#[test]
fn zip_index_duplicate_name_keeps_first() {
    let bytes = build_zip(
        &[entry("dup.txt", b"first"), entry("dup.txt", b"second")],
        b"",
    );
    let index = index_of(bytes.clone());
    let mut cursor = Cursor::new(bytes);
    assert_eq!(index.len(), 1);
    assert_eq!(index.read_entry(&mut cursor, "dup.txt").unwrap(), b"first");
}

#[test]
fn zip_index_walk_prefix_is_strict_scope() {
    let index = index_of(build_zip(
        &[
            entry("assets/x.json", b"1"),
            entry("assets/sub/y.json", b"2"),
            entry("other/z.json", b"3"),
        ],
        b"",
    ));
    let names: Vec<&str> = index
        .walk_prefix("assets/")
        .iter()
        .map(|e| e.name.as_str())
        .collect();
    assert_eq!(names, vec!["assets/sub/y.json", "assets/x.json"]);
}

// —— 目录判定与子树枚举（供给适配器的两个原语）——

#[test]
fn zip_index_kind_covers_implicit_directories() {
    // 打包工具常不为目录生成独立条目：无显式条目但有子条目 ⇒ 判目录
    let index = index_of(build_zip(
        &[
            entry("assets/Resources/a.json", b"1"),
            entry("assets/Resources/sub/b.json", b"2"),
        ],
        b"",
    ));
    assert_eq!(index.kind_of("assets/Resources/a.json"), Some(false));
    assert_eq!(
        index.kind_of("assets/Resources/sub/"),
        Some(true),
        "显式目录条目"
    );
    assert_eq!(
        index.kind_of("assets/Resources/sub"),
        Some(true),
        "无显式条目但有子条目 ⇒ 隐式目录"
    );
    assert_eq!(index.kind_of("assets/Resources/none.json"), None);
}

#[test]
fn zip_index_walk_synthesizes_missing_directories() {
    // 无显式目录条目：子树枚举必须补合成中间目录（树连通），且不含前缀目录本身
    let index = index_of(build_zip(
        &[
            entry("assets/Resources/Stories/x.json", b"1"),
            entry("assets/Resources/Audio/a.mp3", b"2"),
        ],
        b"",
    ));
    let got = index.walk_synthesizing_dirs("assets/Resources/");
    assert_eq!(
        got,
        vec![
            ("assets/Resources/Audio/".to_string(), true),
            ("assets/Resources/Audio/a.mp3".to_string(), false),
            ("assets/Resources/Stories/".to_string(), true),
            ("assets/Resources/Stories/x.json".to_string(), false),
        ]
    );
}

#[test]
fn zip_index_walk_deduplicates_explicit_directory_entries() {
    // 显式目录条目与合成结果同名 ⇒ 只出现一次
    let index = index_of(build_zip(
        &[
            entry("assets/Resources/dir/", b""),
            entry("assets/Resources/dir/f.json", b"1"),
        ],
        b"",
    ));
    let got = index.walk_synthesizing_dirs("assets/Resources/");
    assert_eq!(
        got,
        vec![
            ("assets/Resources/dir/".to_string(), true),
            ("assets/Resources/dir/f.json".to_string(), false),
        ]
    );
}

#[test]
fn zip_index_data_offset_skips_local_name_and_extra() {
    // extra 字段在中央目录与本地头可不同长：数据偏移必须按本地头的两个长度字段
    // 计算（30 + name_len + extra_len），不能用中央目录的 extra 推断。
    let mut bytes = build_zip(&[entry("a.txt", b"payload")], b"");
    // 定位本地头的 extra 长度字段（偏移 28..30），改为 4 并插入 4 字节 extra + 数据不变
    // （fixture 写入端不做这事，这里手工重排：local 头(30)+name(5)+extra(4)+payload）
    let name_len = 5usize;
    let local_header = &mut bytes[0..30 + name_len];
    local_header[28..30].copy_from_slice(&4u16.to_le_bytes());
    let mut rebuilt: Vec<u8> = Vec::new();
    rebuilt.extend_from_slice(local_header);
    rebuilt.extend_from_slice(b"0000"); // 插入 extra
    rebuilt.extend_from_slice(b"payload");
    let payload_len = b"payload".len();
    // 之后是中央目录 + EOCD（跳过原 payload，重建段里已含）：local_offset 不变，
    // 但中央目录物理位置整体后移 4 字节，EOCD 里的 cd_offset 必须同步改写
    rebuilt.extend_from_slice(&bytes[30 + name_len + payload_len..]);
    let central_offset = (30 + name_len + 4 + payload_len) as u32;
    let len = rebuilt.len();
    rebuilt[len - 6..len - 2].copy_from_slice(&central_offset.to_le_bytes());
    let index = index_of(rebuilt.clone());
    let mut cursor = Cursor::new(rebuilt);
    assert_eq!(index.data_offset(&mut cursor, "a.txt").unwrap(), 39);
    assert_eq!(index.read_entry(&mut cursor, "a.txt").unwrap(), b"payload");
}
