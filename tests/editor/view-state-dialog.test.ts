/**
 * 五态模型 + 对话框状态机（纯逻辑，可测）。
 */
import { describe, expect, it } from "vitest";
import {
  createDialogPort,
  DialogHostState,
  parseTextAnswer,
  type DialogRequest,
} from "../../apps/editor/src/dialog";
import { emptyStateOf, viewStateOf } from "../../apps/editor/src/viewState";
import stageSource from "../../apps/editor/src/components/StageEditor.vue?raw";

describe("五态判定", () => {
  it("正常可读", () => {
    expect(viewStateOf({})).toBe("ready");
  });

  it("错误最优先：不被加载中/空掩盖", () => {
    expect(viewStateOf({ error: "读取失败", loading: true })).toBe("error");
    expect(viewStateOf({ error: "读取失败", empty: true })).toBe("error");
    expect(viewStateOf({ error: "x", readonly: true, dirty: true, loading: true, empty: true })).toBe("error");
  });

  it("加载中优先于空（内容还没到，不能说「没有内容」）", () => {
    expect(viewStateOf({ loading: true, empty: true })).toBe("loading");
  });

  it("空串 error 按失败处理（不谎报成功）", () => {
    expect(viewStateOf({ error: "" })).toBe("ready");
  });

  it("只读优先于空", () => {
    expect(viewStateOf({ readonly: true, empty: true })).toBe("readonly");
  });

  it("脏是附加徽标：ready + dirty 仍是 ready（内容可读）", () => {
    expect(viewStateOf({ dirty: true })).toBe("dirty");
    expect(viewStateOf({ dirty: true, empty: false })).toBe("dirty");
  });
});

describe("空态口径表", () => {
  it("未打开工程 ⇒ 主动作是「打开工程」（E5 重定：不是一行灰字）", () => {
    const s = emptyStateOf("no-project");
    expect(s.id).toBe("open-project");
    expect(s.primary).toBe(true);
    expect(s.label).toBe("打开工程");
  });

  it("无匹配 / 空文件 / 只读各有各的文案（不混成「暂无内容」）", () => {
    expect(emptyStateOf("no-matches").title).toBe("无匹配结果");
    expect(emptyStateOf("empty-resource").title).toBe("该资源为空文件");
    expect(emptyStateOf("read-only").id).toBe("open-external");
  });

  it("未知原因 ⇒ 保守兜底（不虚报动作）", () => {
    const s = emptyStateOf("who-knows");
    expect(s.id).toBe("none");
    expect(s.label).toBe("");
  });
});

describe("对话框 · askText 答案判据（D-58 正解）", () => {
  it("取消 = null ⇒ 不执行（这是 D-58 病根）", () => {
    expect(parseTextAnswer(null, true)).toEqual({ run: false });
    expect(parseTextAnswer(null, false)).toEqual({ run: false });
  });

  it("留空 = 执行但无值（allowEmpty 为真时）", () => {
    expect(parseTextAnswer("", true)).toEqual({ run: true, value: "" });
  });

  it("留空 = 不执行（allowEmpty 为假时，语义更严）", () => {
    expect(parseTextAnswer("", false)).toEqual({ run: false });
  });

  it("有值 ⇒ 执行并带值", () => {
    expect(parseTextAnswer("tavern", true)).toEqual({ run: true, value: "tavern" });
  });
});

describe("对话框栈 · 后进先出 + 嵌套", () => {
  const req = (title: string): DialogRequest => ({ kind: "notice", title, message: "x" });

  it("空栈 ⇒ current 为 undefined、depth 0", () => {
    const s = new DialogHostState();
    expect(s.current).toBeUndefined();
    expect(s.depth).toBe(0);
  });

  it("后进先出：confirm 里再 alert 不丢外层", () => {
    const s = new DialogHostState();
    s.open({ kind: "confirm", title: "删除列", message: "?" });
    s.open(req("入口列不可删除"));
    expect(s.current).toMatchObject({ title: "入口列不可删除" });
    expect(s.depth).toBe(2);
    s.close();
    expect(s.current).toMatchObject({ title: "删除列" });
    expect(s.depth).toBe(1);
  });

  it("closeAll 清空（换工程/新建时避免残留弹窗）", () => {
    const s = new DialogHostState();
    s.open(req("a"));
    s.open(req("b"));
    s.closeAll();
    expect(s.current).toBeUndefined();
    expect(s.depth).toBe(0);
  });

  it("close 空栈不崩（幂等）", () => {
    const s = new DialogHostState();
    expect(() => {
      s.close();
      s.close();
    }).not.toThrow();
  });
});

/**
 * **回归锚定（真机探针逮到的真缺陷）**：`ask` 的结算器曾只有一个槽位。
 *
 * 症状：挂起框未关时再开一个框 ⇒ ① 前一个 Promise **永久挂起**（调用方 `await`
 * 永不返回）② `answer()` 只弹一帧 ⇒ **框留在栈顶、全屏遮罩永久挡住所有点击**
 * （用户现象是「点什么都没反应」，与提示内容毫无关系 —— 与「给降级提示别用模态
 * 对话框」是同型坑的两种成因）。
 */
describe("对话框栈 · **并发 ask 不丢不吊**（用户实测回归）", () => {
  const req = (title: string): DialogRequest => ({ kind: "notice", title, message: "x" });

  it("两次 ask 都挂起 ⇒ 回答两次后**两个 Promise 都结算**、栈归零", async () => {
    const s = new DialogHostState();
    const first = s.ask(req("第一"));
    const second = s.ask(req("第二"));
    expect(s.depth).toBe(2);
    expect(s.current).toMatchObject({ title: "第二" });

    s.answer(undefined);
    expect(await second).toBeUndefined();
    expect(s.depth).toBe(1);

    s.answer(undefined);
    expect(await first).toBeUndefined();
    // 🔴 核心判据：栈必须归零（否则遮罩永久残留）
    expect(s.depth).toBe(0);
    expect(s.current).toBeUndefined();
  });

  it("**框关掉后不再挡点击**（depth 归零 ⇔ 遮罩消失）", () => {
    const s = new DialogHostState();
    void s.ask(req("a"));
    void s.ask(req("b"));
    s.answer(undefined);
    s.answer(undefined);
    // 组件是 `v-if="request"` ⇒ depth 0 即遮罩不在 DOM
    expect(s.current).toBeUndefined();
  });

  it("**closeAll 结算所有挂起者**（不留悬挂 Promise）", async () => {
    const s = new DialogHostState();
    const a = s.ask(req("a"));
    const b = s.ask(req("b"));
    s.closeAll();
    expect(await a).toBeNull();
    expect(await b).toBeNull();
    expect(s.depth).toBe(0);
  });

  it("**closeAll 后新开的框能正常关**（结算回调续行不再残留遮罩）", async () => {
    const s = new DialogHostState();
    const a = s.ask(req("a"));
    s.closeAll();
    await a;
    // 续行里再开一框（真实场景：await 之后弹错误提示）
    const b = s.ask(req("b"));
    expect(s.depth).toBe(1);
    s.answer(undefined);
    expect(await b).toBeUndefined();
    expect(s.depth).toBe(0);
  });
});

describe("对话框 · Promise 端口结算", () => {
  it("askText 取消 ⇒ 解析为 `null`（与「留空」严格区分）", async () => {
    const s = new DialogHostState();
    const port = createDialogPort(s);
    const pending = port.askText({ title: "新建分组" });
    s.answer(null);
    expect(await pending).toBeNull();
    expect(s.current).toBeUndefined();
  });

  it("askText 留空 ⇒ 解析为空串（执行但无值）", async () => {
    const s = new DialogHostState();
    const port = createDialogPort(s);
    const pending = port.askText({ title: "新建分组" });
    s.answer("");
    expect(await pending).toBe("");
  });

  it("askConfirm 确定/取消 ⇒ true/false", async () => {
    const s = new DialogHostState();
    const port = createDialogPort(s);
    const a = port.askConfirm({ title: "删除列", message: "?" });
    s.answer(true);
    expect(await a).toBe(true);

    const b = port.askConfirm({ title: "删除列", message: "?" });
    s.cancel();
    expect(await b).toBe(false);
  });

  it("notify 无取消语义，结算为 undefined", async () => {
    const s = new DialogHostState();
    const port = createDialogPort(s);
    const pending = port.notify({ title: "入口列不可删除", message: "…" });
    expect(s.current).toMatchObject({ kind: "notice" });
    s.answer(undefined);
    await expect(pending).resolves.toBeUndefined();
  });

  it("cancel() 对文本框传 `null`、对确认框传 `false`", async () => {
    const s = new DialogHostState();
    const port = createDialogPort(s);
    const a = port.askText({ title: "t" });
    s.cancel();
    expect(await a).toBeNull();

    const b = port.askConfirm({ title: "c", message: "m" });
    s.cancel();
    expect(await b).toBe(false);
  });

  it("closeAll 清栈并把挂起者以取消结算（不留悬挂 Promise）", async () => {
    const s = new DialogHostState();
    const port = createDialogPort(s);
    const pending = port.askText({ title: "t" });
    s.closeAll();
    expect(await pending).toBeNull();
    expect(s.current).toBeUndefined();
  });

  it("订阅栈变化（宿主驱动渲染）", () => {
    const s = new DialogHostState();
    let fired = 0;
    const off = s.subscribe(() => fired++);
    s.ask({ kind: "notice", title: "a", message: "m" });
    s.answer(undefined);
    off();
    s.ask({ kind: "notice", title: "b", message: "m" });
    expect(fired).toBe(2); // 开框 + 回答各一次；退订后不再触发
  });
});

/**
 * 回归 · 空态**必须有可点的下一步**（B3 立的纪律）。
 *
 * CDP UI 审阅实测抓到：舞台在「选中 flow 列」时的空态占 **1029×785**（80 万像素），
 * 却只有一行说明、**`可点动作数 = 0`** ⇒ 大片空白 + 无出路，用户只能猜下一步。
 * 这条纪律当时是我自己写的，**自己没做到**。
 */
describe("空态纪律 · 必须给可点动作", () => {
  it("舞台两类空态走 `EmptyState`（而非只有说明文字）", () => {
    expect(stageSource).toContain('reason="no-scene-column"');
    expect(stageSource).toContain('reason="no-elements"');
    // 旧的「只有说明」写法不得残留
    expect(stageSource).not.toContain("选中一个 <code>scene</code> 列后");
  });

  it("口径表有这两类空态，且**都给了动作或明确去处**", () => {
    const noScene = emptyStateOf("no-scene-column");
    expect(noScene.id).toBe("goto-scene-column");
    expect(noScene.primary).toBe(true);
    expect(noScene.label).toBe("去选一个场景列");
    const noEle = emptyStateOf("no-elements");
    expect(noEle.title).toBe("该场景列还没有元素");
    expect(noEle.hint).toContain("组件");
  });

  it("动作语义专用（**不复用** `open-project`——那是「打开工程」）", () => {
    expect(stageSource).toContain('action.id !== "goto-scene-column"');
    // 2026-10-05 治根：导航走**工程级首场景列**（App 经 prop 传入；切片里 findIndex 是死动作）
    expect(stageSource).toContain("api.selectColumn(id)");
  });

  it("一个 scene 列都没有时**不给假出路**（按钮点了没反应比不给更糟）", () => {
    // 工程级事实由宿主传入；宿主给不出（工程无 scene 列）⇒ 原地不动，不造半个导航
    expect(stageSource).toContain('if (id === undefined || id === null || id === "") return;');
  });
});
