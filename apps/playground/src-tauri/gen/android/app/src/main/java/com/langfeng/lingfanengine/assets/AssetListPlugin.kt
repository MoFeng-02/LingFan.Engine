package com.langfeng.lingfanengine.assets

import android.app.Activity
import android.content.res.AssetManager.ACCESS_BUFFER
import android.os.ParcelFileDescriptor
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import org.json.JSONArray

@InvokeArg
class ListArgs {
    lateinit var path: String
}

@InvokeArg
class OpenArgs {
    lateinit var path: String
}

/**
 * APK asset 枚举 + 打开插件（Rust 侧 ResourceFs::AssetFs 的 asset 原语）。
 * 官方 fs 插件 Android 侧只有 getFileDescriptor、无枚举能力，且其实现丢弃资产区间
 * （见 {@link open}），故自注册此极简插件，两原语同源。
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
     * 打开 asset，回传「fd + 资产在该 fd 中的区间」（`start` / `length`）。
     *
     * 未压缩 asset：`assets.openFd` 给的 fd 指向**整个 APK**，资产仅是其中一段，区间由
     * `AssetFileDescriptor.startOffset` / `length` 单独描述——两者必须一并回传，调用方
     * 才能把读取窗口钳在资产内；只回传 fd 会从 APK 起点读起，资源内容随即被误判为非法格式。
     * 压缩 asset：`openFd` 抛 IOException——回退为解压拷贝到 cacheDir 的真实文件（起点 0）。
     */
    @Command
    fun open(invoke: Invoke) {
        val args = invoke.parseArgs(OpenArgs::class.java)
        try {
            val res = JSObject()
            try {
                val afd = activity.assets.openFd(args.path)
                res.put("fd", afd.parcelFileDescriptor.detachFd())
                res.put("start", afd.startOffset)
                if (afd.length >= 0) {
                    res.put("length", afd.length)
                }
            } catch (e: IOException) {
                val cacheFile = File(activity.cacheDir, "_assets/${args.path}")
                cacheFile.parentFile?.mkdirs()
                copyAsset(args.path, cacheFile)
                val fd = ParcelFileDescriptor
                    .open(cacheFile, ParcelFileDescriptor.MODE_READ_ONLY)
                    .detachFd()
                res.put("fd", fd)
                res.put("start", 0L)
                res.put("length", cacheFile.length())
            }
            invoke.resolve(res)
        } catch (e: Exception) {
            invoke.reject(e.message ?: "asset open failed")
        }
    }

    @Throws(IOException::class)
    private fun copy(input: InputStream, output: OutputStream) {
        val buf = ByteArray(1024)
        var len: Int
        while ((input.read(buf).also { len = it }) > 0) {
            output.write(buf, 0, len)
        }
    }

    @Throws(IOException::class)
    private fun copyAsset(assetPath: String, cacheFile: File) {
        val input = activity.assets.open(assetPath, ACCESS_BUFFER)
        input.use { i ->
            val output = FileOutputStream(cacheFile, false)
            output.use { o -> copy(i, o) }
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
            val grandChildren = activity.assets.list(sub)
            val isDir = grandChildren != null && grandChildren.isNotEmpty()
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
