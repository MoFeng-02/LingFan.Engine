//! 存档层的行为测试。

use crate::crypto::KEK_SERVICE;
use crate::crypto::KEK_USER;
use crate::crypto::kek_from_keyring;
use crate::save::core::{save_path, saves_dir};
use std::fs;
use std::path::PathBuf;

use super::*;

fn test_base(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "lf3-test-{tag}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn kek_persists_in_os_credential_store() {
    // 两次获取同一 KEK（来自 OS 凭据，非随机重生）
    let a = kek_from_keyring(KEK_SERVICE, KEK_USER).unwrap();
    let b = kek_from_keyring(KEK_SERVICE, KEK_USER).unwrap();
    assert_eq!(a, b);
    assert_eq!(a.len(), 32);
}

#[test]
fn round_trip_machine_bound() {
    let base = test_base("rt");
    let meta = write_save(&base, "slot_1", "{\"gold\":120}", CryptoMode::MachineBound).unwrap();
    assert_eq!(meta.save_count, 1);
    assert_eq!(read_save(&base, "slot_1").unwrap(), "{\"gold\":120}");
}

#[test]
fn per_save_dek_ciphertext_differs() {
    // 同 payload 两次写档，密文不同（随机 DEK + 随机 nonce）
    let base = test_base("dek");
    write_save(&base, "slot_1", "same", CryptoMode::MachineBound).unwrap();
    let first = fs::read(save_path(&base, "slot_1")).unwrap();
    write_save(&base, "slot_1", "same", CryptoMode::MachineBound).unwrap();
    let second = fs::read(save_path(&base, "slot_1")).unwrap();
    assert_ne!(first, second);
}

#[test]
fn aad_binding_rejects_slot_move() {
    // AAD 绑槽：把 slot_1 的档搬到 slot_2 必拒
    let base = test_base("aad");
    write_save(&base, "slot_1", "data", CryptoMode::MachineBound).unwrap();
    fs::copy(save_path(&base, "slot_1"), save_path(&base, "slot_2")).unwrap();
    match read_save(&base, "slot_2") {
        Err(SaveError::Crypto(_)) => {}
        other => panic!("跨槽读取应被 GCM 认证拒绝，实际：{other:?}"),
    }
}

#[test]
fn high_water_rejects_rollback() {
    // 旧档回放被高水位拒绝
    let base = test_base("hw");
    write_save(&base, "slot_1", "newer", CryptoMode::MachineBound).unwrap();
    let older = fs::read(save_path(&base, "slot_1")).unwrap();
    write_save(&base, "slot_1", "newest", CryptoMode::MachineBound).unwrap();
    fs::write(save_path(&base, "slot_1"), &older).unwrap(); // 模拟回档：旧文件放回
    match read_save(&base, "slot_1") {
        Err(SaveError::RollbackDetected {
            save_count,
            high_water,
        }) => {
            assert_eq!(save_count, 1);
            assert_eq!(high_water, 2);
        }
        other => panic!("回档应被拒绝，实际：{other:?}"),
    }
    // 正常最新档可读（认领后高水位不变）
    fs::write(save_path(&base, "slot_1"), b"placeholder").unwrap();
    write_save(&base, "slot_1", "newest", CryptoMode::MachineBound).unwrap();
    assert_eq!(read_save(&base, "slot_1").unwrap(), "newest");
}

#[test]
fn decrypt_fail_closed_no_plaintext_fallback() {
    // 篡改密文 → 认证失败，绝不降级明文
    let base = test_base("ff");
    write_save(&base, "slot_1", "secret", CryptoMode::MachineBound).unwrap();
    let mut file = fs::read(save_path(&base, "slot_1")).unwrap();
    let last = file.len() - 1;
    file[last] ^= 0xFF;
    fs::write(save_path(&base, "slot_1"), &file).unwrap();
    match read_save(&base, "slot_1") {
        Err(SaveError::Crypto(_)) => {}
        other => panic!("篡改后应 fail-closed，实际：{other:?}"),
    }
}

#[test]
fn bad_magic_rejected() {
    let base = test_base("magic");
    write_save(&base, "slot_1", "data", CryptoMode::MachineBound).unwrap();
    let mut file = fs::read(save_path(&base, "slot_1")).unwrap();
    file[0] = b'X';
    fs::write(save_path(&base, "slot_1"), &file).unwrap();
    assert!(matches!(
        read_save(&base, "slot_1"),
        Err(SaveError::BadFormat(_))
    ));
}

#[test]
fn portable_mode_round_trip() {
    // Portable 档独立于 KEK，同 payload 可跨 base 读取
    let base_a = test_base("pt-a");
    let base_b = test_base("pt-b");
    write_save(&base_a, "slot_1", "share-me", CryptoMode::Portable).unwrap();
    fs::create_dir_all(saves_dir(&base_b)).unwrap();
    fs::copy(save_path(&base_a, "slot_1"), save_path(&base_b, "slot_1")).unwrap();
    assert_eq!(read_save(&base_b, "slot_1").unwrap(), "share-me");
}

#[test]
fn invalid_slot_rejected() {
    let base = test_base("slot");
    assert!(matches!(
        write_save(&base, "../evil", "x", CryptoMode::MachineBound),
        Err(SaveError::InvalidSlot(_))
    ));
}

#[test]
fn delete_slot_keeps_high_water() {
    // 删档后高水位不回退——新档计数继续、旧档重放仍被拒
    let base = test_base("del");
    write_save(&base, "slot_1", "old", CryptoMode::MachineBound).unwrap();
    let before = fs::read(save_path(&base, "slot_1")).unwrap();
    write_save(&base, "slot_1", "new", CryptoMode::MachineBound).unwrap();
    delete_save(&base, "slot_1").unwrap();
    assert!(matches!(
        read_save(&base, "slot_1"),
        Err(SaveError::UnknownSlot(_))
    ));
    // 删后重写：计数从高水位继续（未被删除重置）
    let meta = write_save(&base, "slot_1", "fresh", CryptoMode::MachineBound).unwrap();
    assert_eq!(meta.save_count, 3);
    // 删除前的旧档放回 = 回档仍被拒（高水位 3 > 档内 1）
    fs::write(save_path(&base, "slot_1"), &before).unwrap();
    assert!(matches!(
        read_save(&base, "slot_1"),
        Err(SaveError::RollbackDetected { .. })
    ));
}

#[test]
fn delete_unknown_slot_fails() {
    let base = test_base("del-unknown");
    assert!(matches!(
        delete_save(&base, "ghost"),
        Err(SaveError::UnknownSlot(_))
    ));
}
