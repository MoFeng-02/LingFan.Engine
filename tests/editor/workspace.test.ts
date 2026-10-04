/**
 * 多文档会话模型：打开/激活/关闭的不变量 + 脏文档边界 + 路径身份。
 * 拟态旅程形态（模拟作者在多标签间来回改、只存一个、关掉另一个）。
 */
import { describe, expect, it } from "vitest";
import type { Story } from "@lingfan/engine";
import {
  columnIdOfDocument,
  storyDocumentPath,
  Workspace,
} from "../../apps/editor/src/workspace";

const storyOf = (id: string, text: string): Story => ({
  formatVersion: 1,
  id: "demo",
  entry: id,
  columns: [{ id, kind: "flow", commands: [{ op: "say", text }] }],
});

/** 拟态旅程：一串动作，返回末态（便于把「旅程」写成一个断言） */
function journey(ws: Workspace) {
  return {
    paths: ws.documents.map((d) => d.path),
    active: ws.activePath,
    dirty: ws.dirtyPaths,
    dirtyCount: ws.dirtyCount,
  };
}

describe("Workspace · 多文档会话", () => {
  it("打开多个文档：各自持有独立会话，初始全干净", () => {
    const ws = new Workspace();
    ws.open("Stories/start.json", "story", storyOf("start", "开场"));
    ws.open("Stories/tavern.json", "story", storyOf("tavern", "酒馆"));
    expect(journey(ws)).toEqual({
      paths: ["Stories/start.json", "Stories/tavern.json"],
      active: "Stories/tavern.json",
      dirty: [],
      dirtyCount: 0,
    });
  });

  it("拟态旅程：只存一个标签，另一个的脏标记不受影响（本模型存在的理由）", () => {
    const ws = new Workspace();
    ws.open("Stories/a.json", "story", storyOf("a", "甲"));
    ws.open("Stories/b.json", "story", storyOf("b", "乙"));
    // 在 a 上改一笔，在 b 上改一笔
    const docA = ws.get("Stories/a.json")!;
    const docB = ws.get("Stories/b.json")!;
    docA.session.commit("编辑甲", storyOf("a", "甲改"));
    docB.session.commit("编辑乙", storyOf("b", "乙改"));
    expect(ws.dirtyPaths).toEqual(["Stories/a.json", "Stories/b.json"]);

    // 保存 a：钉住基线 ⇒ a 干净，b 仍脏
    docA.session.markSaved();
    expect(ws.dirtyPaths).toEqual(["Stories/b.json"]);
    expect(ws.get("Stories/a.json")!.session.story.columns[0].commands).toEqual([
      { op: "say", text: "甲改" },
    ]);
    // 关键：b 的内容没被 a 的保存牵连
    expect(ws.get("Stories/b.json")!.session.story.columns[0].commands).toEqual([
      { op: "say", text: "乙改" },
    ]);
  });

  it("拟态旅程：撤销历史各自独立（一个标签里撤销不会动另一个）", () => {
    const ws = new Workspace();
    ws.open("Stories/a.json", "story", storyOf("a", "甲"));
    ws.open("Stories/b.json", "story", storyOf("b", "乙"));
    const a = ws.get("Stories/a.json")!.session;
    const b = ws.get("Stories/b.json")!.session;
    a.commit("改甲", storyOf("a", "甲1"));
    b.commit("改乙", storyOf("b", "乙1"));
    a.undo();
    expect(a.story.columns[0].commands).toEqual([{ op: "say", text: "甲" }]);
    expect(b.story.columns[0].commands).toEqual([{ op: "say", text: "乙1" }]);
    expect(b.canUndo).toBe(true);
  });

  it("重复打开同一路径：只激活，不新建（否则同文件两个 undo 栈会互相覆盖）", () => {
    const ws = new Workspace();
    const first = ws.open("Stories/a.json", "story", storyOf("a", "甲"));
    first.session.commit("改", storyOf("a", "甲改"));
    const again = ws.open("Stories/a.json", "story", storyOf("a", "另一个旧副本"));
    expect(again).toBe(first);
    expect(ws.documents).toHaveLength(1);
    // 未保存的改动没被"重新打开"冲掉
    expect(again.session.story.columns[0].commands).toEqual([
      { op: "say", text: "甲改" },
    ]);
  });

  it("关闭活动文档：活动位顺延到下一个；关最后一个则空", () => {
    const ws = new Workspace();
    ws.open("Stories/a.json", "story", storyOf("a", "甲"));
    ws.open("Stories/b.json", "story", storyOf("b", "乙"));
    ws.open("Stories/c.json", "story", storyOf("c", "丙"));
    expect(ws.activePath).toBe("Stories/c.json");
    ws.close("Stories/c.json");
    expect(ws.activePath).toBe("Stories/b.json");
    ws.close("Stories/b.json");
    expect(ws.activePath).toBe("Stories/a.json");
    ws.close("Stories/a.json");
    expect(ws.activePath).toBeUndefined();
    expect(ws.activeDocument).toBeUndefined();
    expect(ws.documents).toEqual([]);
  });

  it("canClose：脏文档必须先确认，干净的可直接关；未打开的路径不算可关", () => {
    const ws = new Workspace();
    const doc = ws.open("Stories/a.json", "story", storyOf("a", "甲"));
    expect(ws.canClose("Stories/a.json")).toBe(true);
    doc.session.commit("改", storyOf("a", "甲改"));
    expect(ws.canClose("Stories/a.json")).toBe(false);
    doc.session.undo();
    expect(ws.canClose("Stories/a.json")).toBe(true);
    // 未打开的路径 = 没有可关的东西（宿主不该拿它当"干净"去跳确认）
    expect(ws.canClose("Stories/zzz.json")).toBe(false);
  });

  it("容量上限：挤掉最早的干净文档；全脏则 fail-closed 拒绝（不静默丢改动）", () => {
    const ws = new Workspace([], 2);
    ws.open("Stories/a.json", "story", storyOf("a", "甲"));
    ws.open("Stories/b.json", "story", storyOf("b", "乙"));
    // a 干净 ⇒ 可被挤掉
    ws.open("Stories/c.json", "story", storyOf("c", "丙"));
    expect(ws.documents.map((d) => d.path)).toEqual([
      "Stories/b.json",
      "Stories/c.json",
    ]);
    // 两个都脏 ⇒ 再开必须拒绝
    ws.get("Stories/b.json")!.session.commit("改", storyOf("b", "乙改"));
    ws.get("Stories/c.json")!.session.commit("改", storyOf("c", "丙改"));
    expect(() => ws.open("Stories/d.json", "story", storyOf("d", "丁"))).toThrow(
      /上限 2/,
    );
    expect(ws.documents).toHaveLength(2);
  });

  it("订阅：每次结构变更通知一次快照（活动路径先落位、内容可后到）", () => {
    const ws = new Workspace();
    const seen: (string | undefined)[] = [];
    const off = ws.subscribe((s) => seen.push(s.activePath));
    ws.open("Stories/a.json", "story", storyOf("a", "甲"));
    ws.open("Stories/b.json", "story", storyOf("b", "乙"));
    // 懒加载接缝：先切标签，内容后到 —— 不要求该路径已打开
    ws.activate("Stories/not-loaded-yet.json");
    expect(ws.activePath).toBe("Stories/not-loaded-yet.json");
    expect(ws.activeDocument).toBeUndefined();
    off();
    ws.activate("Stories/a.json");
    expect(seen).toEqual([
      "Stories/a.json",
      "Stories/b.json",
      "Stories/not-loaded-yet.json",
    ]);
  });

  it("构造：可从种子批量打开，顺序即标签序", () => {
    const ws = new Workspace([
      { path: "Stories/a.json", kind: "story", story: storyOf("a", "甲") },
      { path: "Lang/zh.json", kind: "lang", story: storyOf("a", "") },
    ]);
    expect(ws.documents.map((d) => d.path)).toEqual([
      "Stories/a.json",
      "Lang/zh.json",
    ]);
    expect(ws.activePath).toBe("Lang/zh.json");
    // kind 各异保留（视图映射靠它）
    expect(ws.documents.map((d) => d.kind)).toEqual(["story", "lang"]);
  });

  it("非故事文档的 path 也能进（资源管理器不只管 .story）", () => {
    const ws = new Workspace();
    const media = ws.open("Audio/bgm.mp3", "media", storyOf("a", ""));
    expect(media.kind).toBe("media");
    expect(columnIdOfDocument("Audio/bgm.mp3")).toBeUndefined();
  });
});

describe("文档路径身份", () => {
  it("storyDocumentPath ⇄ columnIdOfDocument 互为逆运算", () => {
    for (const id of ["start", "tavern", "a-b_c", "列1"]) {
      expect(columnIdOfDocument(storyDocumentPath(id))).toBe(id);
    }
  });

  it("非故事文件与非 .json 后缀一律不猜（不剥后缀硬凑）", () => {
    expect(columnIdOfDocument("Stories/tavern.story")).toBeUndefined();
    expect(columnIdOfDocument("Lang/zh.json")).toBeUndefined();
    expect(columnIdOfDocument("Stories/.json")).toBeUndefined();
    expect(columnIdOfDocument("Stories/a/b.json")).toBe("a/b");
  });
});

describe("Workspace · 结构刷新（replaceClean）", () => {
  it("干净文档换基线：不产生 undo 单元，且保持干净", () => {
    const ws = new Workspace();
    const doc = ws.open("Stories/a.json", "story", storyOf("a", "甲"));
    const ok = ws.replaceClean("Stories/a.json", storyOf("a", "甲-重切"));
    expect(ok).toBe(true);
    expect(doc.session.story.columns[0].commands).toEqual([{ op: "say", text: "甲-重切" }]);
    expect(doc.session.dirty).toBe(false);
    // 关键：结构刷新不是用户编辑 ⇒ 撤销栈必须仍为空
    expect(doc.session.canUndo).toBe(false);
    expect(doc.session.undoDepth).toBe(0);
  });

  it("脏文档拒绝换基线：未保存改动与历史都不能被静默丢弃", () => {
    const ws = new Workspace();
    const doc = ws.open("Stories/a.json", "story", storyOf("a", "甲"));
    doc.session.commit("改", storyOf("a", "甲改"));
    const ok = ws.replaceClean("Stories/a.json", storyOf("a", "被覆盖"));
    expect(ok).toBe(false);
    expect(doc.session.story.columns[0].commands).toEqual([{ op: "say", text: "甲改" }]);
    expect(doc.session.dirty).toBe(true);
    // 仍可撤销回原处
    doc.session.undo();
    expect(doc.session.story.columns[0].commands).toEqual([{ op: "say", text: "甲" }]);
  });

  it("未打开的路径：拒绝（不静默新建）", () => {
    const ws = new Workspace();
    expect(ws.replaceClean("Stories/nope.json", storyOf("a", "甲"))).toBe(false);
    expect(ws.documents).toEqual([]);
  });

  it("结构刷新后各文档仍各自独立（一个刷新不牵连其他）", () => {
    const ws = new Workspace();
    ws.open("Stories/a.json", "story", storyOf("a", "甲"));
    const b = ws.open("Stories/b.json", "story", storyOf("b", "乙"));
    b.session.commit("改乙", storyOf("b", "乙改"));
    // a 干净 ⇒ 可刷新；b 脏 ⇒ 跳过（其改动保住）
    expect(ws.replaceClean("Stories/a.json", storyOf("a", "甲-重切"))).toBe(true);
    expect(ws.replaceClean("Stories/b.json", storyOf("b", "乙-重切"))).toBe(false);
    expect(ws.get("Stories/b.json")!.session.story.columns[0].commands).toEqual([
      { op: "say", text: "乙改" },
    ]);
  });
});
