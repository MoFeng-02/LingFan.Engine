/**
 * editor 组合根接宿主代扫供给的接线互锁（源级判据，?raw 风格）：
 *
 * 组合根 main.ts 依赖真实工程打开与浏览器端口，不在单测里组装；这里锁「线接对了」：
 * - 唯一装载路径 loadFromSource 内接 fetchHostScan（FSA 句柄与目录快照两取径都经它）；
 * - 宿主探测懒执行一次缓存（probeHostOnce），宿主不在 ⇒ 不填字段（降级不报错）；
 * - 只有 ok:true 且 unmarked 在场才把 unmarkedHostTexts 并进诊断供给（契约只增不改）；
 * - 消费口（App.vue → analyzeStory）由 tests/editor/i18n-diagnostics-wiring.test.ts 锁。
 *
 * 端点行为与浏览器调用的降级语义由 tests/editor/server-host-scan.test.ts 锁。
 */
import { describe, expect, it } from "vitest";
import mainSource from "../../apps/editor/src/main.ts?raw";
import appSource from "../../apps/editor/src/App.vue?raw";
import contractsSource from "../../apps/editor/src/contracts/host.ts?raw";
import contractsIndexSource from "../../apps/editor/src/contracts/index.ts?raw";
import hostSource from "../../apps/editor/server/host.ts?raw";

/** 剥掉注释——判据只落在代码上，不被说明文字误满足 */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("组合根：供给接线", () => {
  it("loadFromSource 内经 probeHostOnce + fetchHostScan 补 unmarkedHostTexts", () => {
    const main = code(mainSource);
    expect(main).toContain("detectLocalHost");
    expect(main).toContain("fetchHostScan");
    // 懒探测一次缓存（不是每次打开都重新探测）
    expect(main).toContain("hostProbe ??= detectLocalHost()");
    expect(main).toContain("const host = await probeHostOnce()");
    // 请求带工程名（与 ProjectFileSource.name 同源）
    expect(main).toContain("fetchHostScan(host, source.name)");
    // 只有成功且带数据才填字段（宿主不在 / 拒绝 ⇒ 供给缺席，面板该节不显示）
    expect(main).toContain("scan?.ok && scan.unmarked !== undefined");
    expect(main).toContain("unmarkedHostTexts: scan.unmarked");
    // 并入是展开新对象（契约只增不改，不改动 loadDiagnosticSupply 的返回）
    expect(main).toContain("...diagnosticSupply");
  });

  it("两取径共用唯一装载路径（openHandle 与 fromFiles 都经 loadFromSource）", () => {
    const main = code(mainSource);
    const calls = main.match(/loadFromSource\(/g) ?? [];
    // 定义 1 处 + openHandle/fromFiles 各 1 处
    expect(calls.length).toBe(3);
  });

  it("浏览器侧不引创作期子入口（scan/authoring 只许 Node 宿主用）", () => {
    const main = code(mainSource);
    expect(main).not.toContain("@lingfan-engine/editor/scan");
    expect(main).not.toContain("@lingfan-engine/editor/authoring");
    const app = code(appSource);
    expect(app).not.toContain("@lingfan-engine/editor/scan");
    expect(app).not.toContain("@lingfan-engine/editor/authoring");
  });
});

describe("线上形状：契约只增不改", () => {
  it("contracts/host.ts 声明 HostScanRequest/HostScanResult 并经域出口转发", () => {
    const contracts = code(contractsSource);
    expect(contracts).toContain("interface HostScanRequest");
    expect(contracts).toContain("interface HostScanResult");
    expect(contracts).toContain("readonly project: string");
    expect(code(contractsIndexSource)).toContain("HostScanRequest");
    expect(code(contractsIndexSource)).toContain("HostScanResult");
  });

  it("Node 宿主只走子入口取扫描器与别名解析（零相对深引）", () => {
    const host = code(hostSource);
    expect(host).toContain('from "@lingfan-engine/editor/scan"');
    expect(host).toContain('from "@lingfan-engine/editor/authoring"');
    expect(host).not.toContain("packages/editor/src/scan");
    expect(host).not.toContain("packages/editor/src/cli");
    // 端点挂进既有鉴权分支链（token 校验之后）
    expect(host).toContain('action === "scan-host"');
  });
});
