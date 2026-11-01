import { posix } from "node:path";
import {
  GEN_PREFIX,
  toPosix,
  uiExtensionOf,
  UI_REGISTER_BASENAME,
  type UiRegistryEntry,
} from "../core.ts";
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
  /** UI 注册表（扫描期产物）：命名导入注册表时按名字查条目 */
  readonly registry: readonly UiRegistryEntry[];
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
  /**
   * UI 注册表生成物（`<生成物目录>/ui_register.g`）：句柄经**命名导入**取，
   * 名字来自注册表键而不是目录名，故与上面四支分开处置。
   */
  | { readonly kind: "register" }
  /** 不归 UI 管：不是 UI 扩展名，或 `.ts` 位置不合规，交回模块图判定 */
  | { readonly kind: "not-ui" };

const UI_DIR = "ui";

/**
 * 造通道。`sourcesDir` 是源根绝对路径（`<工程>/src/Stories.src`），沙箱根由它推出
 * `<工程>/src`——调用方不必额外传一个「UI 根」，两处目录天生是父子。
 *
 * `registry` 是 UI 名注册表（`scanUiRegistry` 的产物）：注册表说明符本身不带名字，
 * 具名句柄要拿导入名去这张表里查，才知它对不对得上一个真实 UI 文件。
 */
export function createUiChannel(
  sourcesDir: string,
  alias?: AliasResolver,
  registry: readonly UiRegistryEntry[] = [],
): UiChannel {
  const sourceRootName = posix.basename(toPosix(sourcesDir));
  const srcRoot = posix.dirname(toPosix(sourcesDir));
  return {
    sourceRootName,
    registry,
    classify(fromRel, spec): UiOutcome {
      // 注册表形状先判：它可能带 `.ts` 后缀，而 `.ts` 同时也是故事源自己的扩展名，
      // 走扩展名判定会被当成普通模块交回模块图。两者的区别不在扩展名，在位置——
      // 只有生成物目录下那一个文件才算注册表，别处的同名文件仍交回模块图。
      if (isRegisterSpecifier(spec)) {
        const located = locate(
          srcRoot,
          sourceRootName,
          fromRel,
          spec,
          alias,
          true,
        );
        if (located === undefined) return { kind: "not-ui" };
        return judgeRegister(located, sourceRootName);
      }
      const extension = uiExtensionOf(spec);
      if (extension === undefined) return { kind: "not-ui" };
      const located = locate(srcRoot, sourceRootName, fromRel, spec, alias);
      if (located === undefined) return { kind: "not-ui" };
      return judge(located, sourceRootName, extension);
    },
  };
}

/**
 * 说明符的文件名（去 `.ts`）是否就是注册表生成物的基名。
 *
 * 生成物在故事源里既可能写成不带扩展名的 `<基名>`（工程配置把 `.g` 映到生成物），
 * 也可能显式带 `.ts`；两者指同一个文件，判定必须一视同仁。
 */
function isRegisterSpecifier(spec: string): boolean {
  const base = posix.basename(toPosix(spec));
  return base.replace(/\.ts$/, "") === UI_REGISTER_BASENAME;
}

/**
 * 注册表说明符的形状判定：只认生成物目录下那一个位置（`src/<生成物目录>/ui_register.g`）。
 *
 * 越出 `src/` 是越界（与 UI 说明符同样 fail-closed）；落在别处则只是「恰好同名」，
 * 交回模块图——别的目录下的同名文件不归 UI 通道管。
 *
 * 落在**源根之内**同理交回模块图：生成物是源根的兄弟目录，源树里那份 `gen/` 归模块
 * 图管（那里有「生成物不参与创作导入」的既有判定），两者不能混为一谈。
 *
 * `locate` 对相对写法与别名写法都会折成「相对 `src/`」的路径，但别名展开会带 `.ts`、
 * 相对写法不带，故判定时再去一次扩展名。
 */
function judgeRegister(located: string, sourceRootName: string): UiOutcome {
  if (located.startsWith("..") || posix.isAbsolute(located)) {
    return { kind: "outside", target: located };
  }
  if (located === sourceRootName || located.startsWith(`${sourceRootName}/`)) {
    return { kind: "not-ui" };
  }
  const expected = `${GEN_PREFIX}${UI_REGISTER_BASENAME}`;
  return located.replace(/\.ts$/, "") === expected
    ? { kind: "register" }
    : { kind: "not-ui" };
}

/**
 * 折成「相对 `src/` 的 posix 路径」：相对说明符从发起文件的目录起算（此时要补回
 * 源根那一段前缀，因为 `fromRel` 不含它）；非相对说明符先问别名表拿绝对路径，再折算。
 *
 * 返回 `undefined` 表示这里判不了（别名未配/未命中），交回模块图按原路径报错。
 *
 * `existenceFree` 关掉别名解析里的存在性探测：注册表生成物是本次构建的产物，编译时
 * 它还没落盘，用探测会把「第一次构建」误判成路径写错。此时只取别名展开的第一个候选，
 * 是否真有这个文件交给写入阶段决定。
 */
function locate(
  srcRoot: string,
  sourceRootName: string,
  fromRel: string,
  spec: string,
  alias?: AliasResolver,
  existenceFree = false,
): string | undefined {
  if (spec.startsWith(".")) {
    return posix.join(sourceRootName, posix.dirname(toPosix(fromRel)), spec);
  }
  const target =
    alias?.locateFile(spec) ??
    (existenceFree ? alias?.expandTarget(spec) : undefined);
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
