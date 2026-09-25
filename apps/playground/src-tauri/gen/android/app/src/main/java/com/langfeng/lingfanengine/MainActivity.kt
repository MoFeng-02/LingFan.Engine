package com.langfeng.lingfanengine

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import io.crates.keyring.Keyring

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // K1 凭据（KEK）依赖 android-native-keyring-store 的 ndk-context：须在任何存档/加密读取之前初始化，
    // 否则该 crate 内部 `ndk_context::android_context()` 会 panic（实测：点「存」即 SIGABRT，线程 JavaBridge）。
    // 置于 super.onCreate 之后：此时 Tauri 已加载 liblingfanengine_lib.so，crate 的 JNI 符号在其中。
    Keyring.initializeNdkContext(applicationContext)
  }
}
