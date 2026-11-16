import {
  SCENE_DIR_NAME,
  SCENE_REGISTER_BASENAME,
  UI_DIR_NAME,
  type SceneRegistryEntry,
} from "../core.ts";
import {
  createComponentChannel,
  type ComponentChannel,
  type ComponentOutcome,
} from "./component-specifier.ts";
import type { AliasResolver } from "./alias.ts";

/**
 * 场景导入通道：组件通道的场景实例。
 *
 * 场景（列身体组件）住在 `src/scenes/<名>/<名>.<扩展名>`，与故事源平级——和 UI 是
 * 同一层邻居，判定规则完全一样（落在 `src/scenes/` 下、恰两层、文件名 = 目录名）。
 * 两处共用一个实现、各自一张注册表：挂载面（`ui`）与身体面（`scenes`）互不串号。
 */
export interface SceneChannel {
  /**
   * 底层组件通道。判定与落账的实体在组件通道里，场景这层只换措辞；内部消费者
   * （模块图的说明符归属、组件导入落账）拿它去干活，不必绕回场景判词再翻一遍。
   */
  readonly component: ComponentChannel;
  /** 源根目录名（如 `Stories.src`），诊断文案里用来指认「场景是它的兄弟目录」 */
  readonly sourceRootName: string;
  /** 场景注册表（扫描期产物）：命名导入注册表时按名字查条目 */
  readonly registry: readonly SceneRegistryEntry[];
  /**
   * 判定一条说明符。`fromRel` 是发起导入的文件相对**源根**的路径（如
   * `room/room_kitchen.ts`），`spec` 是原样的说明符文本。
   */
  classify(fromRel: string, spec: string): SceneOutcome;
}

export type SceneOutcome =
  /** 合上 `scenes/<名>/<名>.<扩展名>`：`relPath` 相对 `src/`，`name` 即目录名 */
  | { readonly kind: "scene"; readonly name: string; readonly relPath: string }
  /** 在 `src/scenes/` 之外（越出 `src/`、层级不对、或被引到别处）——fail-closed */
  | { readonly kind: "outside"; readonly target: string }
  /** 落位合规但文件名与目录名不一致——fail-closed */
  | {
      readonly kind: "file-name";
      readonly name: string;
      readonly relPath: string;
    }
  /**
   * 场景注册表生成物（`<生成物目录>/scene_register.g`）：句柄经**命名导入**取，
   * 名字来自注册表键而不是目录名，故与上面四支分开处置。
   */
  | { readonly kind: "register" }
  /** 不归场景管：不是组件扩展名，或 `.ts` 位置不合规，交回模块图判定 */
  | { readonly kind: "not-scene" };

/**
 * 造通道。`sourcesDir` 是源根绝对路径（`<工程>/src/Stories.src`），沙箱根由组件通道
 * 推出 `<工程>/src`。
 *
 * `registry` 是场景名注册表（`scanSceneRegistry` 的产物）：注册表说明符本身不带名字，
 * 具名句柄要拿导入名去这张表里查，才知它对不对得上一个真实场景文件。
 */
export function createSceneChannel(
  sourcesDir: string,
  alias?: AliasResolver,
  registry: readonly SceneRegistryEntry[] = [],
): SceneChannel {
  const channel: ComponentChannel = createComponentChannel(
    sourcesDir,
    SCENE_DIR_NAME,
    SCENE_REGISTER_BASENAME,
    alias,
    registry,
    // `scenes/` 说明符归场景管（UI 通道交回）；都不归两条通道管的越界由 UI 收口，
    // 这里不再出第二遍，免得同一处写错得到两条措辞不同的诊断
    { siblingDirs: [UI_DIR_NAME], ownsForeign: false },
  );
  return {
    component: channel,
    sourceRootName: channel.sourceRootName,
    registry: channel.registry,
    classify(fromRel, spec): SceneOutcome {
      return toSceneOutcome(channel.classify(fromRel, spec));
    },
  };
}

/** 组件判词 → 场景判词：只有两支名字不同，其余原样透传 */
function toSceneOutcome(outcome: ComponentOutcome): SceneOutcome {
  switch (outcome.kind) {
    case "component":
      return { kind: "scene", name: outcome.name, relPath: outcome.relPath };
    case "not-component":
      return { kind: "not-scene" };
    default:
      return outcome;
  }
}
