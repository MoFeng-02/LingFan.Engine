/**
 * 引擎族出口：`../engine.ts` 是模块的调度件与公开门面，本目录只放它的拆出单元。
 *
 * 取件方式：**必须显式写 `./engine/index.ts`**——`../engine.ts` 与本目录同名，
 * 裸 `./engine` 会先解析到同名文件（`data/format/validate.ts` + `validate/` 同例）。
 */
export { EngineCore } from "./state.ts";
export { EngineForwarders } from "./forwarders.ts";
