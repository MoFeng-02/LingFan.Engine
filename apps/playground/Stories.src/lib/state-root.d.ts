/**
 * state 状态根的 TS 侧桥（ambient 全局）。
 *
 * 编译器按名识别状态根：章节源裸写 `state.…`，无需任何导入或绑定
 * （module-scan 状态根发现同时识别本桥的 `declare global { var <根名>: StoryState }`），
 * 运行期无实体。本桥只为 tsc 提供类型：`StoryState` 由 stories:build 从 config
 * 合并树生成到 `gen/state.gen.d.ts`（形态 B gen 类型面），精确到枚举引用。
 *
 * 第二条 import 拉入创作垫片的全局声明（define/defineVars 是 ambient 增补，只在
 * 模块进入 tsc 程序时生效——config.ts 书写这些内建依赖本桥把它带进程序；空具名
 * type 导入不引入任何绑定，也不被构建图当作值导入处理）。
 */
import type { StoryState } from "../gen/state.gen";
import type {} from "@lingfan/stories-build/authoring";

declare global {
  var state: StoryState;
}

export {};
