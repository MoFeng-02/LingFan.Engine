//! 加密打包 CLI（「一键打包」的构建期核心；创作者工具，不随玩家包分发）：
//! 明文工程根 → 加密发布根。用法：
//! `lfenpack <工程根> <输出根> [--force] [--strict] [--dist <前端产物目录>]`
//!
//! 语义归 `pack_project` / `pack_project_with_dist`（resource_crypto.rs，单测覆盖）：
//! 清单明文转换（resourceEncryption=true）+ 内容文件全量 LFEN2（原路径+.enc）+
//! 排除 Saves/ 与点文件 + 新随机 DEK 写 `__key__.seed`（运行时首次导入即封装）+
//! 输出逐文件解密回读自检。`--force` = 输出目录已存在且非空时先清空（显式覆盖确认）。
//! `--dist` = 收录前端构建产物（`dist/` 逻辑路径前缀，html 除外 → 报告 skipped），
//! 收录非空时输出清单补 `frontend.assets` 映射段。
//! `--strict` = 打包照常完成，但报告含任何「未入包 / 明文例外」时以非零码退出
//! （严格模式：加密包例外面必须显式知情）。

use lingfanengine_lib::resource_crypto::{
    ensure_pack_paths_distinct, pack_project_with_dist, PackEntry,
};
use std::path::PathBuf;
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut force = false;
    let mut strict = false;
    let mut dist: Option<PathBuf> = None;
    let mut positional: Vec<&str> = Vec::new();
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--force" => force = true,
            "--strict" => strict = true,
            "--dist" => match iter.next() {
                Some(d) => dist = Some(PathBuf::from(d)),
                None => {
                    eprintln!("失败：--dist 需要一个目录参数");
                    return ExitCode::from(2);
                }
            },
            _ => positional.push(arg),
        }
    }
    let [input, output] = positional.as_slice() else {
        eprintln!("用法：lfenpack <工程根> <输出根> [--force] [--strict] [--dist <前端产物目录>]");
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
        // 🔴 清空前路径关系防护：output == input（或嵌套）时 remove_dir_all 会删光源工程
        if let Err(e) = ensure_pack_paths_distinct(&input, &output) {
            eprintln!("失败：{e}");
            return ExitCode::from(2);
        }
        if let Err(e) = std::fs::remove_dir_all(&output) {
            eprintln!("失败：--force 清空输出目录失败：{e}");
            return ExitCode::from(1);
        }
    }
    match pack_project_with_dist(&input, &output, dist.as_deref()) {
        Ok(report) => {
            println!(
                "打包完成：{} 个内容文件 → {}（清单 resourceEncryption=true，DEK seed 随包）",
                report.files,
                output.display()
            );
            let list = |title: &str, items: &[PackEntry]| {
                if items.is_empty() {
                    return;
                }
                println!("{title}（{}）：", items.len());
                for e in items {
                    println!("  {} — {}", e.path, e.reason);
                }
            };
            if !report.encrypted.is_empty() {
                println!(
                    "已加密（{}）：{}",
                    report.encrypted.len(),
                    report.encrypted.join("、")
                );
            }
            list("明文（有因）", &report.plaintext);
            list("排除", &report.excluded);
            list("未入包", &report.skipped);
            if strict && report.has_exceptions() {
                eprintln!(
                    "--strict：存在例外（未入包 {} 项），按例外清单口径判非零退出",
                    report.skipped.len()
                );
                return ExitCode::FAILURE;
            }
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("打包失败：{e}");
            ExitCode::from(1)
        }
    }
}
