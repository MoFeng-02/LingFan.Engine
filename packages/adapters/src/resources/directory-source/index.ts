/**
 * 编辑器工程供给（浏览器形态）域出口：**目录取径**两类——File System Access 真目录句柄
 * （Chromium：可枚举、可读、可写）与目录 input 的只读文件快照
 * （`<input webkitdirectory>`，全浏览器兜底）。两类共用同一组端口实现，
 * **`ProjectFilesPort` / `ResourcePort` 契约零改动**。
 *
 * 逻辑路径一律相对**资源根**（含 `project.json` 的那一层）——与 fetch / Tauri 两种
 * 供给实现的键完全一致（组装器是唯一解析点，这里只负责「取」）。
 * 枚举口径照 Rust `collect_story_files`：`Stories/**` 递归、跳过点文件名、不设扩展名白名单。
 * **唯一有意差异 = 加密形态**：加密文件需密钥解密（安全边界在 Rust）→ 浏览器形态
 * 显式 fail-closed，不猜、不跳过；形态判定**唯一落在 `encryptedProject` 模块**（前置、
 * 统一文案）——将来编辑器桌面壳落地时只换判定点之后的供给，规则不重写。
 *
 * 资源供给 = 文件对象 → 短生命周期 Blob URL（Blob URL 用后 revoke），
 * `release` 即 revoke——与加密适配器同一契约形态（静态根与加密形态各自空实现/归 Rust）。
 *
 * **写回**：仅 FSA 取径可写（`createHandleProjectWriter`）——打开时仍只申请 `read`，
 * 保存时（按钮点击 = 真实用户手势）才申请 `readwrite`；目录 input 快照无写权限，宿主据
 * `writable` 禁用保存。写回顺序固定「先写后删」，永不先删后写。
 */
export { pickProjectDirectory, supportsDirectoryPicker } from "./picker";
export {
  createFileListFileSource,
  createHandleFileSource,
} from "./file-source";
export { locateResourceRootFromPaths } from "./root-locate";
export { createSourceProjectFilesPort } from "./project-files";
export { createSourceResourcePort, type BlobUrlOptions } from "./resource-port";
export { langOfOverlayPath, loadDiagnosticSupply } from "./diagnostics";
export { createLastProjectStore } from "./last-project";
export { createHandleProjectWriter, ensureReadAccess } from "./writer";
/**
 * 这三个供给契约定义在引擎里（编辑器与适配器共用同一份）：这里只转发名字，
 * 让既有取用点（资源域出口与包出口）继续可用。
 */
export type {
  DiagnosticSupply,
  LastProjectHandleStore,
  ProjectFileSource,
} from "@lingfan/engine";
