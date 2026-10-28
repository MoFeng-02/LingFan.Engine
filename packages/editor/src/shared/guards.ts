/**
 * 通用取值判据的**转发口**：编辑器包多个域（诊断、i18n、布局）都要对「这个值是不是一条记录」下判断。
 *
 * **实现只有一处**，在引擎包 `packages/core/src/shared/guards.ts`（经 `@lingfan-engine/core`
 * 包出口公开，链路由 `core/src/index.ts` → `core/src/contracts/index.ts` → `core/src/shared/index.ts`
 * 三级转发构成）。此处只做转发，不持有实现体。
 *
 * 为什么不在这里留第二份实现：判据本身不含业务含义，任何层都可以引用；而它一旦分叉，
 * 分叉点就是静默的行为差异——同一棵树，两处判定不同就会出现「这边认、那边不认」。
 * 缺人少写一个 `!Array.isArray` 就是症状的来源。
 */
export { isPlainObject } from "@lingfan-engine/core";
