import { posix } from "node:path";
import {
  GEN_PREFIX,
  toPosix,
  uiExtensionOf,
  type ComponentRegistryEntry,
} from "../core.ts";
import type { AliasResolver } from "./alias.ts";

/**
 * 组件导入通道：把一条 import 说明符判成「指向某个组件」还是「不归组件管」。
 *
 * 叠加层组件（`ui/`）与列身体组件（`scenes/`）是同一件事的两个实例：都住在源根的
 * 兄弟目录里，名字都由「目录名 = 文件名去扩展名」定，都经生成物注册表供出句柄。
 * 判定的唯一差异是目录名与注册表基名——三个参数一实例化，两处共用同一份实现。
 *
 * 一个说明符要同时满足三件事才算组件：
 * - 落在 `<沙箱根>/<dir>/` 下（越过沙箱根或落在别处一律 fail-closed，不静默丢弃）；
 * - 相对该目录恰两层：`<目录>/<文件>`；
 * - 文件名去扩展名 = 目录名（名字 = 目录名，同一条规则决定绑定名与文件位置）。
 *
 * `.ts` 额外收紧：故事源自己也是 `.ts`，所以只有位置完全合上 `<dir>/<名>/<名>.ts`
 * 才当组件；其余 `.ts` 说明符一律交回模块图，免得把源树里的列文件当成组件。
 */
export interface ComponentChannel {
  /** 组件所在目录名（源根的兄弟目录，如 `ui` / `scenes`） */
  readonly dir: string;
  /** 源根目录名（如 `Stories.src`），诊断文案里用来指认「组件目录是它的兄弟」 */
  readonly sourceRootName: string;
  /** 组件注册表（扫描期产物）：命名导入注册表时按名字查条目 */
  readonly registry: readonly ComponentRegistryEntry[];
  /**
   * 判定一条说明符。`fromRel` 是发起导入的文件相对**源根**的路径（如
   * `title/title_main.ts`），`spec` 是原样的说明符文本。
   */
  classify(fromRel: string, spec: string): ComponentOutcome;
}

export type ComponentOutcome =
  /** 合上 `<dir>/<名>/<名>.<扩展名>`：`relPath` 相对沙箱根，`name` 即目录名 */
  | {
      readonly kind: "component";
      readonly name: string;
      readonly relPath: string;
    }
  /** 在组件目录之外（越出沙箱根、层级不对、或被引到别处）——fail-closed */
  | { readonly kind: "outside"; readonly target: string }
  /** 落位合规但文件名与目录名不一致——fail-closed */
  | {
      readonly kind: "file-name";
      readonly name: string;
      readonly relPath: string;
    }
  /**
   * 组件注册表生成物（`<生成物目录>/<注册表基名>`）：句柄经**命名导入**取，
   * 名字来自注册表键而不是目录名，故与上面四支分开处置。
   */
  | { readonly kind: "register" }
  /** 不归组件管：不是组件扩展名，或 `.ts` 位置不合规，交回模块图判定 */
  | { readonly kind: "not-component" };

/**
 * 造通道时的归属选项。
 *
 * 同一个说明符会被多条通道各判一次：一条 `.vue` 说明符既不归 UI 管也不归场景管的情况
 * 有两类，必须各有归属，否则一条错报两遍：
 * - 落在**另一个**组件目录下（`ui/…` 之于场景通道）——那是邻居的活，交回；
 * - 落在两个组件目录之外（源树内、越出沙箱、别处）——由**一条**通道收口报错，
 *   其余通道交回，免得同一处写错名字得到两条措辞不同的诊断。
 */
export interface ComponentChannelOptions {
  /** 邻居组件目录名：落在这些目录下的说明符不算本通道的，交回邻居 */
  readonly siblingDirs?: readonly string[];
  /** 组件扩展名落在组件目录之外时是否由本通道出诊断（默认出） */
  readonly ownsForeign?: boolean;
}

/**
 * 造通道。`sourcesDir` 是源根绝对路径（`<工程>/src/Stories.src`），沙箱根由它推出
 * `<工程>/src`——调用方不必额外传一个「组件根」，两处目录天生是父子。
 *
 * `registry` 是组件名注册表（目录扫描的产物）：注册表说明符本身不带名字，具名句柄
 * 要拿导入名去这张表里查，才知它对不对得上一个真实组件文件。
 */
export function createComponentChannel(
  sourcesDir: string,
  dir: string,
  registerBasename: string,
  alias?: AliasResolver,
  registry: readonly ComponentRegistryEntry[] = [],
  options: ComponentChannelOptions = {},
): ComponentChannel {
  const sourceRootName = posix.basename(toPosix(sourcesDir));
  const sandboxRoot = posix.dirname(toPosix(sourcesDir));
  const siblingDirs = options.siblingDirs ?? [];
  const ownsForeign = options.ownsForeign ?? true;
  return {
    dir,
    sourceRootName,
    registry,
    classify(fromRel, spec): ComponentOutcome {
      // 注册表形状先判：它可能带 `.ts` 后缀，而 `.ts` 同时也是故事源自己的扩展名，
      // 走扩展名判定会被当成普通模块交回模块图。两者的区别不在扩展名，在位置——
      // 只有生成物目录下那一个文件才算注册表，别处的同名文件仍交回模块图。
      if (isRegisterSpecifier(spec, registerBasename)) {
        const located = locate(
          sandboxRoot,
          sourceRootName,
          fromRel,
          spec,
          alias,
          true,
        );
        if (located === undefined) return { kind: "not-component" };
        return judgeRegister(located, sourceRootName, registerBasename);
      }
      const extension = uiExtensionOf(spec);
      if (extension === undefined) return { kind: "not-component" };
      const located = locate(sandboxRoot, sourceRootName, fromRel, spec, alias);
      if (located === undefined) return { kind: "not-component" };
      // 邻居先判：落在 `ui/…` 说明符不归场景通道管，反之亦然。位置判定会把它
      // 当成「形状不合」报越界，那是错的说法——它根本没写错，只是别人的组件。
      if (landsInSibling(located, siblingDirs))
        return { kind: "not-component" };
      const outcome = judge(located, sourceRootName, extension, dir);
      // 只让一条通道收口「都不归我管」的越界：组件扩展名落在两个组件目录之外时，
      // 两条通道都会判越界，各报一遍就是同一处写错得到两条诊断。
      if (!ownsForeign && outcome.kind === "outside") {
        return { kind: "not-component" };
      }
      return outcome;
    },
  };
}

/**
 * 说明符的文件名（去 `.ts`）是否就是注册表生成物的基名。
 *
 * 生成物在故事源里既可能写成不带扩展名的 `<基名>`（工程配置把 `.g` 映到生成物），
 * 也可能显式带 `.ts`；两者指同一个文件，判定必须一视同仁。
 */
function isRegisterSpecifier(spec: string, registerBasename: string): boolean {
  const base = posix.basename(toPosix(spec));
  return base.replace(/\.ts$/, "") === registerBasename;
}

/**
 * 注册表说明符的形状判定：只认生成物目录下那一个位置（`src/<生成物目录>/<基名>`）。
 *
 * 越出 `src/` 是越界（与组件说明符同样 fail-closed）；落在别处则只是「恰好同名」，
 * 交回模块图——别的目录下的同名文件不归组件通道管。
 *
 * 落在**源根之内**同理交回模块图：生成物是源根的兄弟目录，源树里那份 `gen/` 归模块
 * 图管（那里有「生成物不参与创作导入」的既有判定），两者不能混为一谈。
 *
 * `locate` 对相对写法与别名写法都会折成「相对 `src/`」的路径，但别名展开会带 `.ts`、
 * 相对写法不带，故判定时再去一次扩展名。
 */
function judgeRegister(
  located: string,
  sourceRootName: string,
  registerBasename: string,
): ComponentOutcome {
  if (located.startsWith("..") || posix.isAbsolute(located)) {
    return { kind: "outside", target: located };
  }
  if (located === sourceRootName || located.startsWith(`${sourceRootName}/`)) {
    return { kind: "not-component" };
  }
  const expected = `${GEN_PREFIX}${registerBasename}`;
  return located.replace(/\.ts$/, "") === expected
    ? { kind: "register" }
    : { kind: "not-component" };
}

/**
 * 折成「相对沙箱根的 posix 路径」：相对说明符从发起文件的目录起算（此时要补回
 * 源根那一段前缀，因为 `fromRel` 不含它）；非相对说明符先问别名表拿绝对路径，再折算。
 *
 * 返回 `undefined` 表示这里判不了（别名未配/未命中），交回模块图按原路径报错。
 *
 * `existenceFree` 关掉别名解析里的存在性探测：注册表生成物是本次构建的产物，编译时
 * 它还没落盘，用探测会把「第一次构建」误判成路径写错。此时只取别名展开的第一个候选，
 * 是否真有这个文件交给写入阶段决定。
 */
function locate(
  sandboxRoot: string,
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
  return posix.relative(sandboxRoot, toPosix(target));
}

/**
 * 折出的路径是否落在某个邻居组件目录下（`ui/<名>/…` 之于场景通道）。
 *
 * 判「目录下」而不是「目录前缀相同」：`uix/a/a.vue` 不该被当成 `ui` 的邻居。
 */
function landsInSibling(
  located: string,
  siblingDirs: readonly string[],
): boolean {
  if (siblingDirs.length === 0) return false;
  const head = located.split("/")[0];
  return siblingDirs.some((dir) => dir === head);
}

/**
 * 形状判定：先看沙箱与层级，再看文件名是否等于目录名。
 *
 * `.ts` 与其余扩展名分开收口——`.ts` 同时也是故事源自己的扩展名，位置不合规时它只是
 * 一个普通模块说明符，必须原样交回模块图（那里有源根沙箱与更准确的诊断）；其余扩展名
 * 在本设计里只可能是组件，位置不合规就是越界，fail-closed。
 */
function judge(
  located: string,
  sourceRootName: string,
  extension: string,
  dir: string,
): ComponentOutcome {
  if (located.startsWith("..") || posix.isAbsolute(located)) {
    return { kind: "outside", target: located };
  }
  // 源根自己可能就叫组件目录名（sourcesDir 配成 `src/ui`）——那样 `ui/` 前缀指的是
  // 源树内部，不是组件目录，必须交回模块图。
  if (located === sourceRootName || located.startsWith(`${sourceRootName}/`)) {
    return extension === ".ts"
      ? { kind: "not-component" }
      : { kind: "outside", target: located };
  }
  const parts = located.split("/");
  const shapeOk = parts.length === 3 && parts[0] === dir;
  if (!shapeOk) {
    return extension === ".ts"
      ? { kind: "not-component" }
      : { kind: "outside", target: located };
  }
  const [, name, fileName] = parts as [string, string, string];
  const base = fileName.slice(0, -extension.length);
  if (base !== name) {
    return extension === ".ts"
      ? { kind: "not-component" }
      : { kind: "file-name", name, relPath: located };
  }
  return { kind: "component", name, relPath: located };
}
