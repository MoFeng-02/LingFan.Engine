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
