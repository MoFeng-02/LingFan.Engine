import { posix } from "node:path";
import { toPosix, uiExtensionOf } from "../core.ts";
import type { AliasResolver } from "./alias.ts";

/**
 * UI 导入通道：把一条 import 说明符判成「指向某个 UI」还是「不归 UI 管」。
 *
 * UI 文件与故事源是同一棵树上的兄弟目录——故事源在 `src/Stories.src/`，UI 在
 * `src/ui/<名>/<名>.<扩展名>`。因此这里的沙箱根是 `src/`（源根的上一级），比模块导入
 * 的沙箱更宽：模块导入只认源根内，UI 恰好必须落在源根外。
 *
 * 一个说明符要同时满足三件事才算 UI：
 * - 落在 `src/ui/` 下（越过 `src/` 或落在别处一律 fail-closed，不静默丢弃）；
 * - 相对 `src/ui/` 恰两层：`<目录>/<文件>`；
 * - 文件名去扩展名 = 目录名（名字 = 目录名，同一条规则决定绑定名与文件位置）。
 *
 * `.ts` 额外收紧：故事源自己也是 `.ts`，所以只有位置完全合上 `ui/<名>/<名>.ts` 才当 UI；
 * 其余 `.ts` 说明符一律交回模块图，免得把源树里的列文件当成 UI。
 */
export interface UiChannel {
  /** 源根目录名（如 `Stories.src`），诊断文案里用来指认「UI 是它的兄弟目录」 */
  readonly sourceRootName: string;
  /**
   * 判定一条说明符。`fromRel` 是发起导入的文件相对**源根**的路径（如
   * `title/title_main.ts`），`spec` 是原样的说明符文本。
   */
  classify(fromRel: string, spec: string): UiOutcome;
}

export type UiOutcome =
  /** 合上 `ui/<名>/<名>.<扩展名>`：`relPath` 相对 `src/`，`name` 即目录名 */
  | { readonly kind: "ui"; readonly name: string; readonly relPath: string }
  /** 在 `src/ui/` 之外（越出 `src/`、层级不对、或被引到别处）——fail-closed */
  | { readonly kind: "outside"; readonly target: string }
  /** 落位合规但文件名与目录名不一致——fail-closed */
  | {
      readonly kind: "file-name";
      readonly name: string;
      readonly relPath: string;
    }
  /** 不归 UI 管：不是 UI 扩展名，或 `.ts` 位置不合规，交回模块图判定 */
  | { readonly kind: "not-ui" };

const UI_DIR = "ui";

/**
 * 造通道。`sourcesDir` 是源根绝对路径（`<工程>/src/Stories.src`），沙箱根由它推出
 * `<工程>/src`——调用方不必额外传一个「UI 根」，两处目录天生是父子。
 */
export function createUiChannel(
  sourcesDir: string,
  alias?: AliasResolver,
): UiChannel {
  const sourceRootName = posix.basename(toPosix(sourcesDir));
  const srcRoot = posix.dirname(toPosix(sourcesDir));
  return {
    sourceRootName,
    classify(fromRel, spec): UiOutcome {
      const extension = uiExtensionOf(spec);
      if (extension === undefined) return { kind: "not-ui" };
      const located = locate(srcRoot, sourceRootName, fromRel, spec, alias);
      if (located === undefined) return { kind: "not-ui" };
      return judge(located, sourceRootName, extension);
    },
  };
}

/**
 * 折成「相对 `src/` 的 posix 路径」：相对说明符从发起文件的目录起算（此时要补回
 * 源根那一段前缀，因为 `fromRel` 不含它）；非相对说明符先问别名表拿绝对路径，再折算。
 *
 * 返回 `undefined` 表示这里判不了（别名未配/未命中），交回模块图按原路径报错。
 */
function locate(
  srcRoot: string,
  sourceRootName: string,
  fromRel: string,
  spec: string,
  alias?: AliasResolver,
): string | undefined {
  if (spec.startsWith(".")) {
    return posix.join(sourceRootName, posix.dirname(toPosix(fromRel)), spec);
  }
  const target = alias?.locateFile(spec);
  if (target === undefined) return undefined;
  return posix.relative(srcRoot, toPosix(target));
}

/**
 * 形状判定：先看沙箱与层级，再看文件名是否等于目录名。
 *
 * `.ts` 与其余扩展名分开收口——`.ts` 同时也是故事源自己的扩展名，位置不合规时它只是
 * 一个普通模块说明符，必须原样交回模块图（那里有源根沙箱与更准确的诊断）；其余扩展名
 * 在本设计里只可能是 UI，位置不合规就是越界，fail-closed。
 */
function judge(
  located: string,
  sourceRootName: string,
  extension: string,
): UiOutcome {
  if (located.startsWith("..") || posix.isAbsolute(located)) {
    return { kind: "outside", target: located };
  }
  // 源根自己可能就叫 `ui`（sourcesDir 配成 `src/ui`）——那样 `ui/` 前缀指的是源树内部，
  // 不是 UI 目录，必须交回模块图。
  if (located === sourceRootName || located.startsWith(`${sourceRootName}/`)) {
    return extension === ".ts"
      ? { kind: "not-ui" }
      : { kind: "outside", target: located };
  }
  const parts = located.split("/");
  const shapeOk = parts.length === 3 && parts[0] === UI_DIR;
  if (!shapeOk) {
    return extension === ".ts"
      ? { kind: "not-ui" }
      : { kind: "outside", target: located };
  }
  const [, name, fileName] = parts as [string, string, string];
  const base = fileName.slice(0, -extension.length);
  if (base !== name) {
    return extension === ".ts"
      ? { kind: "not-ui" }
      : { kind: "file-name", name, relPath: located };
  }
  return { kind: "ui", name, relPath: located };
}
