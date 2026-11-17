/**
 * i18n 工具链 · 宿主键 → overlay 文件归属映射。
 *
 * 宿主面扫描出的键按**源路径规则**分流到建议文件（场景专属归专属文件，通用归兜底）：
 * - `src/host/panels/<name>.ts` ⇒ `host/panels/<name>.json`（面板专属，子目录镜像）；
 * - `src/host/` 其余 ⇒ `host/main.json`（宿主通用）；
 * - `src/**` 非 host 与无法判定 ⇒ `main.json`（全局兜底，与运行期合并语义同名）。
 *
 * 宿主文件统一带 `host/` 前缀：故事面文件名由故事名派生、宿主文件名由路径派生，
 * 不加前缀撞名概率不低。归属只是**建议**——最终落位由 core 的 planOverlayMerge
 * 统一决定，且必须服从所选布局（三布局同一键集合、只换文件组织）。
 *
 * 纯函数：输入 = 工程内相对路径字符串（`/` 或 `\` 分隔均可），不读盘。
 */

/** 宿主面 overlay 目录前缀（防与故事面文件撞名） */
export const HOST_OVERLAY_DIR = "host";

/** 全局兜底文件名（与运行期 overlay 合并的兜底层同名） */
export const MAIN_OVERLAY_FILE = "main.json";

/**
 * 源路径 → 建议 overlay 文件（overlay 根内相对路径，`/` 分隔）。
 * 锚点 = 路径里第一处相邻的 `src/host` 段；panels 分支要求末段是 `.ts` 文件，
 * 其余形态一律落兜底——映射永不抛错（无法判定本身就是一种判定）。
 */
export function hostOverlayFile(sourcePath: string): string {
  const segments = sourcePath
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s !== "" && s !== ".");
  for (let i = 0; i + 1 < segments.length; i += 1) {
    if (segments[i] !== "src" || segments[i + 1] !== "host") continue;
    const rest = segments.slice(i + 2);
    const file = rest[rest.length - 1];
    if (
      rest.length >= 2 &&
      rest[0] === "panels" &&
      file !== undefined &&
      file.endsWith(".ts")
    ) {
      const mirrored = [...rest.slice(1)];
      mirrored[mirrored.length - 1] = `${file.slice(0, -3)}.json`;
      return `${HOST_OVERLAY_DIR}/panels/${mirrored.join("/")}`;
    }
    return `${HOST_OVERLAY_DIR}/${MAIN_OVERLAY_FILE}`;
  }
  return MAIN_OVERLAY_FILE;
}