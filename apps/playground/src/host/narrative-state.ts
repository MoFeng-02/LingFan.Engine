/**
 * 叙事视图状态（本宿主类型面）：逻辑在 `@lingfan/shell` 的叙事状态域，
 * 这里把状态单元类型对准 Vue 的 `Ref`/`ComputedRef`——Vue `ref`/`computed`
 * 结构上就是 Cell（`{ value: T }`），模板解包与类型检查按 Vue 语义走。
 */
import type { ComputedRef, Ref } from "vue";
import type { ElementInstance } from "@lingfan/engine";
import type { MenuOption } from "@lingfan/shell";

/**
 * Vue 形状的叙事视图状态：shell 返回的对象字段即 Vue 响应式单元
 * （经 `app-narrative.ts` 的 StateCells 注入），此处只把字段类型按 Vue 语义命名。
 */
export type NarrativeState = {
  readonly speaker: Ref<string>;
  readonly text: Ref<string>;
  readonly shownText: Ref<string>;
  readonly speakerColor: Ref<string>;
  readonly canAdvance: Ref<boolean>;
  readonly inMenu: Ref<boolean>;
  readonly inWait: Ref<boolean>;
  readonly inInput: Ref<boolean>;
  readonly inVideo: Ref<boolean>;
  readonly inMinigame: Ref<boolean>;
  readonly inInteraction: Ref<boolean>;
  readonly inExtension: Ref<boolean>;
  readonly dialogHidden: Ref<boolean>;
  readonly menuPrompt: Ref<string>;
  readonly inputPrompt: Ref<string>;
  readonly inputValue: Ref<string>;
  readonly rawTexts: Ref<string[]>;
  readonly rawTargets: Ref<string[]>;
  readonly menuOptions: ComputedRef<MenuOption[]>;
  readonly dialogTemplateName: Ref<string | null>;
  readonly dialogFont: Ref<string>;
  readonly nvlMode: Ref<string>;
  readonly nvlBuffer: Ref<string[]>;
  readonly elements: Ref<ElementInstance[]>;
  handleState(key: string, value: unknown): void;
  syncFromEngine(read: (key: string) => unknown): void;
};
