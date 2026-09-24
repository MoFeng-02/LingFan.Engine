package com.langfeng.lingfanengine.assets

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray

@InvokeArg
class ListArgs {
    lateinit var path: String
}

/**
 * APK asset 递归枚举插件（Rust 侧 ResourceFs::AssetFs 的枚举原语）。
 * 官方 fs 插件 Android 侧只有 getFileDescriptor、无枚举能力，故自注册此极简插件。
 */
@TauriPlugin
class AssetListPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun list(invoke: Invoke) {
        val args = invoke.parseArgs(ListArgs::class.java)
        try {
            val out = JSONArray()
            walk(args.path, out)
            val res = JSObject()
            res.put("entries", out)
            invoke.resolve(res)
        } catch (e: Exception) {
            invoke.reject(e.message ?: "asset list failed")
        }
    }

    /**
     * AssetManager.list 只给直接子项：递归下钻，输出子树全部条目（含目录）。
     * 判定规则：list(sub) 非空 = 目录；为空 = 文件（空目录与空文件同形，均无内容可枚举）。
     * path 为 asset 根相对路径（空串 = asset 根），返回条目路径同为根相对。
     */
    private fun walk(path: String, out: JSONArray) {
        val children = activity.assets.list(path) ?: return
        for (child in children) {
            val sub = if (path.isEmpty()) child else "$path/$child"
            val isDir = !(activity.assets.list(sub).isEmpty())
            if (isDir) {
                walk(sub, out)
            }
            val entry = JSObject()
            entry.put("path", sub)
            entry.put("dir", isDir)
            out.put(entry)
        }
    }
}
