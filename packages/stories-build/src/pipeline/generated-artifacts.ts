import type { Story, StoryColumn } from "@lingfan-engine/core";
import type { FontEntry } from "../fonts/index.ts";
import { renderFontTypegen } from "../typegen/index.ts";
import {
  collectDeclaredNames,
  renderScriptTypegen,
  renderStateTypegen,
  renderTypegen,
} from "../typegen/index.ts";
import type { EnumTypeSlot } from "../typegen/index.ts";
import { renderSceneRegister } from "../scene/index.ts";
import type { SceneFileEntry } from "../scene/index.ts";
import { renderUiRegister } from "../ui/index.ts";
import type { UiFileEntry } from "../ui/index.ts";

/**
 * 生成物的输入：全部取上游各段已算好的结果，本段不重跑任何一段。
 *
 * 为什么把「算什么」和「写什么」分开：这些渲染器只做字符串拼接，但输入有九个、
 * 来源分散在图谱、求值、字体、组件注册表四处。让编排函数一手抓到九个变量再各自
 * 拼路径，读的人要在两百行里来回找；收成一个入参对象之后，「哪个生成物依赖什么」
 * 变成一个可以逐行读完的表。
 */
export interface GeneratedArtifactsInput {
  /** 合并后的故事（列 id 与命令流都在这里，类型面从它取名字） */
  readonly merged: Story;
  /** state schema 的键集（`InterpolationKeyRegistry` 的一部分） */
  readonly schemaKeys: readonly string[];
  /** `config.vars` 的键集（插值键的另一部分） */
  readonly defineKeys: readonly string[];
  /** 扩展装载段算出的扩展 id（插值键的扩展前缀面） */
  readonly extensionPrefixes: readonly string[];
  /** state 树（形态 A 的 state 树 / 形态 B 的 define 合并树） */
  readonly stateTree: unknown;
  /** 枚举 type 槽位（从 config.ts 与各模块源文按点路径回收） */
  readonly enumSlots: ReadonlyMap<string, EnumTypeSlot[]>;
  /** 源根目录名（state 类型面里的相对路径基线） */
  readonly sourceRootDir: string;
  /** 生成物目录（相对工程根） */
  readonly generatedDir: string;
  /** 字体名注册表 */
  readonly fontEntries: readonly FontEntry[];
  /** UI 名注册表 */
  readonly uiEntries: readonly UiFileEntry[];
  /** 生成物回指 UI 根的相对路径（默认 `"../ui"`） */
  readonly uiRelFromGenerated: string;
  /** 场景名注册表 */
  readonly sceneEntries: readonly SceneFileEntry[];
  /** 生成物回指场景根的相对路径（默认 `"../scenes"`） */
  readonly sceneRelFromGenerated: string;
}

/** 生成物正文：逐项恒产出，只有场景表可能是 `null`（表示「该文件不该存在」） */
export interface GeneratedArtifacts {
  /** 列名与插值键的类型面（`stories.gen.d.ts`） */
  readonly typegenContent: string;
  /** state 精确类型面（`state.gen.d.ts`） */
  readonly stateTypegenContent: string;
  /** script 命名空间 ambient 声明（`script.gen.d.ts`） */
  readonly scriptTypegenContent: string;
  /** 字体名字面量类型面（`font.gen.d.ts`） */
  readonly fontTypegenContent: string;
  /** UI 注册表（`ui_register.g.ts`） */
  readonly uiRegisterContent: string;
  /** 场景注册表（`scene_register.g.ts`）；`null` = 零场景，落盘段据此删除旧文件 */
  readonly sceneRegisterContent: string | null;
}

/**
 * 渲染全部生成物的正文。
 *
 * 顺序与依赖：类型面要列名 → 列来自 `merged`；state 面要树与枚举槽位 → 来自求值段；
 * 两张组件表各自的注册表与相对路径成对出现，任缺一项渲染出的 import 就是错的，
 * 所以它们必须同进同出，这里用同一个入参对象绑住。
 */
export function renderGeneratedArtifacts(
  input: GeneratedArtifactsInput,
): GeneratedArtifacts {
  const columns: readonly StoryColumn[] = input.merged.columns;
  return {
    typegenContent: renderTypegen({
      columns: columns.map((column) => column.id),
      schemaKeys: input.schemaKeys,
      defineKeys: input.defineKeys,
      declaredNames: collectDeclaredNames(columns),
      extensionPrefixes: input.extensionPrefixes,
    }),
    stateTypegenContent: renderStateTypegen({
      tree: input.stateTree,
      enumSlots: input.enumSlots,
      sourceRootDir: input.sourceRootDir,
      generatedDir: input.generatedDir,
    }),
    scriptTypegenContent: renderScriptTypegen(),
    fontTypegenContent: renderFontTypegen(input.fontEntries),
    uiRegisterContent: renderUiRegister(
      input.uiEntries,
      input.uiRelFromGenerated,
    ),
    // 与 UI 表物理隔离：零场景 ⇒ `null`，落盘段按「零守卫」规则删掉旧文件。
    sceneRegisterContent:
      input.sceneEntries.length === 0
        ? null
        : renderSceneRegister(input.sceneEntries, input.sceneRelFromGenerated),
  };
}
