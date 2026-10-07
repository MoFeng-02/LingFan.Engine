/**
 * 舞台 / 资源树 / 文档标签的**接线互锁**。
 *
 * 真实工程（`.story` 多列形态）暴露过四类问题：
 * ① 选中的场景列在舞台误报「没有空间层」且无元素可拖（同根）；
 * ② 资源树点了折叠没反应（状态非响应式）且不能定位当前打开；
 * ③ 点 `.story` 文件无反应（文档路径与磁盘路径不同族）；
 * ④ 文档标签无任何关闭途径。
 * 本守卫锁「修复真的接在正确的位置」——判据绿 ≠ 能力可用。
 */
import { describe, expect, it } from "vitest";
import appSource from "../../apps/editor/src/App.vue?raw";
import stageSource from "../../apps/editor/src/components/StageEditor.vue?raw";
import treeSource from "../../apps/editor/src/components/ResourceTreeView.vue?raw";

/** 去注释后再匹配（守卫对象是代码，不是注释里的字样） */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("舞台当前列 · 接线互锁", () => {
  it("当前列 = **活动文档切片首列**，不得从选中指针反解", () => {
    const src = code(stageSource);
    expect(src).toContain("props.story.columns[0]");
    // 反面：pointer 为 null 时舞台必须有列（挂在 pointer 上会漏）
    expect(src).not.toContain("const pointer = props.pointer");
    expect(src).not.toContain("if (pointer === null) return undefined");
  });

  it("空态动作的导航目标 = **宿主传入的工程级首场景列**（切片内 findIndex 是死动作）", () => {
    const src = code(stageSource);
    expect(src).toContain("props.firstSceneColumnId");
    expect(src).toContain("api.selectColumn(id)");
    // 反面：切片里找 scene 列 = 永远找不到（切片恒单列）
    expect(src).not.toContain('columns.findIndex((c) => c.kind === "scene")');
  });

  it("App 把工程级首场景列传给舞台", () => {
    expect(code(appSource)).toContain(":first-scene-column-id=");
  });
});

describe("资源树折叠与定位 · 接线互锁", () => {
  it("折叠态必须是 **ref**（裸 Set 不被 Vue 追踪 ⇒ 点了永不重渲染）", () => {
    const src = code(treeSource);
    expect(src).toMatch(/collapsed = ref<ReadonlySet<string>>/);
    // 反面：非响应式 Set（病根）
    expect(src).not.toContain("const collapsed = new Set");
  });

  it("**定位当前打开**：watch activePath ⇒ 展开祖先 + scrollIntoView + data-path 锚点", () => {
    const src = code(treeSource);
    expect(src).toMatch(/watch\(\s*\(\) => props\.activePath/);
    expect(src).toContain("scrollIntoView");
    expect(src).toContain(':data-path="row.node.path"');
  });

  it("App 传给资源树的定位路径是**磁盘事实**（sourcePath 优先；合成路径对 .story 永不命中）", () => {
    const src = code(appSource);
    expect(src).toContain(':active-path="resourceFocusPath"');
    expect(src).toContain("column.sourcePath");
  });

  it("定位路径吃**响应式投影** activeDocumentPath（workspace 非响应式——computed 读它永不重算）", () => {
    const src = code(appSource);
    expect(src).toContain("const activeDocumentPath = ref<string | undefined>(workspace.activePath)");
    // 反面：computed 里直接读 workspace.activePath = 挂载初值卡死
    const computed = src.slice(src.indexOf("const resourceFocusPath"));
    expect(computed.slice(0, 700)).not.toContain("workspace.activePath");
  });
});

describe("`.story` 文件打开 · 接线互锁", () => {
  it("openResource 的 story 分支带 **sourcePath 反查兜底**（后缀门只认 .json）", () => {
    const src = code(appSource);
    expect(src).toContain("firstColumnIdOfSourcePath(");
    // 反面：静默 return（点了没反应）⇒ 未命中必须给可操作提示
    expect(src).toContain("该故事文件没有可打开的场景");
  });

  it("文档身份恒 = storyDocumentPath(columnId)（**不是磁盘文件路径**——身份不变量）", () => {
    // 回归：用 .story 文件路径开档 ⇒ 标签名错 + redistribute 身份失配
    const src = code(appSource);
    const branch = src.slice(src.indexOf("const docPath = storyDocumentPath(columnId)"));
    expect(branch.slice(0, 500)).toContain('workspace.open(docPath, "story"');
    expect(branch).toContain("selectDocument(docPath)");
  });
});

describe("文档标签关闭 · 接线互锁", () => {
  it("标签有 **✕ 与中键**两条关闭途径，脏文档先确认", () => {
    const src = code(appSource);
    expect(src).toContain('class="doc-tab-close"');
    expect(src).toContain("@auxclick.middle.prevent=");
    expect(src).toContain("workspace.canClose(path)");
    expect(src).toContain("askConfirm");
  });

  it("关闭后同步选中列（停在**被关列** ⇒ 时间线空白的同类问题）", () => {
    const src = code(appSource);
    const block = src.slice(src.indexOf("async function closeDocument"));
    expect(block.slice(0, 900)).toContain("selectDocument(workspace.activePath)");
  });
});
