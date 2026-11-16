import {
  SCENE_DIR_NAME,
  UI_DIR_NAME,
  UI_REGISTER_BASENAME,
  type UiRegistryEntry,
} from "../core.ts";
import {
  createComponentChannel,
  type ComponentChannel,
  type ComponentOutcome,
} from "./component-specifier.ts";
import type { AliasResolver } from "./alias.ts";

/**
 * UI 导入通道：组件通道的 UI 实例。
 *
 * UI 文件与故事源是同一棵树上的兄弟目录——故事源在 `src/Stories.src/`，UI 在
 * `src/ui/<名>/<名>.<扩展名>`。判定规则、`.ts` 收紧、注册表形状全在组件通道里，
 * 这里只把判词换回 UI 的说法：`component` 是 `ui`，`not-component` 是 `not-ui`。
 *
 * 保留这层壳而不是让调用方直接用组件通道，是因为「UI」在诊断文案、门禁与外部契约里
 * 是固定说法；两处各自措辞、共用一套判定，改判定只要改一处。
 */
export interface UiChannel {
  /**
   * 底层组件通道。判定与落账的实体在组件通道里，UI 这层只换措辞；内部消费者
   * （模块图的说明符归属、组件导入落账）拿它去干活，不必绕回 UI 判词再翻一遍。
   */
  readonly component: ComponentChannel;
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

/**
 * 造通道。`sourcesDir` 是源根绝对路径（`<工程>/src/Stories.src`），沙箱根由组件通道
 * 推出 `<工程>/src`。
 *
 * `registry` 是 UI 名注册表（`scanUiRegistry` 的产物）：注册表说明符本身不带名字，
 * 具名句柄要拿导入名去这张表里查，才知它对不对得上一个真实 UI 文件。
 */
export function createUiChannel(
  sourcesDir: string,
  alias?: AliasResolver,
  registry: readonly UiRegistryEntry[] = [],
): UiChannel {
  const channel: ComponentChannel = createComponentChannel(
    sourcesDir,
    UI_DIR_NAME,
    UI_REGISTER_BASENAME,
    alias,
    registry,
    // `ui/` 说明符归 UI 管（场景通道交回），都不归两条通道管的越界也由 UI 收口报一次
    { siblingDirs: [SCENE_DIR_NAME], ownsForeign: true },
  );
  return {
    component: channel,
    sourceRootName: channel.sourceRootName,
    registry: channel.registry,
    classify(fromRel, spec): UiOutcome {
      return toUiOutcome(channel.classify(fromRel, spec));
    },
  };
}

/** 组件判词 → UI 判词：只有两支名字不同，其余原样透传 */
function toUiOutcome(outcome: ComponentOutcome): UiOutcome {
  switch (outcome.kind) {
    case "component":
      return { kind: "ui", name: outcome.name, relPath: outcome.relPath };
    case "not-component":
      return { kind: "not-ui" };
    default:
      return outcome;
  }
}
