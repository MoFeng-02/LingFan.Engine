/**
 * B1 四区骨架的**源级接线互锁**（防回流）。
 *
 * 为何用读源码断言而不全靠交互：骨架的关键性质是「**某能力必须接在某处**」
 * （资源树必须吃诊断供给、状态栏必须接脏计数、活动栏必须驱动侧栏模式）。
 * 这些性质在真机上表现为「看起来对」，但一旦被拆掉，交互测试可能仍绿。
 */
import { describe, expect, it } from "vitest";
import appSource from "../../apps/editor/src/App.vue?raw";
import treeSource from "../../apps/editor/src/resourceTree.ts?raw";
import layoutSource from "../../apps/editor/src/layout.ts?raw";
import splitterSource from "../../apps/editor/src/components/PaneSplitter.vue?raw";
import activitySource from "../../apps/editor/src/components/ActivityBar.vue?raw";
import treeViewSource from "../../apps/editor/src/components/ResourceTreeView.vue?raw";
import statusSource from "../../apps/editor/src/components/StatusBar.vue?raw";
import columnListSource from "../../apps/editor/src/components/ColumnList.vue?raw";
import nodeGraphSource from "../../apps/editor/src/components/NodeGraph.vue?raw";
import timelineSource from "../../apps/editor/src/components/StoryTimeline.vue?raw";
import fieldRowSource from "../../apps/editor/src/components/FieldRow.vue?raw";

/** 去注释后再匹配（守卫对象是代码，不是注释里的字样） */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("B1 四区骨架 · 接线互锁", () => {
  it("资源树吃的是诊断供给的资源文件集（零新增 IO 复用既有供给）", () => {
    expect(code(appSource)).toContain("diagnosticSupply.value?.resourceFiles");
    expect(code(appSource)).toContain("buildResourceTree(");
  });

  it("布局状态经 createLayoutStore 持久化，且键与工程无关（布局属应用不属工程）", () => {
    expect(code(appSource)).toContain("createLayoutStore(");
    expect(code(appSource)).toContain("layoutStore.save(layout)");
    expect(code(layoutSource)).toContain("lingfan-editor-layout");
  });

  it("两处分栏条都接了 resize 回调（拖拽真的能改宽度）", () => {
    const src = code(appSource);
    expect(src).toContain('side="left"');
    expect(src).toContain('side="right"');
    expect(src).toContain("@resize=\"setLeftWidth\"");
    expect(src).toContain("@resize=\"setRightWidth\"");
  });

  it("侧栏宽度由内联样式驱动（不写死在 CSS 里）", () => {
    expect(code(appSource)).toContain("layout.leftWidth");
    // CSS 里不得再有写死的侧栏宽度
    expect(code(appSource)).not.toMatch(/\.columns-pane\s*\{[^}]*width:\s*\d+px/);
  });

  it("活动栏驱动侧栏模式（三个切面共享同一份树，不各持数据源）", () => {
    expect(code(appSource)).toContain("@update:mode=\"setSidebarMode\"");
    expect(code(appSource)).toContain("setSidebarMode(mode: SidebarMode)");
    // 三个内页都喂**同一个** resourceNodes
    const feeds = code(appSource).match(/:nodes="resourceNodes"/g) ?? [];
    expect(feeds.length).toBe(3);
  });

  it("状态栏接宿主能力与脏计数（工程级事实，不复制别处已有信息）", () => {
    expect(code(appSource)).toContain(":dirty-count=\"workspace.dirtyCount\"");
    expect(code(appSource)).toContain(":local-host=\"localHostAvailable\"");
    expect(code(statusSource)).toContain("localHost");
  });

  it("诊断吃整工程树而非活动标签切片（跨列引用不得误报）", () => {
    expect(code(appSource)).toContain("projectTree.value ?? story.value");
  });

  it("分栏条：pointer capture + 释放前查引用（拖拽中卸载不抛）", () => {
    expect(code(splitterSource)).toContain("setPointerCapture");
    expect(code(splitterSource)).toContain("isConnected");
  });

  it("分栏条有键盘通路（拖拽不是唯一入口，a11y）", () => {
    expect(code(splitterSource)).toContain("tabindex");
    expect(code(splitterSource)).toContain("ArrowRight");
    expect(code(splitterSource)).toContain('role="separator"');
  });

  it("活动栏有 tablist 语义与选中态（a11y）", () => {
    expect(code(activitySource)).toContain('role="tablist"');
    expect(code(activitySource)).toContain("aria-selected");
  });

  it("资源树对 Saves 只读且明示（不隐藏、不假装能编辑）", () => {
    // 模型层只负责判定「只读」；「只读」徽标是**渲染**关注点，在组件里
    expect(code(treeSource)).toContain('kind === "saves"');
    expect(code(treeViewSource)).toContain("只读");
    // 且徽标须带「运行时产物」的解释，不只一个干巴巴的词
    expect(code(treeViewSource)).toContain("运行时产物");
  });
});

describe("B0 回归 · 脏标记必须同时点亮工具栏与标签栏", () => {
  it("会话订阅回调里同时投影 `dirty` 与 `documentDirty`", () => {
    const src = code(appSource);
    // bindActive 的订阅体 = 唯一会在「编辑动作」后触发的地方
    const sub = src.slice(src.indexOf("unsubscribeSession = doc.session.subscribe"));
    expect(sub).toContain("dirty.value = doc.session.dirty");
    // ⚠️ 缺这一行 ⇒ 标签脏点永不亮（结构没变时结构订阅不会触发）
    expect(sub).toContain("documentDirty.value = new Set(workspace.dirtyPaths)");
  });

  it("bindActive 绑定完成时也投影一次（切标签即刷新该标签的脏态）", () => {
    const src = code(appSource);
    const fn = src.slice(src.indexOf("function bindActive"));
    const tail = fn.slice(0, fn.indexOf("let unsubscribeSession"));
    const occurrences = (tail.match(/documentDirty\.value = new Set\(workspace\.dirtyPaths\)/g) ?? []).length;
    // 订阅回调内 1 次 + 绑定完成 1 次 = 2 次
    expect(occurrences).toBe(2);
  });

  it("工具栏与标签栏读的是**同一**事实源（`session.dirty` / `workspace.dirtyPaths`）", () => {
    const src = code(appSource);
    expect(src).toContain("dirty.value = doc.session.dirty");
    expect(src).toContain("documentDirty.value = new Set(workspace.dirtyPaths)");
  });
});

/**
 * TDZ 守卫：**只在运行时现形的白屏**（`vue-tsc` 与 lint 都抓不到）。
 *
 * 两次真实事故：
 * ① `watch(某 computed)` 会立即求值源，而源依赖的 ref 声明在靠后处 ⇒ 白屏；
 * ② `bindActive` 在 setup 中途被 `attachSession` 调用，它读 `documentDirty`，
 *    而该 ref 声明在其后 ⇒ 白屏。
 *
 * 共同的形状：**在 setup 体内被「提前」执行/调用的代码，引用了声明在后的东西**。
 * 静态检查抓不到，只能靠「声明顺序 + 首次调用位置」的机械核对。
 */
describe("TDZ 守卫 · 声明顺序", () => {
  /** @param name 变量名 @param before 必须在它之前的标记（按源码位置） */
  const declaredBefore = (name: string, before: string, src: string): boolean => {
    const at = src.indexOf(`const ${name}`);
    const use = src.indexOf(before);
    return at >= 0 && use >= 0 && at < use;
  };

  it("documentDirty / documentPaths / documentKinds 声明在 bindActive 之前", () => {
    const src = code(appSource);
    for (const name of ["documentDirty", "documentPaths", "documentKinds"]) {
      expect(declaredBefore(name, "function bindActive", src)).toBe(true);
    }
  });

  it("documentDirty 声明在 attachSession 首次调用之前（setup 中途会执行）", () => {
    const src = code(appSource);
    expect(declaredBefore("documentDirty", "attachSession(session)", src)).toBe(true);
  });

  it("resourcePaths 依赖的 diagnosticSupply 声明在 resourcePaths 之前", () => {
    const src = code(appSource);
    expect(declaredBefore("diagnosticSupply", "const resourcePaths", src)).toBe(true);
  });

  it("layout / searchCorpus 声明在用它们的 computed 之前", () => {
    const src = code(appSource);
    expect(declaredBefore("layout", "setLeftWidth", src)).toBe(true);
    expect(declaredBefore("searchCorpus", "const searchReport", src)).toBe(true);
  });
});

/**
 * B3 回归 · 状态完备与「不用原生对话框」。
 */
describe("B3 回归 · 原生对话框清零 + 五态接线", () => {
  it("编辑器组件里零原生 prompt/confirm/alert（D-62①）", () => {
    for (const [name, raw] of [
      ["ColumnList", columnListSource],
      ["NodeGraph", nodeGraphSource],
    ] as const) {
      const src = code(raw);
      // 守卫对象是**代码**（注释里提到 window.prompt 是正常的）
      expect(src, `${name} 仍用原生对话框`).not.toMatch(/[^.\w]window\.(prompt|confirm|alert)\s*\(/);
      expect(src, `${name} 仍有裸 alert(`).not.toMatch(/(^|[^.\w])alert\s*\(/);
    }
  });

  it("行内操作常显低强调（E2：可见性不靠鼠标）", () => {
    for (const [name, raw] of [
      ["ColumnList", columnListSource],
      ["StoryTimeline", timelineSource],
      ["FieldRow", fieldRowSource],
    ] as const) {
      const src = code(raw);
      // 三处同款：不再有 hover-only 的 display:none
      expect(src, `${name} 仍有 hover-only 行内操作`).not.toMatch(
        /\.(ops|row-ops)\s*\{[^}]*display:\s*none/,
      );
    }
    // 至少一处带常显 + 低强调 + hover 提升
    const timeline = code(timelineSource);
    expect(timeline).toMatch(/\.row-ops\s*\{[^}]*display:\s*inline-flex[^}]*opacity:/);
    expect(timeline).toMatch(/:hover \.row-ops\s*\{[^}]*opacity:\s*1/);
  });

  it("首屏空态：未打开工程时不假装有工程（E5 重定）", () => {
    const src = code(appSource);
    expect(src).toContain('reason="no-project"');
    expect(src).toContain("onEmptyAction");
    // 主动作走真实取径
    expect(src).toContain("openProject()");
  });

  it("读取失败在中心区如实展示（不再静默成空白）", () => {
    const src = code(appSource);
    expect(src).toContain("readError");
    expect(src).toMatch(/v-else-if="readError"/);
  });

  it("对话框端口经 provide/inject 下发（组件零 props 下钻）", () => {
    const src = code(appSource);
    expect(src).toContain("provide(DIALOG_PORT_KEY, dialog)");
    expect(src).toContain("createDialogPort(dialogState)");
    expect(src).toContain("DialogHostState");
  });
});

/**
 * B0 回归 · 切标签必须同步 `selectedColumnId`（真机实测缺陷）。
 *
 * 现象：首次点某个 `doc-tab` ⇒ 中心区时间线**空白**；再点一次就正常。
 * 根因：切标签只换了 `story`（单列文档），`selectedColumnId` 却停在**上一个文档的列**；
 * 而 `StoryTimeline` 按 `props.story.columns.find(c => c.id === props.columnId)` 找列
 * ⇒ 在新 `story` 里找不到该列 ⇒ 渲染空。
 * "再点一次就好"是因为上一次的 `selectedColumnId` 恰好已等于目标列。
 */
describe("B0 回归 · 切标签同步选中列", () => {
  it("`selectDocument` 里同步 `selectedColumnId` 到该文档的列", () => {
    const src = code(appSource);
    const start = src.indexOf("function selectDocument(path: string): void {");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("\n}", start));
    expect(body).toContain("columnIdOfDocument(path)");
    expect(body).toMatch(/selectedColumnId\.value\s*=\s*columnId/);
  });

  it("同时清掉跨文档残留的命令选中态（指针会指向不存在的行）", () => {
    const src = code(appSource);
    const start = src.indexOf("function selectDocument(path: string): void {");
    const body = src.slice(start, src.indexOf("\n}", start));
    expect(body).toMatch(/selectedPointer\.value\s*=\s*null/);
  });

  it("时间线按 `columnId` 在**当前 story** 里找列（这条前提不能变）", () => {
    expect(timelineSource).toMatch(/props\.story\.columns\.find\(\(c\)\s*=>\s*c\.id\s*===\s*props\.columnId\)/);
  });

  it("非故事文档（译文表/清单）切标签**不动** `selectedColumnId`", () => {
    const src = code(appSource);
    const start = src.indexOf("function selectDocument(path: string): void {");
    const body = src.slice(start, src.indexOf("\n}", start));
    // 判据必须走 `columnIdOfDocument`（非故事路径返回 undefined ⇒ 整段跳过）
    expect(body).toContain("if (columnId !== undefined)");
  });
});
