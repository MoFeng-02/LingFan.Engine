//! ⑨-4b 加密打包 CLI（06 §一.5「一键打包」的构建期核心；创作者工具，不随玩家包分发）：
//! 明文工程根 → 加密发布根。用法：`lfenpack <工程根> <输出根> [--force]`
//!
//! 语义归 `pack_project`（resource_crypto.rs，单测覆盖）：
//! 清单明文转换（resourceEncryption=true）+ 内容文件全量 LFEN2（原路径+.enc）+
//! 排除 Saves/ 与点文件 + 新随机 DEK 写 `__key__.seed`（运行时首次导入即封装）+
//! 输出逐文件解密回读自检。`--force` = 输出目录已存在且非空时先清空（显式覆盖确认）。

use lingfanengine_lib::resource_crypto::pack_project;
use std::path::PathBuf;
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut force = false;
    let mut positional: Vec<&str> = Vec::new();
    for arg in &args {
        if arg == "--force" {
            force = true;
        } else {
            positional.push(arg);
        }
    }
    let [input, output] = positional.as_slice() else {
        eprintln!("用法：lfenpack <工程根> <输出根> [--force]");
        return ExitCode::from(2);
    };
    let input = PathBuf::from(input);
    let output = PathBuf::from(output);
    if !input.join("project.json").is_file() {
        eprintln!(
            "失败：{} 缺 project.json（打包输入必须是工程资源根）",
            input.display()
        );
        return ExitCode::from(2);
    }
    if force && output.exists() {
        if let Err(e) = std::fs::remove_dir_all(&output) {
            eprintln!("失败：--force 清空输出目录失败：{e}");
            return ExitCode::from(1);
        }
    }
    match pack_project(&input, &output) {
        Ok(report) => {
            println!(
                "打包完成：{} 个内容文件 → {}（清单 resourceEncryption=true，DEK seed 随包）",
                report.files,
                output.display()
            );
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("打包失败：{e}");
            ExitCode::from(1)
        }
    }
}
