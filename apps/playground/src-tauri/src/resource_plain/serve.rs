//! 明文资源段的响应：资源根定位、存在性判定与 Range 响应。

use crate::http::bad_request;
use crate::http::not_found;
use crate::http::with_cors;
use crate::paths::resource_root;
use crate::resource_crypto::stream_range_response;
use crate::resource_fs::ResourceFs;
use crate::resource_plain::route::route;
use crate::resource_plain::route::Route;
use std::path::Path;

/// 明文资源段的协议响应：资源根与文件系统适配器都从宿主现取，不在此另造定位逻辑。
///
/// 资源根取 `paths::resource_root`（与故事供给、加密供给同一事实源）——壳形态下它指向
/// 应用包内的 `Resources/`，正是 `bundle.resources` 落地的目录。
pub(crate) fn serve(
    request: tauri::http::Request<Vec<u8>>,
    app: &tauri::AppHandle,
) -> tauri::http::Response<Vec<u8>> {
    let Ok(root) = resource_root(app) else {
        return not_found();
    };
    let resfs = crate::resource_fs::resource_fs(app);
    serve_with(&*resfs, &root, request)
}

/// 与宿主句柄解耦的响应核心（单测可直接给临时目录）：路由 → 存在性 → Range 响应。
///
/// 存在性判定走 `ResourceFs` 而非 `std::fs`：Android 的资源根在安装包内，只有适配器知道
/// 怎么回答「这个文件在不在」。响应字节仍由 `stream_range_response` 统一给出（200 / 206 /
/// 416 / 404 与 MIME 只有一处实现）。
pub(crate) fn serve_with(
    resfs: &dyn ResourceFs,
    root: &Path,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let method = request.method().as_str().to_string();
    let target = request.uri().path().to_string();
    let response = match route(&method, &target) {
        Route::Serve(logical) => {
            let file = root.join(&logical);
            if !resfs.is_file(&file) {
                not_found()
            } else {
                let range = request
                    .headers()
                    .get("range")
                    .and_then(|value| value.to_str().ok());
                stream_range_response(&file, range)
            }
        }
        Route::BadRequest => bad_request(),
        Route::NotFound => not_found(),
    };
    with_cors(response)
}
