//! 打包结果的数据结构与异常判定。

use serde::Serialize;

/// 报告条目：路径 + 分类原因（措辞与加密要求例外清单一致）
#[derive(Debug, Serialize)]
pub struct PackEntry {
    pub path: String,
    pub reason: &'static str,
}

/// 打包结果报告（已加密 / 明文 / 排除 / 未入包 分类明细，口径与加密要求一致）
#[derive(Debug, Serialize)]
pub struct PackReport {
    pub files: usize,
    /// 加密入包的逻辑路径（原路径，包内为 `路径 + .enc`）
    pub encrypted: Vec<String>,
    /// 包内明文（有因）：project.json = 工程元数据（运行期形态判定先决读取）、__key__.seed = 密钥引导
    pub plaintext: Vec<PackEntry>,
    /// 排除不入包（有因）：Saves/（玩家数据）、点文件（隐藏/系统）
    pub excluded: Vec<PackEntry>,
    /// 未入包（打包者须决断）：扩展名白名单外——运行期资源缺失 fail-closed 暴露，不静默明文
    pub skipped: Vec<PackEntry>,
}

impl PackReport {
    /// `--strict` 判定：报告含任何「未入包 / 明文例外」⇒ 有例外（非零退出）。
    /// 明文例外 = 资源侧必须明文的文件（入口 html/splash，届时在此并入判定）；
    /// project.json（工程元数据）与 Saves/seed（运行期产物/密钥引导）是有因归类，不算例外。
    pub fn has_exceptions(&self) -> bool {
        !self.skipped.is_empty()
    }
}

/// 扫描分类收集器：encrypt_directory_inner 逐文件判定时填充
#[derive(Default)]
pub(crate) struct PackScan {
    pub(crate) encrypted: Vec<String>,
    pub(crate) excluded: Vec<PackEntry>,
    pub(crate) skipped: Vec<PackEntry>,
}
