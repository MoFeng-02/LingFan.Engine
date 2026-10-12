/**
 * 写盘域：编译产物落盘、结果报告、以及编译前后的往返比对。
 *
 * 三者共用同一个关注点——「源编译成引擎能读的东西」——往返比对是落盘前
 * 的最后一道闸，报告是落盘的结果描述，故同域。
 */
export { emitArtifacts, type EmitOptions } from "./emit";
export { drainBuildWarnings, type BuildReport } from "./report";
export { assertRoundTrip, compileStory } from "./compile-roundtrip";
