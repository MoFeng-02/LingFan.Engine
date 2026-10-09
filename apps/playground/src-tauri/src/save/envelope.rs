//! LFS3 信封：魔数与 AAD 常量、加密模式编解码、头部解析。

use crate::save::core::{SaveError};

/// 信封魔数（文件前 4 字节）；不匹配即判非本格式，不做任何解密尝试。
pub(crate) const MAGIC: &[u8; 4] = b"LFS3";

/// 信封格式版本（第 5-6 字节，大端）；未知版本按格式错误拒绝，避免误读旧档。
pub(crate) const FORMAT_VERSION: u16 = 1;

/// 负载 AAD 前缀，与槽名拼接后参与认证：换槽改名即解密失败，防张冠李戴。
pub(crate) const AAD_PAYLOAD_PREFIX: &str = "LFS3:payload:";

/// 机器绑定模式下 KEK 封装 DEK 的 AAD，与负载 AAD 域分离——两者密文不可互换。
pub(crate) const AAD_DEK_MACHINE_BOUND: &[u8] = b"LFS3:dek:machine-bound";

/// 存档的密钥封装方式：机器绑定（KEK 封装）或可移植（DEK 随档）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CryptoMode {
    MachineBound,
    Portable,
}

impl CryptoMode {
    /// 按名称解析加密模式（`machine-bound` / `portable`），未知名称即报错。
    pub fn parse(s: &str) -> Result<Self, SaveError> {
        match s {
            "machine-bound" => Ok(CryptoMode::MachineBound),
            "portable" => Ok(CryptoMode::Portable),
            other => Err(SaveError::BadFormat(format!("未知存档模式：{other}"))),
        }
    }

    /// 模式码（写入信封第 6 字节）。
    pub(crate) fn code(self) -> u8 {
        match self {
            CryptoMode::MachineBound => 0,
            CryptoMode::Portable => 1,
        }
    }

    /// 按模式码还原（读信封时用），未知码即报格式错误。
    fn from_code(c: u8) -> Result<Self, SaveError> {
        match c {
            0 => Ok(CryptoMode::MachineBound),
            1 => Ok(CryptoMode::Portable),
            other => Err(SaveError::BadFormat(format!("未知模式码：{other}"))),
        }
    }

    /// 模式名（对外呈现与回写用，与 [`CryptoMode::parse`] 的入参同名）。
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            CryptoMode::MachineBound => "machine-bound",
            CryptoMode::Portable => "portable",
        }
    }
}

/// LFS3 信封解析产物：模式、save_count、timestamp、nonce、密文体
type EnvelopeParts = (CryptoMode, u64, u64, Vec<u8>, Vec<u8>);

/// 解析 LFS3 信封头部，返回模式、计数、时间戳、DEK 段与密文体。
pub(crate) fn parse_envelope(file: &[u8]) -> Result<EnvelopeParts, SaveError> {
    const HEADER: usize = 4 + 2 + 1 + 8 + 8 + 4;
    if file.len() < HEADER {
        return Err(SaveError::BadFormat("文件过短".into()));
    }
    if &file[0..4] != MAGIC {
        return Err(SaveError::BadFormat("魔数不符（非 LFS3）".into()));
    }
    let version = u16::from_be_bytes([file[4], file[5]]);
    if version != FORMAT_VERSION {
        return Err(SaveError::BadFormat(format!("格式版本不支持：{version}")));
    }
    let mode = CryptoMode::from_code(file[6])?;
    let save_count = u64::from_be_bytes(file[7..15].try_into().expect("切片长度固定"));
    let timestamp = u64::from_be_bytes(file[15..23].try_into().expect("切片长度固定"));
    let dek_len = u32::from_be_bytes(file[23..27].try_into().expect("切片长度固定")) as usize;
    if file.len() < HEADER + dek_len {
        return Err(SaveError::BadFormat("dek_part 越界".into()));
    }
    let dek_part = file[HEADER..HEADER + dek_len].to_vec();
    let ciphertext = file[HEADER + dek_len..].to_vec();
    Ok((mode, save_count, timestamp, dek_part, ciphertext))
}
