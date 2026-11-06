/**
 * 模板历史面板接线：把「引擎已经有、模板没接」的那条链路锁进模板。
 *
 * 三层分开验，因为坏掉的方式不同：
 * - **装配层**（源码互锁）：`boot.ts` 有没有真的构造面板、挂上、末了拆掉；三处组合根
 *   有没有把槽位递进来。模板是交付物——装配漏一行，在用户工程里就是「历史面板明明
 *   写在页面里却不出按钮」，而单元测试跑不到 `bootHost`（它要 fetch、localStorage）。
 * - **语义层**：面板的点击真的翻译成 `engine.rollbackTo(块尾检查点)`，回溯后收起并
 *   调宿主收尾（媒体对齐）。这一层在 `history-panel.test.ts` 用假 DOM 跑，不重复。
 * - **契约层**：回溯之后引擎不会再给「刷新历史」的事件——`rollback.done` 不在模板的
 *   事件处理里，所以面板必须自己收起，靠下次展开重读。这条锁的是「别以为引擎会推」。
 *
 * 用 `?raw` 读源码、不碰 fs：`tests/template` 属前端域，禁 Node 导入。
 */
import { describe, expect, it } from "vitest";
import bootSource from "../../template/v1/__PROJECT__/src/host/boot.ts?raw";
import handleSource from "../../template/v1/__PROJECT__/src/host/index.ts?raw";
import layerSource from "../../template/v1/__PROJECT__/src/host/layer-z.ts?raw";
import wiringSource from "../../template/v1/__PROJECT__/src/host/engine-wiring.ts?raw";
import skeletonMain from "../../template/v1/__PROJECT__/src/main.ts?raw";
import vueMain from "../../template/v1/overlays/vue/src/main.ts?raw";
import reactMain from "../../template/v1/overlays/react/src/main.tsx?raw";
import skeletonHtml from "../../template/v1/__PROJECT__/index.html?raw";

/** 各形态的组合根（含骨架）：每份都得把 history 槽位递进宿主 */
const COMPOSITION_ROOTS: ReadonlyArray<readonly [string, string]> = [
  ["骨架 src/main.ts", skeletonMain],
  ["vue 叠加层", vueMain],
  ["react 叠加层", reactMain],
];

describe("模板历史面板接线 · 装配层（源码互锁）", () => {
  it("boot 构造面板、挂上它，并在拆除时拆掉", () => {
    expect(bootSource).toContain("createHistoryPanel(");
    expect(bootSource).toContain("historyPanel?.mount()");
    expect(bootSource).toContain("historyPanel?.destroy()");
  });

  it("**面板容器是可选选项**：只读槽位、不自己造节点（页面结构归组合根）", () => {
    // 选项字段存在且可为 null
    expect(bootSource).toContain("historyContainer?: HTMLElement | null");
    // 判空早退：没有槽位就完全不构造（而不是构造一个无容器的空面板）
    const at = bootSource.indexOf("const historyPanel =");
    expect(at).toBeGreaterThan(-1);
    const tail = bootSource.slice(at, at + 400);
    expect(tail).toContain("options.historyContainer === undefined");
    expect(tail).toContain("null");
    // 容器只来自 options，不由 boot 去 querySelector 造
    expect(bootSource).not.toContain('document.createElement("section")');
  });

  it("**面板拆卸排在偏好之后、渲染器之前**（先拆 UI，再停渲染器）", () => {
    const prefsAt = bootSource.lastIndexOf("prefsPanel?.destroy()");
    const historyAt = bootSource.lastIndexOf("historyPanel?.destroy()");
    const audioAt = bootSource.lastIndexOf("audio.dispose()");
    expect(prefsAt).toBeGreaterThan(-1);
    expect(historyAt).toBeGreaterThan(prefsAt);
    expect(audioAt).toBeGreaterThan(historyAt);
  });

  it("**回溯后媒体对齐由宿主显式补**（引擎只回状态，不下发端口动作）", () => {
    const at = bootSource.indexOf("createHistoryPanel(");
    const tail = bootSource.slice(at, at + 500);
    expect(tail).toContain("onRollback");
    // 对齐两路媒体：音频与视频各一次
    expect(tail).toContain("audio.sync()");
    expect(tail).toContain("video.sync()");
  });

  it("宿主出口转发面板与其类型（消费方只从 `./host` 取，不深入内部路径）", () => {
    expect(handleSource).toContain("createHistoryPanel");
    expect(handleSource).toContain("HistoryPanelOptions");
    expect(handleSource).toContain("./panels/history");
  });

  it("layer-z 写 history 层（槽位可选，所以判空）", () => {
    expect(layerSource).toContain('layer === "history"');
    expect(layerSource).toContain("dom.history");
  });
});

describe("模板历史面板接线 · 组合根与页面结构", () => {
  it("**三条组合根都把 history 槽位递进宿主**（漏一处 = 那个形态没有历史面板）", () => {
    for (const [label, source] of COMPOSITION_ROOTS) {
      expect(source, `${label}: 缺 historyContainer`).toContain(
        "historyContainer: dom.history",
      );
      expect(source, `${label}: 缺 optional("#history")`).toContain(
        'optional("#history")',
      );
    }
  });

  it("骨架页面有 #history 槽位（组合根取不到节点会静默退化成 null）", () => {
    expect(skeletonHtml).toContain('id="history"');
  });
});

describe("模板历史面板接线 · 契约事实（供后来人别猜）", () => {
  it("**rollback.done 不在模板事件处理里**：面板必须自己收起，等下次展开重读", () => {
    // 引擎确实发这个事件（`OutboundPayload` 里有），但模板的 `applyEvent` 只处理
    // engine.error / notify / minigame.mount / save.done / load.done——default 分支吞掉其余。
    // 所以「回溯完自动刷新列表」这件事没人在做，别指望它；面板的收起是本模块自己做的。
    expect(wiringSource).not.toContain("rollback.done");
  });

  it("HostControls 不含回溯（面板必须拿 StoryEngine，不是拿控制面）", () => {
    // 面板构造的入参是 engine（有 historyView/rollbackTo），不是 controls
    const at = bootSource.indexOf("createHistoryPanel(");
    const tail = bootSource.slice(at, at + 500);
    expect(tail).toContain("engine");
    expect(tail).not.toContain("controls");
  });
});
