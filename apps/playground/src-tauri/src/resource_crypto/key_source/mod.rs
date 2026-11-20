//! 资源密钥获取策略的可插拔接缝：端口（trait）+ 默认适配器 + 组合根选择。
//!
//! crypto 核心只消费 DEK 字节、不关心来源；具体策略由适配器实现，组合根（lib.rs）
//! 构建期安装默认适配器。依赖单向：核心 → DEK 字节，不反向依赖具体 source。
//! 未来在线激活 / 白盒 / 许可证绑定等更强 provider 自替换组合根那一行即可，核心零改动。
//!
//! 默认适配器 = 包内 seed（casual 级）：seed 即明文 DEK 随包，KEK 信封只是运行期缓存，
//! 不构成跨机屏障；保包更新跟随。诚实口径见安全规约「三-1」。

use crate::resource_crypto::error::ResourceCryptoError;
use crate::resource_fs::ResourceFs;
use std::path::Path;
use std::sync::OnceLock;

mod pack_seed;
pub(crate) use pack_seed::PackSeedSource;

/// 资源 DEK 长度（AES-256）。
pub(crate) const DEK_LEN: usize = 32;

/// 资源密钥信封文件（app data 内，KEK 封装）。
pub(crate) const DEK_ENVELOPE: &str = "resources.dek.lfk2";

/// 构建产物：包内原始 DEK（首次运行导入后转信封；只读资源根不删——分发窗口边界已知）。
pub(crate) const DEK_SEED: &str = "__key__.seed";

/// 信封 AAD（域分离：资源 DEK 信封）。
pub(crate) const AAD_RESOURCE_DEK: &[u8] = b"LFK2:resource-dek";

/// 密钥获取上下文：信封真实路径（app_data，走 std::fs）+ 资源根（seed 经 resfs 抽象，
/// Android = asset 内）。
pub(crate) struct KeyAcquireContext<'a> {
    pub app_data: &'a Path,
    pub resource_root: &'a Path,
    pub resfs: &'a dyn ResourceFs,
}

/// 资源密钥来源端口：`acquire` 返回 DEK 字节。实现方负责密钥获取策略，crypto 核心
/// 不依赖具体实现。`Send + Sync`：经静态安装、多线程 IPC / 协议供给调用。
pub(crate) trait ResourceKeySource: Send + Sync {
    fn acquire(&self, ctx: &KeyAcquireContext<'_>) -> Result<Vec<u8>, ResourceCryptoError>;
}

static KEY_SOURCE: OnceLock<Box<dyn ResourceKeySource>> = OnceLock::new();

/// 组合根构建期安装密钥来源（首次安装生效；重复安装忽略——构建期单点选择）。
pub(crate) fn install_key_source(source: Box<dyn ResourceKeySource>) {
    let _ = KEY_SOURCE.set(source);
}

/// 当前密钥来源；未安装时回退默认 `PackSeedSource`（测试 / 预热路径无需显式安装）。
pub(crate) fn current_key_source() -> &'static dyn ResourceKeySource {
    KEY_SOURCE.get_or_init(|| Box::new(PackSeedSource)).as_ref()
}

/// 经指定来源取 DEK（可替换性接缝：核心委托给传入的适配器，不写死任何具体策略）。
/// `resource_dek` 把 `current_key_source()` 传进来；测试可注入任意适配器验证委托。
pub(crate) fn resource_dek_with(
    source: &dyn ResourceKeySource,
    app_data: &Path,
    resource_root: &Path,
    resfs: &dyn ResourceFs,
) -> Result<Vec<u8>, ResourceCryptoError> {
    source.acquire(&KeyAcquireContext {
        app_data,
        resource_root,
        resfs,
    })
}