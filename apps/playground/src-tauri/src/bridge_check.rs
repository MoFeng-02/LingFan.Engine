//! invoke↔Rust 跨边界互锁测试（仅测试编译）：Tauri 的命令名/参数键/负载键都是
//! 运行时字符串——编译期失配不可见，TS 契约替身与 Rust 纯函数各测一半时会缺整条链。
//! 本模块读 TS 适配器源（`packages/adapters/src/**`）与本 crate 注册面
//! （lib.rs / 命令签名 / serde 负载），把两半缝成整链：
//! 1. TS invoke 的每个命令必须已注册（防调了未注册命令——运行时才炸的真缺陷）
//! 2. 注册清单每个命令必须真有 `pub fn` 定义（防注册面漂移）
//! 3. 有参命令：TS invoke args 键（camelCase）必须覆盖 Rust 签名参数（snake_case；
//!    Tauri 2 自动转换，参数名含下划线时两侧书写即分叉——互锁点）
//! 4. 负载形状：Rust serde 输出键必须与 TS 期待接口键一致（SlotSummary 契约——
//!    save_count/slot/timestamp/mode 曾是无测试的隐性契约）
//! 5. Android JNI 字符串契约：方法名 / 方法签名 / `ActivityInfo` 常量 / 三态字面量——
//!    JNI 调用编译期完全不校验，方法名拼错只在真机静默失败；本测试兼守「自维护 Kotlin
//!    插件不得回流」（历史形态是 Rust 契约 + Kotlin 实现成对演进，两侧失配无编译期信号）
//! 6. iOS Swift 自注册插件字符串契约（C 入口符号 / 命令名 / 参数键 / 模式字面量）——
//!    Swift 在本机（Windows）不可编译，源断言是当前唯一可自动化的防线
//!
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

    /// 规则 ①检测核心：TS invoke 全集 − 注册面 = 未注册命令（提取与比对汇聚在此，
    /// 红路径由合成输入测试直接验证，真实源面由 ts_invoke_commands_are_registered 常绿把守）
    fn unregistered_ts_commands(
        ts_texts: &[String],
        lib_text: &str,
    ) -> (BTreeSet<String>, Vec<String>) {
        let registered = registered_commands(lib_text);
        let mut used = BTreeSet::new();
        for text in ts_texts {
            used.extend(ts_invoke_commands(text));
        }
        let unregistered: Vec<_> = used.difference(&registered).cloned().collect();
        (used, unregistered)
    }

    /// 规则 ②检测核心：注册面 −（含 `pub fn` 真身的源码）= 缺真身命令
    fn missing_command_bodies(rust_text: &str, lib_text: &str) -> Vec<String> {
        registered_commands(lib_text)
            .into_iter()
            .filter(|cmd| !rust_text.contains(&format!("pub fn {cmd}(")))
            .collect()
    }

    #[test]
    fn ts_invoke_commands_are_registered() {
        // TS 调了未注册命令 = 运行时才炸的真缺陷
        let ts_texts: Vec<String> = adapters_ts_sources().into_iter().map(|(_, t)| t).collect();
        let lib_text = lib_rs_text();
        let (used, unregistered) = unregistered_ts_commands(&ts_texts, &lib_text);
        assert!(
            used.len() >= 8,
            "invoke 提取疑似失效（唯一命令 {used:?}）——正则或适配器形态变更需同步本测试"
        );
        assert!(
            unregistered.is_empty(),
            "TS invoke 了未注册命令：{unregistered:?}"
        );
    }

    #[test]
    fn registered_commands_exist_in_rust_sources() {
        // 注册面每项都有真身（防 generate_handler 漂移到已删/改名命令）
        let sources = rust_sources_text();
        let missing = missing_command_bodies(&sources, &lib_rs_text());
        assert!(missing.is_empty(), "注册命令缺 pub fn 定义：{missing:?}");
    }

    #[test]
    fn ts_invoke_args_match_rust_params() {
        // 有参命令的 TS args 键覆盖 Rust 签名参数（camel↔snake）
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
    fn rust_payload_keys_match_ts_expectations() {
        // serde 输出键必须与 TS 期待接口键一致
        // （SlotSummary：Rust save_count ↔ TS 显式映射 saveCount 的隐性契约，已锁定）
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

    #[test]
    fn bridge_check_catches_unregistered_and_bodyless() {
        // 锚点 bridge-check-new-command：互锁检测逻辑自身的红路径（合成输入）——
        // 「新增命令漏注册」「注册缺真身」必被逮住；真实源面的常绿由上方两测试把守
        let ts = r#"const x = await invoke<string>("ghost_cmd");
const y = await invoke("real_cmd", { foo: 1 });"#;
        let lib = r#"
        .invoke_handler(tauri::generate_handler![
            real_cmd,
            other_cmd,
        ])
"#;
        // 规则 ①：TS 调用面含 ghost_cmd，注册面没有 → 未注册差集精确命中
        let (used, unregistered) = unregistered_ts_commands(&[ts.to_string()], lib);
        assert!(used.contains("ghost_cmd") && used.contains("real_cmd"));
        assert_eq!(unregistered, vec!["ghost_cmd".to_string()]);
        // 规则 ②：other_cmd 已注册但源码无 pub fn 真身 → 缺真身差集精确命中
        let rust = "pub fn real_cmd() {}";
        let missing = missing_command_bodies(rust, lib);
        assert_eq!(missing, vec!["other_cmd".to_string()]);
    }

    fn rust_source(file: &str) -> String {
        fs::read_to_string(crate_dir().join("src").join(file))
            .unwrap_or_else(|e| panic!("读 {file}：{e}"))
    }

    /// Android 自维护 Kotlin 插件已退役（供给收进 APK-ZIP 直读，方向收进 JNI 直调），
    /// 本测试锁住「不再回流」并固定 JNI 字符串面。
    ///
    /// 为什么仍需测试：JNI 调用是**纯字符串契约**（类方法名 `setRequestedOrientation`、
    /// 签名 `(I)V`、`ActivityInfo` 常量），编译期完全不校验——方法名拼错只在真机静默失败。
    /// 这些字面量在桌面门禁下也只能靠源断言（Android cfg 分支桌面编译不到）。
    #[test]
    fn android_jni_string_contracts_match_platform_api() {
        let shell_rs = rust_source("shell.rs");
        let fs_rs = rust_source("resource_fs.rs");
        let lib_rs = lib_rs_text();

        // ① 自维护 Kotlin 插件不得回流（历史包路径：assets / shell）
        for legacy in ["com/langfeng/lingfanengine/assets", "com/langfeng/lingfanengine/shell"] {
            let dir = crate_dir().join("gen/android/app/src/main/java").join(legacy);
            assert!(
                !dir.exists(),
                "自维护 Kotlin 插件目录不应存在：{}（供给与方向已收进 Rust）",
                dir.display()
            );
        }
        assert!(
            !fs_rs.contains(concat!("register_", "android_plugin")),
            "resource_fs 不应再注册自维护 Android 插件"
        );

        // ② JNI 调用面字面量（方法名 / 签名 / 常量）——与 Android 平台 API 对齐
        assert!(
            shell_rs.contains("\"setRequestedOrientation\""),
            "方向 JNI 方法名缺失或漂移（须为 Activity.setRequestedOrientation）"
        );
        assert!(
            shell_rs.contains("\"(I)V\""),
            "方向 JNI 方法签名缺失或漂移（须为接收单个 int 的 void 方法）"
        );
        // 常量映射：UNSPECIFIED(-1) / PORTRAIT(1) / LANDSCAPE(0)
        for (mode, constant) in [("Auto", -1), ("Portrait", 1), ("Landscape", 0)] {
            assert!(
                shell_rs.contains(&format!("OrientationMode::{mode} => {constant}")),
                "方向常量映射漂移：{mode} 应为 {constant}"
            );
        }
        // 三态字面量（TS 契约面）
        for mode in ["auto", "portrait", "landscape"] {
            assert!(
                shell_rs.contains(&format!("\"{mode}\"")),
                "Rust 缺方向模式 {mode}"
            );
        }

        // ③ Android 侧不再有 Kotlin 插件注册，且 apkzip 插件是唯一供给装配点
        assert!(
            !lib_rs.contains("asset_list_plugin"),
            "lib.rs 不应再装配 Kotlin asset 插件"
        );
        assert!(
            !lib_rs.contains("shell::android_plugin"),
            "lib.rs 不应再装配 Kotlin shell 插件"
        );
        assert!(
            lib_rs.contains("apk_zip_fs_plugin"),
            "lib.rs 必须装配 APK-ZIP 供给插件"
        );
    }

    #[test]
    fn swift_plugin_string_contracts_match_rust() {
        // iOS 侧与 Rust 同样是纯字符串契约
        // （C 入口符号 = ios_plugin_binding! 的 ident / 命令名 = @objc 方法名 / 参数键 / 模式字面量）。
        // Swift 无法在本机（Windows）编译，本测试是当前唯一可自动化的防线：符号与字面量漂移即刻暴露。
        // 源落点：src-tauri/ios/（Swift 包：build.rs 经 link_apple_library 于 cargo 构建期编译链接；
        // 不能放进 Xcode 工程 Sources——Rust 先于 app target 的 Swift 链接，符号会未定义）
        let swift = fs::read_to_string(crate_dir().join("ios/Sources/ShellPlugin.swift"))
            .expect("读 ios/Sources/ShellPlugin.swift");
        let package = fs::read_to_string(crate_dir().join("ios/Package.swift"))
            .expect("读 ios/Package.swift");
        let build_rs = fs::read_to_string(crate_dir().join("build.rs")).expect("读 build.rs");
        let shell_rs = rust_source("shell.rs");

        // Swift 包名：Package.swift 的 package/product 名 == build.rs 传给 link_apple_library 的名字
        assert!(
            package.contains("name: \"lfen-shell\""),
            "Package.swift 包名漂移（须与 build.rs 的 PACKAGE 常量一致）"
        );
        assert!(
            build_rs.contains("const PACKAGE: &str = \"lfen-shell\""),
            "build.rs 的 Swift 包名与 Package.swift 失配"
        );
        assert!(
            build_rs.contains("link_apple_library"),
            "build.rs 缺 link_apple_library（iOS 链接期符号将未定义）"
        );

        // C 入口符号：Swift @_cdecl 名 == Rust ios_plugin_binding! 的 ident
        assert!(
            swift.contains("@_cdecl(\"init_plugin_shell\")"),
            "Swift 缺 @_cdecl(\"init_plugin_shell\") 入口"
        );
        assert!(
            shell_rs.contains("ios_plugin_binding!(init_plugin_shell)"),
            "Rust ios_plugin_binding! 符号与 Swift @_cdecl 失配"
        );

        // 命令名 == Swift @objc 方法名；参数键 == Decodable 字段名
        assert!(
            swift.contains("func setOrientation(_ invoke: Invoke)"),
            "Swift 缺 setOrientation 命令"
        );
        assert!(
            shell_rs.contains("\"setOrientation\""),
            "Rust 调用的命令名与 Swift 失配"
        );
        assert!(swift.contains("let mode: String"), "Swift 缺 mode 参数");
        assert!(shell_rs.contains("\"mode\""), "Rust 负载键 mode 缺失");

        // 方向模式字面量三态一致
        for mode in ["auto", "portrait", "landscape"] {
            assert!(
                swift.contains(&format!("\"{mode}\"")),
                "Swift 缺方向模式 {mode}"
            );
            assert!(
                shell_rs.contains(&format!("\"{mode}\"")),
                "Rust 缺方向模式 {mode}"
            );
        }

        // 响应键（Rust 侧只判成功，不解字段）——锁定 Swift 侧回报形态，避免静默改协议
        assert!(
            swift.contains("\"applied\""),
            "Swift 回报缺 applied 键（Rust/TS 契约面）"
        );
    }
}
