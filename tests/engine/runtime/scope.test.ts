/** 04 §一 作用域树测试（锚点：S1 scope-nested-lifetime / S2 声明层语义） */
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

  it("assignExisting 写入声明时所在层（S1 block-scoped 语义）", () => {
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

  it("出块销毁：丢弃块作用域后其声明不可达（S1 生命周期）", () => {
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
