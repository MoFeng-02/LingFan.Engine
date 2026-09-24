package com.langfeng.lingfanengine.shell

import android.app.Activity
import android.content.pm.ActivityInfo
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class SetOrientationArgs {
    lateinit var mode: String
}

/**
 * 屏幕方向插件（Rust `shell::set_orientation` 的原生落点）。
 * 三态与 TS `OrientationMode` 一致：auto = 交给系统（UNSPECIFIED，跟随用户自动旋转设置）。
 * 注意：Android 16 起 sw≥600dp 大屏忽略方向限制，工程以 android:appCategory="game" 取豁免。
 */
@TauriPlugin
class ShellPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun setOrientation(invoke: Invoke) {
        val args = invoke.parseArgs(SetOrientationArgs::class.java)
        val orientation = when (args.mode) {
            "auto" -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            "portrait" -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            "landscape" -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            else -> {
                invoke.reject("不支持的屏幕方向模式：${args.mode}")
                return
            }
        }
        activity.requestedOrientation = orientation
        invoke.resolve(JSObject())
    }
}
