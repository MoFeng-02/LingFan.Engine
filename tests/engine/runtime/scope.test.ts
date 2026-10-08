/** 作用域树测试（嵌套生命周期 / 声明层语义） */
import { describe, expect, it } from "vitest";
import { Scope } from "../../../packages/engine/src/runtime/scope";

describe("Scope（块 → 列 → 全局 链）", () => {
  it("父链查找：全局声明块内可见", () => {
    const column = Scope.root();
    column.declare("gold", 100);
    const block = column.enterChild();
    expect(block.lookup("gold")).toEqual({ found: true, value: 100 });
  });

  it("子层声明遮蔽父层，父层不受影响", () => {
    const column = Scope.root();
    column.declare("x", 1);
    const block = column.enterChild();
    block.declare("x", 2);
    expect(block.lookup("x")).toEqual({ found: true, value: 2 });
    expect(column.lookup("x")).toEqual({ found: true, value: 1 });
  });

  it("assignExisting 写入声明时所在层（块级作用域语义）", () => {
    const column = Scope.root();
    column.declare("x", 1);
    const block = column.enterChild();
    expect(block.assignExisting("x", 99)).toBe(true);
    expect(column.lookup("x")).toEqual({ found: true, value: 99 });
    expect(block.hasOwn("x")).toBe(false); // 写的是列层，不是块层
  });

  it("assignExisting 未声明 → false", () => {
    const column = Scope.root();
    expect(column.assignExisting("ghost", 1)).toBe(false);
  });

  it("undef 沿父链删除声明槽；上层不可见下层", () => {
    const column = Scope.root();
    column.declare("g", 1);
    const block = column.enterChild();
    block.declare("b", 2);
    expect(block.undef("g")).toBe(true);
    expect(column.lookup("g")).toEqual({ found: false });
    expect(column.undef("b")).toBe(false); // 父作用域看不到子层声明
    expect(block.undef("b")).toBe(true);
  });

  it("出块销毁：丢弃块作用域后其声明不可达（生命周期）", () => {
    const column = Scope.root();
    {
      const block = column.enterChild();
      block.declare("tmp", 1);
      expect(block.lookup("tmp").found).toBe(true);
    }
    // 列作用域继续使用：tmp 不可见
    expect(column.lookup("tmp")).toEqual({ found: false });
  });

  it("多级链：块 → 列逐级上溯", () => {
    const column = Scope.root();
    column.declare("a", "column");
    const block1 = column.enterChild();
    block1.declare("b", "block1");
    const block2 = block1.enterChild();
    expect(block2.lookup("a")).toEqual({ found: true, value: "column" });
    expect(block2.lookup("b")).toEqual({ found: true, value: "block1" });
  });
});

describe("Scope 链快照与原子回滚（snapshotChain / restoreChain）", () => {
  it("回滚恢复各层变量（含新增、改写、删除）", () => {
    const column = Scope.root();
    column.declare("keep", 1);
    const block = column.enterChild();
    block.declare("temp", 2);

    const snapshot = block.snapshotChain();
    // 变更：改写父层值 / 改写本层值 / 新增 / 删除
    column.assignExisting("keep", 999);
    block.assignExisting("temp", 888);
    column.declare("added", "x");
    column.undef("keep");

    block.restoreChain(snapshot);
    expect(column.lookup("keep")).toEqual({ found: true, value: 1 }); // 删除被撤销
    expect(block.lookup("temp")).toEqual({ found: true, value: 2 }); // 改写被撤销
    expect(column.lookup("added")).toEqual({ found: false }); // 新增被撤销
  });

  it("层对象身份与父链不变（回滚只换内容，不重建层）", () => {
    const column = Scope.root();
    const block = column.enterChild();
    block.declare("x", 1);
    const snapshot = block.snapshotChain();
    block.declare("y", 2);
    block.restoreChain(snapshot);
    // 同一对象仍可继续用（父链未断）——否则调用方持有的引用会失效
    block.declare("z", 3);
    expect(block.lookup("z")).toEqual({ found: true, value: 3 });
    expect(column.lookup("z")).toEqual({ found: false }); // 仍写在本层
  });

  it("快照是深拷贝：回滚后再变更不影响已取快照（可重复回滚）", () => {
    const column = Scope.root();
    column.declare("v", 0);
    const snapshot = column.snapshotChain();
    column.assignExisting("v", 1);
    column.restoreChain(snapshot);
    expect(column.lookup("v")).toEqual({ found: true, value: 0 });
    column.assignExisting("v", 2);
    column.restoreChain(snapshot); // 同一快照可再次回滚
    expect(column.lookup("v")).toEqual({ found: true, value: 0 });
  });

  it("单层（root）与多层链都能回滚；快照层数与链深一致", () => {
    const column = Scope.root();
    const b1 = column.enterChild();
    const b2 = b1.enterChild();
    b2.declare("deep", 1);
    const snapshot = b2.snapshotChain();
    expect(snapshot).toHaveLength(3); // b2 → b1 → column
    b2.assignExisting("deep", 2);
    b2.restoreChain(snapshot);
    expect(b2.lookup("deep")).toEqual({ found: true, value: 1 });
  });
});
