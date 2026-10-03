package com.langfeng.lingfanengine

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // 本类**不得**再初始化 ndk-context：运行时（tao 的 `onCreate`，即
    // `ANativeActivity_onCreate` 路径，含于上面的 super.onCreate 内）已调用
    // `ndk_context::initialize_android_context`；android-native-keyring-store 的 JNI
    // 入口会做同一件事，而 ndk-context 对它只有硬断言 `assert!(previous.is_none())`
    // ⇒ 二次初始化 = SIGABRT（实测：应用启动即崩于 ndk-context lib.rs:87）。
    // 该 crate 直接复用运行时设好的上下文，无需本类代劳。
  }
}
