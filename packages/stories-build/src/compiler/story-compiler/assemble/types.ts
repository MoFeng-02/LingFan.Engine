/**
 * 装配层的公共形状：会话状态、单列编译结果与函数体编译产物。
 *
 * 类型放叶子：会话实现与函数体翻译都要用这些形状，声明在任一实现里都会让另一方反向依赖。
 */

import type { CharacterDef, Story, StoryCommand } from "@lingfan-engine/core";
import type { StoriesBuildTexts } from "../../../shared/index.ts";

/** 会话：跨文件共享状态（函数缓存 / 字体表 / 文案表 / 全工程角色表） */
export interface AssembleSession {
  cache: Map<string, CompiledFunction>;
  /** 字体名注册表（编排层自 Resources/Fonts 扫描；构建期字体引用检查对照源） */
  fontNames: ReadonlySet<string>;
  /** 集中文案表（编译入口注入，已含缺省合并；诊断文案只从这里取） */
  texts: StoriesBuildTexts;
  /** 全工程角色表（编排层模块层声明收集产物）：前置成每个故事 start 列头的 character 命令 */
  characters: ReadonlyMap<string, CharacterDef>;
}

/** 单列编译结果 */
export interface CompiledStory {
  columnId: string;
  sourceRelPath: string;
  story: Story;
}

/** 一次函数编译的产物：签名、体命令、被引函数名与全部嵌套名（同列重名检查用） */
export interface CompiledFunction {
  key: string;
  file: string;
  name: string;
  params: string[];
  body: StoryCommand[];
  refs: ReadonlySet<string>;
  allNames: ReadonlyMap<string, { file: string; line: number; col: number }>;
}
