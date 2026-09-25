package io.crates.keyring

import android.content.Context

/**
 * android-native-keyring-store 的 ndk-context 初始化入口（K1 的 KEK 凭据落地依赖它）。
 *
 * 该 crate 用 SharedPreferences + Android Keystore 存凭据，内部经 `ndk_context::android_context()`
 * 取 Android 上下文；**未初始化会 panic**（实测：点「存」→ SIGABRT，崩溃线程 JavaBridge，
 * 栈为 `std::panicking::panic_with_hook` → `rust_begin_unwind`）。
 *
 * 与该 crate README 的差异：README 面向「本 crate 单独编译成 .so」的场景，需要
 * `System.loadLibrary("android_native_keyring_store")`；本应用把该 crate 编进
 * `liblingfanengine_lib.so`（Tauri 启动时已加载），故**不需要** loadLibrary——
 * crate 导出的 JNI 符号
 * `Java_io_crates_keyring_Keyring_00024Companion_initializeNdkContext`
 * 会在已加载的库里被解析到。类名/包名/方法名必须与 crate 的导出符号严格一致（改则失效）。
 */
class Keyring {
    companion object {
        external fun initializeNdkContext(context: Context)
    }
}
