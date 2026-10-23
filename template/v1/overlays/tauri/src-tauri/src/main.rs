// 可执行入口：只做一件事——把控制权交给库里的 `run()`。
// 发布构建下隐藏 Windows 控制台窗口（`windows_subsystem`），调试构建保留它以便看日志。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    app_lib::run()
}
