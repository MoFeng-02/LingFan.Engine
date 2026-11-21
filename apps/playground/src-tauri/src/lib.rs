//! Tauri 宿主 crate 的装配入口：模块声明 + `run()` 里的插件装配与命令注册。
//!
//! 各模块自己实现能力，这里只做三件事——把模块挂上、把命令注册进 `invoke_handler!`、
//! 在启动序列里按平台装配插件与后台任务。命令名与前端 `invoke` 的对应关系由源级测试守护。

pub mod boot;
pub mod crypto;
pub mod diagnostics;
pub mod fs;
pub mod host;
pub mod http;
pub mod media_http;
pub mod paths;
pub mod persistent;
pub mod preferences;
pub mod project_files;
pub mod project_writer;
pub mod protocol_pool;
pub mod resource_crypto;
pub mod resource_fs;
pub mod resource_plain;
pub mod save;
pub mod shell;
pub mod zip_index;
// 开发期 WS 通道：仅 debug 构建编译——release 编译期排除（无监听代码）
#[cfg(debug_assertions)]
pub mod ws_dev;

#[cfg(test)]
mod bridge_check;

/// 应用入口：装配插件与命令注册，随后进入 Tauri 事件循环（不返回）。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 资源密钥来源：组合根构建期选择默认适配器（包内 seed，casual 级）。
    // 未来更强 provider（在线激活 / 白盒 / 许可证绑定）替换这一行即可，crypto 核心零改动。
    resource_crypto::key_source::install_key_source(Box::new(
        resource_crypto::key_source::PackSeedSource,
    ));

    let builder = tauri::Builder::default()
        // 移动端供给：fs 插件 = asset:// 读取原语（Rust 侧经 FsExt 取可 seek fd）。
        // 其 JS 命令不在 capabilities 授权面内（default.json 仅 core + 本应用命令），对 webview 默认拒绝。
        // opener 插件不装配：前端与 Rust 均无打开外链/揭示目录的需求，未用授权一律不挂（fail-closed）。
        .plugin(tauri_plugin_fs::init())
        // 大资源流式：lfstream 协议双路径——v2 分块按需解密（Range/206，明文不落盘）
        // + v1 token 缓存；缓存文件名信任边界（hex64.ext / v2/逻辑路径 validate）在 handler 内。
        // 明文资源段（`raw/` 前缀）同协议、同 Range 实现，按路径前缀先分流：它供的是构建期
        // 未加密的音视频/图/字体，与加密段的 `v2/`、v1 token 命名空间互不重叠。
        //
        // 异步注册 + 工作线程池：解密/读盘在 worker 线程执行，响应经 responder 异步交付——
        // WebView 的 UI 线程只投递请求，不被协议供给阻塞（性能契约：协议供给不得阻塞 UI 线程）。
        .register_asynchronous_uri_scheme_protocol("lfstream", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            protocol_pool::dispatch(move || {
                // 面包屑仅 debug 构建：把「卡在协议供给里」夹出来（有「进入」无「返回」即卡点）；
                // release 不打印每请求 URI（避免日志元数据泄露）。
                #[cfg(debug_assertions)]
                let uri = request.uri().to_string();
                #[cfg(debug_assertions)]
                eprintln!("[lfen] lfstream 进入：{uri}");
                let response = if resource_plain::handles(request.uri().path()) {
                    resource_plain::serve(request, &app)
                } else {
                    resource_crypto::lfstream_protocol_handler(request, &app)
                };
                #[cfg(debug_assertions)]
                eprintln!("[lfen] lfstream 返回：{uri}");
                responder.respond(response);
            });
        })
        .invoke_handler(tauri::generate_handler![
            project_files::project_files,
            project_files::watch_project_files,
            project_files::load_i18n_overlay,
            project_files::list_i18n_languages,
            project_writer::apply_project_files,
            project_writer::stamp_project_files,
            preferences::preferences_read,
            preferences::preferences_write,
            persistent::persistent_read,
            persistent::persistent_write,
            resource_crypto::decrypt_resource,
            resource_crypto::decrypt_story,
            resource_plain::resource_url,
            save::save_write,
            save::save_read,
            save::save_list,
            save::save_delete,
            shell::set_orientation,
            diagnostics::lfen_diag,
            host::host_platform
        ]);

    // 移动端供给：APK-ZIP 直读适配器（唯一通道，setup 期建条目索引）
    #[cfg(target_os = "android")]
    let builder = builder.plugin(resource_fs::apk_zip_fs_plugin());

    builder
        .setup(|app| {
            boot::setup(app.handle());
            // 开发期 WS 通道：debug 构建启动 127.0.0.1 监听（浏览器页面复用宿主能力）；
            // release 构建整段不参与编译（由 ws_dev 内的源级断言守护）
            #[cfg(debug_assertions)]
            ws_dev::setup(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
