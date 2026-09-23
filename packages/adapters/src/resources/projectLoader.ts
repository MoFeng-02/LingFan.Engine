/**
 * 07 §三 工程加载器（浏览器/WebView 平台）：实现 `ProjectFilesPort` 契约——
 * 从**应用资源根**取工程清单与故事文件，交给引擎的纯函数组装器（`assembleProject`）。
 *
 * 资源寻址语义：逻辑路径相对 `Resources/`（`project.json`、`Stories/title/title_main.story`），
 * 由宿主把资源根挂为静态根 → 不依赖进程工作目录（08-U7）。
 * **故事文件以原始文本供给**：组装器是唯一解析点（T4 混存识别 + 单列文件名不变量都在那里）。
 * 桌面正式形态换 Rust 命令实现同一契约——平台差异被限制在「取文件」这一步。
 */
import {
  assembleProject,
  type ProjectFilesPort,
  type Story,
} from "@lingfan/engine";

export interface FetchProjectFilesOptions {
  /** 工程清单逻辑路径（相对资源根），如 `"project.json"` */
  manifest: string;
  /** 故事文件逻辑路径列表，如 `["Stories/title/title_main.story"]` */
  stories: readonly string[];
  /** 资源根 URL 前缀（默认源根 `/`） */
  root?: string;
}

/** 逻辑路径按资源根前缀请求；加载失败必须抛错（不静默降级为空工程） */
export function createFetchProjectFilesPort(
  options: FetchProjectFilesOptions,
): ProjectFilesPort {
  const root = options.root ?? "/";
  const read = async (path: string): Promise<string> => {
    const response = await fetch(`${root}${path}`);
    if (!response.ok) {
      throw new Error(`${path} 加载失败：HTTP ${response.status}`);
    }
    return response.text();
  };
  return {
    async manifest(): Promise<unknown> {
      return JSON.parse(await read(options.manifest));
    },
    async stories(): Promise<Map<string, string>> {
      const files = new Map<string, string>();
      for (const path of options.stories) {
        files.set(path, await read(path)); // 原始文本：解析归组装器（唯一解析点）
      }
      return files;
    },
  };
}

/** 便捷装载：供给端口 → 引擎纯函数组装（平台无关；组合根按构建模式选端口实现） */
export async function loadProject(port: ProjectFilesPort): Promise<Story> {
  return assembleProject(await port.manifest(), await port.stories());
}

/** fetch 便捷装载：浏览器/WebView 平台 */
export async function loadProjectFromFetch(
  options: FetchProjectFilesOptions,
): Promise<Story> {
  return loadProject(createFetchProjectFilesPort(options));
}
