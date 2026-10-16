/**
 * 四区骨架的**源级接线互锁**（防回流）。
 *
 * 为何用读源码断言而不全靠交互：骨架的关键性质是「**某能力必须接在某处**」
 * （资源树必须吃诊断供给、状态栏必须接脏计数、左栏 tab 必须驱动侧栏模式）。
 * 这些性质在界面上表现为「看起来对」，但一旦被拆掉，交互测试可能仍绿。
 *
 * 断言指向实现所在的文件：
 * App.vue 现为组合根（装配 + provide），业务域在 `app/`、纯判据在 `domain/`、
 * 平台取径在 `infra/`、全局样式在 `styles/`。本文件逐条核对的「找什么」不变，
 * 只改「去哪个文件找」。
 */
import { describe, expect, it } from "vitest";
// 本文件已列入 eslint.config.js「node-side-tooling」白名单（测试期工具，
// 不进浏览器产物；.css 的 ?raw 在 vitest css:false 下被 stub 成空串 ⇒ readFileSync）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import appSource from "../../apps/editor/src/App.vue?raw";
import treeSource from "../../apps/editor/src/domain/resourceTree.ts?raw";
import layoutSource from "../../apps/editor/src/infra/layout.ts?raw";
import filesSource from "../../apps/editor/src/app/useProjectFiles.ts?raw";
import searchSource from "../../apps/editor/src/app/useSearchCorpus.ts?raw";
import bridgeSource from "../../apps/editor/src/app/useHostBridge.ts?raw";
import openSource from "../../apps/editor/src/app/useProjectOpen.ts?raw";
import sidebarSource from "../../apps/editor/src/components/panes/SidebarPane.vue?raw";
import rightPaneSource from "../../apps/editor/src/components/panes/RightPane.vue?raw";
import centerSource from "../../apps/editor/src/components/panes/CenterStage.vue?raw";
import toolbarSource from "../../apps/editor/src/components/shell/TopToolbar.vue?raw";
// .css 的 `?raw` 导入在 vitest（css:false）下被 stub 成空串 ⇒ readFileSync 直读
const workspaceCss = readFileSync(
  join(process.cwd(), "apps/editor/src/styles/app-workspace.css"),
  "utf8",
);
import splitterSource from "../../apps/editor/src/components/shell/PaneSplitter.vue?raw";
import treeViewSource from "../../apps/editor/src/components/sidebar/ResourceTreeView.vue?raw";
import statusSource from "../../apps/editor/src/components/shell/StatusBar.vue?raw";
import columnListSource from "../../apps/editor/src/components/panels/ColumnList.vue?raw";
import nodeGraphSource from "../../apps/editor/src/components/stage/NodeGraph.vue?raw";
import timelineSource from "../../apps/editor/src/components/stage/StoryTimeline.vue?raw";
import fieldRowSource from "../../apps/editor/src/components/stage/FieldRow.vue?raw";

/** 去注释后再匹配（守卫对象是代码，不是注释里的字样） */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("四区骨架 · 接线互锁", () => {
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
    // 分栏条实例位于两块面板组件；@resize 仍由组合根接回宽度 setter
    expect(code(sidebarSource)).toContain('side="left"');
    expect(code(rightPaneSource)).toContain('side="right"');
    expect(code(appSource)).toContain('@resize="setLeftWidth"');
    expect(code(appSource)).toContain('@resize="setRightWidth"');
  });

  it("侧栏宽度由内联样式驱动（不写死在 CSS 里）", () => {
    expect(code(appSource)).toContain("layout.leftWidth");
    // 「不写死」的守卫位于两个全局样式文件
    expect(code(workspaceCss)).not.toMatch(
      /\.columns-pane\s*\{[^}]*width:\s*\d+px/,
    );
  });

  it("三个侧栏切面**共享同一份树**（不各持数据源）", () => {
    // 活动栏已删（与左栏 tab 重复）⇒「活动栏驱动侧栏模式」这半边不再存在；
    // 但**它守的不变量仍在** —— 资源/搜索/最近三个内页必须喂**同一个** resourceNodes，
    // 否则会逼出三份数据源（第二份定义）。
    const feeds =
      code(sidebarSource).match(/:nodes="props\.resourceNodes"/g) ?? [];
    expect(feeds.length).toBe(3);
    // 且不再有第二个驱动侧栏模式的入口
    expect(code(appSource)).not.toContain("setSidebarMode");
    expect(code(sidebarSource)).not.toContain("setSidebarMode");
  });

  it("状态栏接宿主能力与脏计数（工程级事实，不复制别处已有信息）", () => {
    expect(code(appSource)).toContain(':dirty-count="workspace.dirtyCount"');
    expect(code(appSource)).toContain(':local-host="localHostAvailable"');
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

  it("内页切换器有 tablist 语义与选中态（a11y）", () => {
    // **活动栏已删**（其三项与左栏 tab 重复），同一职责现由**左栏 tab** 承担
    //   ⇒ 本断言在 SidebarPane 的左栏 tab 条上验；顶栏视图切换在 TopToolbar。
    const sidebar = code(sidebarSource);
    const leftTabs = sidebar.slice(
      sidebar.indexOf('class="tab-strip left-tabs"'),
    );
    expect(leftTabs.slice(0, 400)).toContain('class="tab-strip left-tabs"');
    // 顶栏的视图切换补齐了 tab 语义
    expect(code(toolbarSource)).toContain('role="tablist"');
    expect(code(toolbarSource)).toContain("aria-selected");
    expect(sidebar).toContain("aria-selected");
    // 活动栏组件已随之删除
    expect(code(appSource)).not.toContain("ActivityBar");
    expect(sidebar).not.toContain("ActivityBar");
  });

  it("资源树对 Saves 只读且明示（不隐藏、明示只读）", () => {
    // 模型层只负责判定「只读」；「只读」徽标是**渲染**关注点，在组件里
    expect(code(treeSource)).toContain('kind === "saves"');
    expect(code(treeViewSource)).toContain("只读");
    // 且徽标须带「运行时产物」的解释，不只一个干巴巴的词
    expect(code(treeViewSource)).toContain("运行时产物");
  });
});

describe("回归 · 脏标记必须同时点亮工具栏与标签栏", () => {
  it("会话订阅回调里同时投影 `dirty` 与 `documentDirty`", () => {
    const src = code(filesSource);
    // bindActive 的订阅体 = 唯一会在「编辑动作」后触发的地方
    const sub = src.slice(
      src.indexOf("unsubscribeSession = doc.session.subscribe"),
    );
    expect(sub).toContain("dirty.value = doc.session.dirty");
    // 缺这一行 ⇒ 标签脏点永不亮（结构没变时结构订阅不会触发）
    expect(sub).toContain(
      "documentDirty.value = new Set(workspace.dirtyPaths)",
    );
  });

  it("bindActive 绑定完成时也投影一次（切标签即刷新该标签的脏态）", () => {
    const src = code(filesSource);
    const fn = src.slice(src.indexOf("function bindActive"));
    // 声明 `let unsubscribeSession` 现位于文件头部（组合根拆分时的机械迁移），
    // 原窗口边界改用 bindActive 之后的下一个函数，覆盖面与原先一致
    const tail = fn.slice(0, fn.indexOf("function attachSession"));
    const occurrences = (
      tail.match(/documentDirty\.value = new Set\(workspace\.dirtyPaths\)/g) ??
      []
    ).length;
    // 订阅回调内 1 次 + 绑定完成 1 次 = 2 次
    expect(occurrences).toBe(2);
  });

  it("工具栏与标签栏读的是**同一**事实源（`session.dirty` / `workspace.dirtyPaths`）", () => {
    const src = code(filesSource);
    expect(src).toContain("dirty.value = doc.session.dirty");
    expect(src).toContain(
      "documentDirty.value = new Set(workspace.dirtyPaths)",
    );
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
  const declaredBefore = (
    name: string,
    before: string,
    src: string,
  ): boolean => {
    const at = src.indexOf(`const ${name}`);
    const use = src.indexOf(before);
    return at >= 0 && use >= 0 && at < use;
  };

  it("documentDirty / documentPaths / documentKinds 声明在 bindActive 之前", () => {
    const src = code(filesSource);
    for (const name of ["documentDirty", "documentPaths", "documentKinds"]) {
      expect(declaredBefore(name, "function bindActive", src)).toBe(true);
    }
  });

  it("documentDirty 声明在 attachSession 首次调用之前（setup 中途会执行）", () => {
    const src = code(filesSource);
    expect(declaredBefore("documentDirty", "attachSession(session)", src)).toBe(
      true,
    );
  });

  it("resourcePaths 依赖的 diagnosticSupply 声明在 resourcePaths 之前", () => {
    const src = code(appSource);
    expect(declaredBefore("diagnosticSupply", "const resourcePaths", src)).toBe(
      true,
    );
  });

  it("layout / searchCorpus 声明在用它们的 computed 之前", () => {
    expect(declaredBefore("layout", "setLeftWidth", code(appSource))).toBe(
      true,
    );
    // 搜索语料域位于 useSearchCorpus，声明序守卫亦然
    expect(
      declaredBefore("searchCorpus", "const searchReport", code(searchSource)),
    ).toBe(true);
  });
});

/**
 * 回归 · 状态完备与「不用原生对话框」。
 */
describe("回归 · 原生对话框清零 + 五态接线", () => {
  it("编辑器组件里零原生 prompt/confirm/alert", () => {
    for (const [name, raw] of [
      ["ColumnList", columnListSource],
      ["NodeGraph", nodeGraphSource],
    ] as const) {
      const src = code(raw);
      // 守卫对象是**代码**（注释里提到 window.prompt 是正常的）
      expect(src, `${name} 仍用原生对话框`).not.toMatch(
        /[^.\w]window\.(prompt|confirm|alert)\s*\(/,
      );
      expect(src, `${name} 仍有裸 alert(`).not.toMatch(/(^|[^.\w])alert\s*\(/);
    }
  });

  it("行内操作常显低强调（可见性不靠鼠标）", () => {
    for (const [name, raw] of [
      ["ColumnList", columnListSource],
      ["StoryTimeline", timelineSource],
      ["FieldRow", fieldRowSource],
    ] as const) {
      const src = code(raw);
      // 三处一致：不再有 hover-only 的 display:none
      expect(src, `${name} 仍有 hover-only 行内操作`).not.toMatch(
        /\.(ops|row-ops)\s*\{[^}]*display:\s*none/,
      );
    }
    // 至少一处带常显 + 低强调 + hover 提升
    const timeline = code(timelineSource);
    expect(timeline).toMatch(
      /\.row-ops\s*\{[^}]*display:\s*inline-flex[^}]*opacity:/,
    );
    expect(timeline).toMatch(/:hover \.row-ops\s*\{[^}]*opacity:\s*1/);
  });

  it("首屏空态：未打开工程时显示空态", () => {
    // 空态模板位于 CenterStage；动作接线仍在组合根
    expect(code(centerSource)).toContain('reason="no-project"');
    expect(code(appSource)).toContain("onEmptyAction");
    // 主动作走真实取径
    expect(code(appSource)).toContain("openProject()");
  });

  it("读取失败在中心区如实展示（不再静默成空白）", () => {
    expect(code(appSource)).toContain("readError");
    expect(code(centerSource)).toMatch(/v-else-if="props\.readError"/);
  });

  it("对话框端口经 provide/inject 下发（组件零 props 下钻）", () => {
    const src = code(appSource);
    expect(src).toContain("provide(DIALOG_PORT_KEY, dialog)");
    expect(src).toContain("createDialogPort(dialogState)");
    expect(src).toContain("DialogHostState");
  });
});

/**
 * 回归 · 切标签必须同步 `selectedColumnId`。
 *
 * 现象：首次点某个 `doc-tab` ⇒ 中心区时间线**空白**；再点一次就正常。
 * 根因：切标签只换了 `story`（单列文档），`selectedColumnId` 却停在**上一个文档的列**；
 * 而 `StoryTimeline` 按 `props.story.columns.find(c => c.id === props.columnId)` 找列
 * ⇒ 在新 `story` 里找不到该列 ⇒ 渲染空。
 * "再点一次就好"是因为上一次的 `selectedColumnId` 恰好已等于目标列。
 */
describe("回归 · 切标签同步选中列", () => {
  it("`selectDocument` 里同步 `selectedColumnId` 到该文档的列", () => {
    const src = code(filesSource);
    const start = src.indexOf("function selectDocument(path: string): void {");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("\n}", start));
    expect(body).toContain("columnIdOfDocument(path)");
    expect(body).toMatch(/selectedColumnId\.value\s*=\s*columnId/);
  });

  it("同时清掉跨文档残留的命令选中态（指针会指向不存在的行）", () => {
    const src = code(filesSource);
    const start = src.indexOf("function selectDocument(path: string): void {");
    const body = src.slice(start, src.indexOf("\n}", start));
    expect(body).toMatch(/selectedPointer\.value\s*=\s*null/);
  });

  it("时间线按 `columnId` 在**当前 story** 里找列（这条前提不能变）", () => {
    expect(timelineSource).toMatch(
      /props\.story\.columns\.find\(\(c\)\s*=>\s*c\.id\s*===\s*props\.columnId\)/,
    );
  });

  it("非故事文档（译文表/清单）切标签**不动** `selectedColumnId`", () => {
    const src = code(filesSource);
    const start = src.indexOf("function selectDocument(path: string): void {");
    const body = src.slice(start, src.indexOf("\n}", start));
    // 判据必须走 `columnIdOfDocument`（非故事路径返回 undefined ⇒ 整段跳过）
    expect(body).toContain("if (columnId !== undefined)");
  });
});

/**
 * 热重载接线守卫（TDZ 高发点，成因是声明顺序）。
 * 判据：任何在 setup 体内被**提前执行**的代码，都不能引用声明在它之后的东西。
 * 宿主桥域（探测 / 轮询 / 打包转发）位于 `app/useHostBridge.ts`，本组断言对应该实现。
 */
describe("热重载 · 接线与顺序", () => {
  it("热重载三条声明在探测 IIFE **之前**（否则 TDZ 白屏）", () => {
    const src = bridgeSource;
    // 必须按**声明语句**定位，不能 `indexOf(名字)`：注释里也出现这个名字，
    //    首次命中会是注释 ⇒ 守卫变绿、实际有 TDZ（**假守卫**）。
    const probe = src.indexOf("const host = await detectLocalHost()");
    expect(probe, "探测 IIFE 位置变了").toBeGreaterThan(-1);
    for (const [name, decl] of [
      ["hotReloadEnabled", "const hotReloadEnabled = ref(true);"],
      ["hotReloadActive", "const hotReloadActive = ref(false);"],
      ["stopHotReload", "let stopHotReload: (() => void) | undefined;"],
    ] as const) {
      const at = src.indexOf(decl);
      expect(at, `${name} 的声明语句未找到（改名了？）`).toBeGreaterThan(-1);
      expect(at, `${name} 声明在探测 IIFE 之后 ⇒ TDZ 白屏`).toBeLessThan(probe);
    }
  });

  it("探测命中且开关开着 ⇒ 起轮询", () => {
    expect(bridgeSource).toContain("pollWatch(host");
    // 结构改成 if/else-if（探测失败走横幅，不再是 else 兜底）
    expect(bridgeSource).toContain(
      "if (host === undefined) hostHint.value = true;",
    );
    expect(bridgeSource).toContain(
      "if (hotReloadEnabled.value) startHotReload(host);",
    );
  });

  it("**脏文档时不自动重载**（静默重载会丢作者改动）", () => {
    // 判据本体在桥域内执行；「判据接在 workspace.dirtyCount 上」由组合根的
    // 依赖注入保证——两处分别锁定，拆开任何一半守卫都会掉
    expect(bridgeSource).toContain("dirtyCount() > 0");
    expect(code(appSource)).toContain("workspace.dirtyCount");
    expect(bridgeSource).toContain("未自动重载");
    // 重载走既有「重开工程」通道，不另造第二条
    expect(code(openSource)).toContain("entry.reopen()");
  });

  it("页面卸载停轮询（定时器不泄漏）", () => {
    expect(bridgeSource).toContain("onBeforeUnmount");
    expect(bridgeSource).toMatch(
      /onBeforeUnmount\(\(\) => \{[\s\S]*?stopHotReload\?\.\(\)/,
    );
  });
});

/**
 * 回归 · 「宿主未启动」提示**不得模态**。
 *
 * 用 `dialog.notify` 提示"宿主没起"时：`DialogHost` 的遮罩是
 * `position:absolute; inset:0` 的**全屏**层 ⇒ 不关掉就**挡住全部点击**，
 * 用户看到的现象是「**点故事没反应**」（而真因与故事毫无关系）。
 * 降级是"可用但能力受限"，**不该拦住操作** ⇒ 必须是 `pointer-events:none` 的横幅。
 */
describe("宿主未启动提示 · 非阻塞", () => {
  it("用**横幅**（`hostHint` 状态）而非 `dialog.notify`", () => {
    expect(bridgeSource).toContain(
      "if (host === undefined) hostHint.value = true;",
    );
    // 窗口只取**探测 IIFE 内部**（前面几百字符里有骨架生成等无关的 dialog.notify）
    const fnAt = bridgeSource.indexOf("const host = await detectLocalHost();");
    expect(fnAt).toBeGreaterThan(-1);
    // 窗口到**本 IIFE 结束**为止：用 `slice` + `indexOf` 会取到**全文件后面**
    //   （`indexOf` 找的是首次出现，可能在很后面）⇒ 混进别的 `dialog.notify`。
    //   这里直接按行数截 700 字符，够短且明确。
    const body = bridgeSource.slice(fnAt, fnAt + 700);
    expect(body).toContain("hostHint.value = true");
    expect(body).toContain("hostHint.value = true");
    // 必须**去注释**再判：说明文字里也写着「用 `dialog.notify`」，
    //    那是说明，不是代码（否则拿源码断言当代码断言）。
    const bodyCode = body
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(bodyCode).not.toContain("dialog.notify");
  });

  it("横幅 `pointer-events: none`，**只有关闭按钮**可点", () => {
    // 本守卫位于全局样式 app-workspace.css
    const rule = workspaceCss.match(/\.host-hint\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("pointer-events: none");
    const btn = workspaceCss.match(/\.host-hint-x\s*\{[^}]*\}/)?.[0] ?? "";
    expect(btn).toContain("pointer-events: auto");
  });

  it("横幅可关闭（`@click` 把 `hostHint` 置回 false）", () => {
    expect(code(appSource)).toContain('class="host-hint-x"');
    expect(code(appSource)).toContain('@click="hostHint = false"');
  });

  it("横幅文案给出**可执行**的启用命令（不是空话）", () => {
    // 编排脚本是"两个进程绑在一起"的保证；文案必须指向它
    expect(code(appSource)).toContain("pnpm editor:dev");
    // 说清**哪些能力不可用**（降级不等于全废）
    expect(code(appSource)).toContain("不可用");
  });
});

/**
 * 回归 · 能力探测必须在 `onMounted` 里。
 *
 * 现象：探测写成 setup 顶层的裸 `void (async () => …)()` 时，
 * **一次都没执行** —— CDP `Network` 域抓到启动期零请求，而同一份代码
 * 手动调用完全正常（返回 token）⇒ 模块求值时机不可靠。
 * `onMounted` 是"组件已挂载"的契约时刻，探测放这里可靠。
 */
describe("能力探测 · 触发时机", () => {
  it("探测在 `onMounted` 内（不是 setup 顶层的裸 IIFE）", () => {
    expect(bridgeSource).toMatch(
      /onMounted\(\(\) => \{\s*void \(async \(\) => \{[\s\S]*?detectLocalHost\(\)/,
    );
    // 顶层裸 IIFE 的形态（`void (async` 紧跟在 computed 之后、无 onMounted 包裹）不再允许
    expect(appSource).not.toMatch(
      /\nvoid \(async \(\) => \{\n\s*\/\/ 能力探测/,
    );
    expect(bridgeSource).not.toMatch(
      /\nvoid \(async \(\) => \{\n\s*\/\/ 能力探测/,
    );
  });

  it("探测命中 ⇒ 起热重载；未命中 ⇒ 显示**非阻塞横幅**", () => {
    expect(bridgeSource).toContain(
      "if (host === undefined) hostHint.value = true;",
    );
    expect(bridgeSource).toContain(
      "if (hotReloadEnabled.value) startHotReload(host);",
    );
  });
});
