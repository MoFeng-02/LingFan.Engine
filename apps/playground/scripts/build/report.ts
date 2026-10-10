import { script, type ExpressionWarning } from "@lingfan/editor";

/** 一次构建的结果（CLI 据此打印，测试据此断言） */
export interface BuildReport {
  /** 源文件名（相对 `Stories.src/`） */
  source: string;
  storyId: string;
  columns: number;
  /** 本次实际写入的产物（逻辑路径，相对资源根） */
  written: string[];
  /** 本次清理的陈旧项（逻辑路径；`Stories.src/...` 是生成物命名空间） */
  removed: string[];
  /** 本轮按清单声明装载的扩展说明符（声明缺席/为空 = 空数组，装载器一次不触） */
  extensions: string[];
  /** cell(...) 声明并生成进注册物的守卫名（书写序；缺席 = 空数组） */
  functions: string[];
  /** 词汇层轻类型校验警告（expr/cond 组装时按引擎类型规则产出；不拦构建——引擎/编辑期仍是权威） */
  warnings: ExpressionWarning[];
}

/**
 * 取走并清空词汇层类型警告。
 * 源模块导入即完成全部表达式组装，故整次构建只在收尾调一次——不拦构建，只进报告由 CLI 呈现。
 */
export function drainBuildWarnings(): ExpressionWarning[] {
  return [...script.drainExpressionWarnings()];
}
