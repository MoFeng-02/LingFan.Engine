/**
 * 资源端口：逻辑路径 → 文件内容 → Blob URL（同路径复用同一 URL，`release` 才 revoke）。
 * 解析失败必须抛错——调用方 fail-closed 不播放/不显示。
 */
import type { ProjectFileSource, ResourcePort } from "@lingfan/engine";
import { normalizeResourceId } from "../resourcePort";

/**
 * Blob URL 构造/释放（缺省 `URL.createObjectURL`；测试以契约替身注入）。
 * 形参是 `Blob`：契约层给的是中立文件句柄，真正要喂给 `URL.createObjectURL` 的
 * 是它背后的文件内容，收窄由本文件在调用点完成。
 */
export interface BlobUrlOptions {
  createObjectURL?: (file: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}

/** `ResourcePort` 实现：解析结果与在途请求各记一份，失败不粘滞 */
export function createSourceResourcePort(
  source: ProjectFileSource,
  options: BlobUrlOptions = {},
): ResourcePort {
  const create = options.createObjectURL ?? ((file: Blob) => URL.createObjectURL(file));
  const revoke = options.revokeObjectURL ?? ((url: string) => URL.revokeObjectURL(url));
  /** 逻辑路径 → 已解析 URL（release 时反查并清空） */
  const resolved = new Map<string, string>();
  const inFlight = new Map<string, Promise<string>>();
  return {
    async resolve(id: string): Promise<string> {
      const path = normalizeResourceId(id);
      const cached = resolved.get(path);
      if (cached !== undefined) return cached;
      const pending = inFlight.get(path);
      if (pending !== undefined) return pending;
      const task = source.file(path).then((file) => {
        // 中立句柄 → 文件内容：供给方给的就是本环境的真实文件对象，这里只把类型收回来
        const url = create(file as Blob);
        resolved.set(path, url);
        inFlight.delete(path);
        return url;
      });
      inFlight.set(path, task);
      try {
        return await task;
      } catch (error: unknown) {
        inFlight.delete(path); // 失败不粘滞：允许修好资源后重试
        throw error;
      }
    },
    release(url: string): void {
      for (const [path, known] of resolved) {
        if (known !== url) continue; // 只释放本端口产出的 URL
        resolved.delete(path);
        revoke(url);
        return;
      }
    },
  };
}
