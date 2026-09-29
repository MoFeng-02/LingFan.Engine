//! 诊断层（仅排错用，非产品行为）：接收渲染端探针上报并回传到日志（stderr）。
//!
//! 探针本体在前端 `apps/playground/src/diag.ts`（T10-01：由 Rust `eval` 注入改为
//! 前端 build-flag `VITE_LFEN_DIAG=1`——采样时机归页面生命周期，不再依赖注入延迟）；
//! 本模块只保留 `lfen_diag` 命令作为回传通道（stderr → iOS CI launch 日志 / Android logcat）。
//! 默认构建探针被 tree-shake，命令存在但零调用——零行为。

/// 渲染端上报的键值对（原样打印，不做解析——诊断层不解释业务）
#[tauri::command]
pub fn lfen_diag(payload: String) {
    eprintln!("[lfen-diag] {payload}");
}
