/**
 * 守卫名收集与登记校验（装载期断言「故事提到的守卫都有实现」）。
 *
 * 口径：scene 列的 `entry` 与 flow 列的 `commands` 都走；嵌套块（`if` 的 `then`/`else` 等）
 * 递归走；`args` 是纯数据，里面出现的同形对象不当命令；重名去重且保持首次出现顺序。
 */
import { describe, expect, it } from "vitest";
import {
  collectGuardNames,
  findMissingGuards,
  parseStory,
  type GuardFn,
} from "@lingfan/engine";

/** guard 命令字面（args 只在需要时出现） */
function guard(fn: string, args?: object): object {
  return args === undefined ? { op: "guard", fn } : { op: "guard", fn, args };
}

function story(columns: object[]) {
  return parseStory({
    formatVersion: 1,
    id: "t",
    entry: (columns[0] as { id?: string } | undefined)?.id ?? "a",
    columns,
  });
}

function flow(id: string, commands: object[]): object {
  return { id, kind: "flow", commands };
}

describe("collectGuardNames · 走查面", () => {
  it("scene 列的 entry 与 flow 列的 commands 都收，重名去重且保序", () => {
    const parsed = story([
      {
        id: "s",
        kind: "scene",
        elements: [],
        entry: [guard("gold-non-negative"), guard("tour-open")],
      },
      flow("a", [guard("gold-non-negative"), guard("inventory-consistent")]),
    ]);
    expect(collectGuardNames(parsed)).toEqual([
      "gold-non-negative",
      "tour-open",
      "inventory-consistent",
    ]);
  });

  it("递归进嵌套块（if 的 then / else）", () => {
    const parsed = story([
      flow("a", [
        {
          op: "if",
          cond: "true",
          then: [{ op: "if", cond: "true", then: [guard("deep")] }],
          else: [guard("shallow")],
        },
      ]),
    ]);
    expect(collectGuardNames(parsed)).toEqual(["deep", "shallow"]);
  });

  it("args 里的同形对象不当命令（纯数据不往下走）", () => {
    const parsed = story([
      flow("a", [guard("check", { nested: { op: "guard", fn: "fake" } })]),
    ]);
    expect(collectGuardNames(parsed)).toEqual(["check"]);
  });

  it("没有守卫的故事 ⇒ 空数组", () => {
    expect(
      collectGuardNames(story([flow("a", [{ op: "say", text: "Hi" }])])),
    ).toEqual([]);
  });
});

describe("findMissingGuards · 缺名判定", () => {
  const parsed = story([
    flow("a", [guard("gold-non-negative"), guard("tour-open")]),
  ]);

  it("只报缺的，按出现顺序", () => {
    expect(findMissingGuards(parsed, { "tour-open": () => undefined })).toEqual(
      ["gold-non-negative"],
    );
  });

  it("齐全 ⇒ 空数组", () => {
    const guards: Readonly<Record<string, GuardFn>> = {
      "gold-non-negative": () => undefined,
      "tour-open": () => undefined,
    };
    expect(findMissingGuards(parsed, guards)).toEqual([]);
  });

  it("原型链上的名字不算登记（Object.hasOwn 口径）", () => {
    const toStringStory = story([flow("a", [guard("toString")])]);
    expect(findMissingGuards(toStringStory, {})).toEqual(["toString"]);
  });
});
