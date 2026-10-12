/**
 * state 状态根的 TS 侧桥（ambient 全局）。
 *
 * 编译器按名识别状态根：章节源裸写 `state.…`，无需任何导入或绑定
 * （module-scan 状态根发现回退 "state"），运行期无实体。
 * 本桥只为 tsc 提供类型：宽 StateRoot（垫片形态）。
 * 精确类型面按形态分流（界面规范 对应章节）：形态 A 可经 `InferStateSchema<typeof state>`
 * 收窄；形态 B 由 gen/stories.gen.d.ts 生成（暂未实现）。
 */
import type { StateRoot } from "@lingfan/stories-build/authoring";

declare global {
  var state: StateRoot;
}

export {};
