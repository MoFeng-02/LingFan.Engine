//! ⑦ invoke↔Rust 跨边界互锁测试（仅测试编译）：Tauri 的命令名/参数键/负载键都是
//! 运行时字符串——编译期失配不可见，此前「TS 契约替身各测一半 + Rust 纯函数各测一半」
//! 缺整链。本模块读 TS 适配器源（`packages/adapters/src/**`）与本 crate 注册面
//! （lib.rs / 命令签名 / serde 负载），把两半缝成整链：
//! 1. TS invoke 的每个命令必须已注册（防调了未注册命令——运行时才炸的真缺陷）
//! 2. 注册清单每个命令必须真有 `pub fn` 定义（防注册面漂移）
//! 3. 有参命令：TS invoke args 键（camelCase）必须覆盖 Rust 签名参数（snake_case；
//!    Tauri 2 自动转换，参数名含下划线时两侧书写即分叉——互锁点）
//! 4. 负载形状：Rust serde 输出键必须与 TS 期待接口键一致（SlotSummary 锚点——
//!    save_count/slot/timestamp/mode 曾是无测试的隐性契约）
//! 5. Kotlin 自注册插件字符串契约（gen/android 平台适配层）：插件标识（= Kotlin 包名）/
//!    命令名（= @Command 方法名）/参数与响应键/方向模式字面量——Rust ↔ Kotlin 之间同样是
//!    编译期不可见的字符串契约，失配只在真机运行时炸
//! TS 侧编组行为已由契约替身测试覆盖（tests/adapters/**），本模块只补跨边界字符串契约；
//! 局限注明：invoke 泛型提取不支持嵌套尖括号（当前代码库无此形态）。

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;
    use std::fs;
    use std::path::PathBuf;

    fn crate_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    }

    /// 递归收集 adapters 包 TS 源文本（跳过测试文件——替身 invoke 不算调用面）
    fn adapters_ts_sources() -> Vec<(String, String)> {
        let root = crate_dir().join("../../../packages/adapters/src");
        let mut out = Vec::new();
        collect_ts(&root, &mut out);
        out.sort();
        out
    }

    fn collect_ts(dir: &std::path::Path, out: &mut Vec<(String, String)>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return; // 目录缺失 = 环境异常，由后续断言显式失败
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_ts(&path, out);
                continue;
            }
            let is_ts = path.extension().and_then(|e| e.to_str()) == Some("ts");
            let is_test = path.to_string_lossy().contains(".test.");
            if is_ts && !is_test {
                if let Ok(text) = fs::read_to_string(&path) {
                    out.push((path.to_string_lossy().into_owned(), text));
                }
            }
        }
    }

    fn lib_rs_text() -> String {
        fs::read_to_string(crate_dir().join("src/lib.rs")).expect("读 lib.rs")
    }

    /// src/*.rs 全文拼接（命令签名检索；bridge_check.rs 自身无命令定义）
    fn rust_sources_text() -> String {
        let dir = crate_dir().join("src");
        let mut out = String::new();
        for entry in fs::read_dir(&dir).expect("读 src").flatten() {
            let path = entry.path();
            let is_rs = path.extension().and_then(|e| e.to_str()) == Some("rs");
            if is_rs {
                if let Ok(text) = fs::read_to_string(&path) {
                    out.push_str(&text);
                    out.push('\n');
                }
            }
        }
        out
    }

    /// 提取 TS `invoke<...>("cmd")` / `invoke("cmd")` 的命令名（泛型不含嵌套尖括号）
    fn ts_invoke_commands(ts_text: &str) -> BTreeSet<String> {
        let mut found = BTreeSet::new();
        let mut rest = ts_text;
        while let Some(pos) = rest.find("invoke") {
            rest = &rest[pos + "invoke".len()..];
            let after_generic = if rest.starts_with('<') {
                match rest.find('>') {
                    Some(end) => &rest[end + 1..],
                    None => continue,
                }
            } else {
                rest
            };
            let after_paren = after_generic.trim_start();
            if !after_paren.starts_with('(') {
                continue; // `invoke:` 参数默认值等非调用形态
            }
            let head = after_paren[1..].trim_start();
            if let Some(name) = head.strip_prefix('"') {
                if let Some(end) = name.find('"') {
                    found.insert(name[..end].to_string());
                }
            }
        }
        found
    }

    /// lib.rs generate_handler! 注册清单 → fn 名集合（`module::fn` 取尾段）
    fn registered_commands(lib_text: &str) -> BTreeSet<String> {
        let start = lib_text
            .find("generate_handler!")
            .expect("lib.rs 缺 generate_handler");
        let body = &lib_text[start..];
        let end = body.find(']').expect("generate_handler 列表未闭合");
        body[..end]
            .split_whitespace()
            .filter_map(|token| {
                token
                    .trim_matches(|c| c == ',' || c == '"')
                    .rsplit("::")
                    .next()
                    .map(str::to_string)
            })
            .filter(|name| {
                !name.is_empty()
                    && name
                        .chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
            })
            .collect()
    }

    /// Rust 命令签名参数名（跳过 app: AppHandle）
    fn command_params(rust_text: &str, cmd: &str) -> Vec<String> {
        let needle = format!("pub fn {cmd}(");
        let Some(start) = rust_text.find(&needle) else {
            return Vec::new();
        };
        let after = &rust_text[start + needle.len()..];
        let end = after.find(')').unwrap_or(0);
        after[..end]
            .split(',')
            .filter_map(|part| {
                let name = part.split(':').next()?.trim();
                (!name.is_empty() && name != "app").then(|| name.to_string())
            })
            .collect()
    }

    /// snake_case → camelCase（Tauri 2 参数名自动转换的 TS 侧书写形）
    fn to_camel(s: &str) -> String {
        let mut out = String::new();
        let mut upper_next = false;
        for c in s.chars() {
            if c == '_' {
                upper_next = true;
            } else if upper_next {
                out.extend(c.to_uppercase());
                upper_next = false;
            } else {
                out.push(c);
            }
        }
        out
    }

    /// TS 源中命令字面量起的能力窗口（参数对象就在其后近邻）
    fn ts_call_window(ts_text: &str, cmd: &str, span_chars: usize) -> String {
        let needle = format!("\"{cmd}\"");
        match ts_text.find(&needle) {
            Some(pos) => ts_text[pos..].chars().take(span_chars).collect(),
            None => String::new(),
        }
    }

    #[test]
    fn ts_invoke_commands_are_registered() {
        // 锚点: bridge-ts-invoke-registered——TS 调了未注册命令 = 运行时才炸的真缺陷
        let registered = registered_commands(&lib_rs_text());
        let mut used = BTreeSet::new();
        for (_, text) in adapters_ts_sources() {
            used.extend(ts_invoke_commands(&text));
        }
        assert!(
            used.len() >= 8,
            "invoke 提取疑似失效（唯一命令 {used:?}）——正则或适配器形态变更需同步本测试"
        );
        let unregistered: Vec<_> = used.difference(&registered).collect();
        assert!(
            unregistered.is_empty(),
            "TS invoke 了未注册命令：{unregistered:?}（注册面 {registered:?}）"
        );
    }

    #[test]
    fn registered_commands_exist_in_rust_sources() {
        // 注册面每项都有真身（防 generate_handler 漂移到已删/改名命令）
        let sources = rust_sources_text();
        for cmd in registered_commands(&lib_rs_text()) {
            assert!(
                sources.contains(&format!("pub fn {cmd}(")),
                "注册命令 {cmd} 缺 pub fn 定义"
            );
        }
    }

    #[test]
    fn ts_invoke_args_match_rust_params() {
        // 锚点: bridge-args-interlock——有参命令的 TS args 键覆盖 Rust 签名参数（camel↔snake）
        let sources = rust_sources_text();
        let mut checked = 0usize;
        for (path, text) in adapters_ts_sources() {
            for cmd in ts_invoke_commands(&text) {
                let params = command_params(&sources, &cmd);
                if params.is_empty() {
                    continue; // 无参命令（或签名缺失由上一测试捕获）
                }
                let window = ts_call_window(&text, &cmd, 300);
                assert!(!window.is_empty(), "命令 {cmd} 的 TS 调用未定位（{path}）");
                for param in params {
                    let camel = to_camel(&param);
                    assert!(
                        window.contains(&camel),
                        "命令 {cmd} 的 TS 调用缺参数键 `{camel}`（Rust 参数 {param}；{path}）"
                    );
                    checked += 1;
                }
            }
        }
        assert!(
            checked >= 6,
            "参数互锁覆盖疑似失效（校验 {checked} 个参数）——适配器形态变更需同步本测试"
        );
    }

    #[test]
    fn rust_payload_keys_match_ts_expectations() {        // 锚点: bridge-payload-keys——serde 输出键必须与 TS 期待接口键一致
        // （SlotSummary：Rust save_count ↔ TS 显式映射 saveCount 的隐性契约，本轮起锁定）
        use crate::save::SlotSummary;
        let value = serde_json::to_value(SlotSummary {
            slot: "s".into(),
            save_count: 1,
            timestamp: 0,
            mode: "machine-bound".into(),
        })
        .expect("SlotSummary 序列化");
        let rust_keys: BTreeSet<String> = value
            .as_object()
            .expect("序列化为对象")
            .keys()
            .cloned()
            .collect();

        let ts_path = crate_dir().join("../../../packages/adapters/src/save/tauri.ts");
        let ts_text = fs::read_to_string(&ts_path).expect("读 save/tauri.ts");
        let start = ts_text
            .find("interface RustSlotSummary")
            .expect("TS 侧 RustSlotSummary 接口缺失");
        let block = &ts_text[start..];
        let block = &block[..block.find('}').expect("接口块未闭合")];
        let ts_keys: BTreeSet<String> = block
            .lines()
            .filter_map(|line| line.trim().split(':').next())
            .filter(|key| !key.is_empty() && *key != "interface" && !key.contains(' '))
            .map(str::to_string)
            .collect();

        assert!(
            !ts_keys.is_empty(),
            "RustSlotSummary 键提取疑似失效——接口形态变更需同步本测试"
        );
        assert_eq!(
            rust_keys, ts_keys,
            "Rust serde 负载键与 TS 期待键失配（跨边界运行时才炸）"
        );
    }

    /// 自注册 Kotlin 插件源（gen/android 平台适配层）
    fn kotlin_plugin_source(pkg: &str, file: &str) -> String {
        let path = crate_dir()
            .join("gen/android/app/src/main/java/com/langfeng/lingfanengine")
            .join(pkg)
            .join(file);
        fs::read_to_string(&path).unwrap_or_else(|e| panic!("读 Kotlin 插件源 {pkg}/{file}：{e}"))
    }

    fn rust_source(file: &str) -> String {
        fs::read_to_string(crate_dir().join("src").join(file))
            .unwrap_or_else(|e| panic!("读 {file}：{e}"))
    }

    #[test]
    fn kotlin_plugin_string_contracts_match_rust() {
        // 锚点: bridge-kotlin-plugin-interlock——自注册 Kotlin 插件与 Rust 之间同样是纯字符串
        // 契约（插件标识 = Kotlin 包名 / 命令名 = @Command 方法名 / 参数与响应键 / 模式字面量），
        // 编译期不可见：此前无任何互锁，失配只在真机运行时炸。
        let shell_kt = kotlin_plugin_source("shell", "ShellPlugin.kt");
        let shell_rs = rust_source("shell.rs");
        let assets_kt = kotlin_plugin_source("assets", "AssetListPlugin.kt");
        let fs_rs = rust_source("resource_fs.rs");

        // 插件标识必须等于 Kotlin 包名（register_android_plugin 内 replace('.', '/') 拼类路径）
        assert!(
            shell_kt.contains("package com.langfeng.lingfanengine.shell"),
            "ShellPlugin.kt 包名漂移"
        );
        assert!(
            shell_rs.contains("\"com.langfeng.lingfanengine.shell\""),
            "Rust 注册的 shell 插件标识与 Kotlin 包名失配（运行时找不到类）"
        );
        assert!(
            assets_kt.contains("package com.langfeng.lingfanengine.assets"),
            "AssetListPlugin.kt 包名漂移"
        );
        assert!(
            fs_rs.contains("\"com.langfeng.lingfanengine.assets\""),
            "Rust 注册的 asset 插件标识与 Kotlin 包名失配"
        );

        // 命令名 == Kotlin @Command 方法名；参数键 == @InvokeArg 字段名
        assert!(shell_kt.contains("fun setOrientation("), "Kotlin 缺 setOrientation 命令");
        assert!(
            shell_rs.contains("\"setOrientation\""),
            "Rust 调用的命令名与 Kotlin 失配"
        );
        assert!(shell_kt.contains("mode: String"), "Kotlin 缺 mode 参数");
        assert!(shell_rs.contains("\"mode\""), "Rust 负载键 mode 缺失");
        assert!(assets_kt.contains("fun list("), "Kotlin 缺 list 命令");
        assert!(fs_rs.contains("\"list\""), "Rust 调用的枚举命令名失配");
        assert!(assets_kt.contains("path: String"), "Kotlin 缺 path 参数");
        assert!(fs_rs.contains("\"path\""), "Rust 枚举负载键 path 缺失");

        // 方向模式字面量：Rust OrientationMode 三态 == Kotlin when 分支
        for mode in ["auto", "portrait", "landscape"] {
            assert!(
                shell_kt.contains(&format!("\"{mode}\"")),
                "Kotlin 缺方向模式 {mode}"
            );
            assert!(
                shell_rs.contains(&format!("\"{mode}\"")),
                "Rust 缺方向模式 {mode}"
            );
        }

        // 响应键：Kotlin JSObject 键 == Rust serde 结构体字段
        for key in ["entries", "dir", "path"] {
            assert!(
                assets_kt.contains(&format!("\"{key}\"")),
                "Kotlin 响应缺键 {key}"
            );
        }
        assert!(
            fs_rs.contains("entries: Vec<AssetListEntry>"),
            "Rust 响应结构缺 entries"
        );
        assert!(fs_rs.contains("pub dir: bool"), "Rust 响应结构缺 dir");
        assert!(
            fs_rs.contains("pub path: String"),
            "Rust 响应结构缺 path"
        );
    }
}
