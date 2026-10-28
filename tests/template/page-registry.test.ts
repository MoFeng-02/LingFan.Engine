/**
 * 宿主页面注册表：列 id → 页面工厂。
 *
 * 断言分三层：
 * - **查表语义**：注册后取到同一工厂；同列 id 再注册 = **替换**（开发热替换）；未注册返回
 *   `undefined` 而**不抛**（未注册列回落默认渲染，列照常跑 op，是降级不是错误）。
 * - **fail-closed 的一侧**：非法列 id 与非法工厂**被拒绝并上报诊断**。注册表对「查不到」
 *   宽容、对「写错」严格，两个方向刻意不对称——写错是装配 bug，静默吞掉只会让页面某列
 *   一直渲染不出来且没人知道为什么。
 * - **形态对齐**：注册表里的列 id 形态是从引擎那份镜像来的（引擎未从包出口转发它），
 *   故这里拿引擎出口的形态常量当**判据基准**逐条比对——两边哪天被单方面改动，这组用例
 *   立刻红，而不是等到某个列 id 半路注册不上才被发现。
 *
 * `PageContext["engine"]` 只给五个方法这件事在类型层面锁：多一个少一个都会让下面的
 * `NoExtraEngineKey` 断言编译期不成立。
 *
 * 用 `vi.stubGlobal("document", …)` 造最小 DOM 替身而不引 jsdom：`tests/template` 属前端域，
 * 禁 Node 导入。替身只实现本模块链路上用到的面。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXTENSION_ID_PATTERN } from "@lingfan-engine/core";
import {
  createPageRegistry,
  type Page,
  type PageContext,
  type PageFactory,
} from "../../template/v1/__PROJECT__/src/host/pages/registry.ts";

// ---------- 最小 DOM 替身 ----------

interface FakeElement {
  tagName: string;
  className: string;
  children: FakeElement[];
  appendChild(child: FakeElement): FakeElement;
}

function createFakeElement(tag: string): FakeElement {
  const element = {
    tagName: tag.toUpperCase(),
    className: "",
    children: [] as FakeElement[],
    appendChild(child: FakeElement): FakeElement {
      element.children.push(child);
      return child;
    },
  } as unknown as FakeElement;
  return element;
}

// ---------- 被测装置的装配 ----------

/** 页面上下文替身：本组用例只验查表语义，故各口给最小可用形状 */
function fakeContext(): PageContext {
  return {
    reader: {} as PageContext["reader"],
    engine: {} as PageContext["engine"],
    preferences: {} as PageContext["preferences"],
    gameState: {} as PageContext["gameState"],
  };
}

/** 造一个只有「身份」的页面：本组用例断言的是工厂身份，不是页面行为 */
function pageStub(label: string): PageFactory {
  return (): Page => ({
    mount(container: HTMLElement): void {
      container.appendChild(createFakeElement("div") as unknown as HTMLElement);
      void label;
    },
    unmount(): void {},
  });
}

interface Harness {
  registry: ReturnType<typeof createPageRegistry>;
  /** 已上报的诊断文本（非法注册的唯一可观测面） */
  diagnostics: string[];
}

function setup(): Harness {
  const diagnostics: string[] = [];
  const registry = createPageRegistry({
    onInvalidId: (message) => diagnostics.push(message),
  });
  return { registry, diagnostics };
}

beforeEach(() => {
  vi.stubGlobal("document", {
    createElement: (tag: string) => createFakeElement(tag),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------- 编译期锁：命令面只有五个方法 ----------

/**
 * 页面能拿到的引擎能力。这个数组既是运行期断言的材料，也是**编译期锁的锚**：
 * `PageContext["engine"]` 将来若多出 `get` / 元素命令执行器之类，下面的
 * `NoExtraEngineKey` 就不再是 `never`，本文件直接编译失败。
 */
const ENGINE_METHODS: ReadonlyArray<keyof PageContext["engine"]> = [
  "navigate",
  "choose",
  "input",
  "save",
  "load",
];

type NoExtraEngineKey = Exclude<
  keyof PageContext["engine"],
  (typeof ENGINE_METHODS)[number]
>;

const NO_EXTRA_ENGINE_KEY: NoExtraEngineKey extends never ? true : false = true;

describe("页面注册表", () => {
  it("注册后能取回同一工厂", () => {
    const { registry, diagnostics } = setup();
    const factory = pageStub("title");

    registry.register("title_main", factory);

    expect(registry.get("title_main")).toBe(factory);
    expect(diagnostics).toEqual([]);
  });

  it("同列 id 再注册 = 替换，旧工厂取不到（热替换不叠加）", () => {
    const { registry } = setup();
    const first = pageStub("first");
    const second = pageStub("second");

    registry.register("title_main", first);
    registry.register("title_main", second);

    expect(registry.get("title_main")).toBe(second);
    expect(registry.get("title_main")).not.toBe(first);
  });

  it("未注册列返回 undefined，且不抛（回落默认渲染）", () => {
    const { registry, diagnostics } = setup();
    registry.register("title_main", pageStub("title"));

    expect(() => registry.get("chapter1")).not.toThrow();
    expect(registry.get("chapter1")).toBeUndefined();
    // 未注册是合理降级，不该产生诊断噪音
    expect(diagnostics).toEqual([]);
  });

  it("非法列 id 被拒绝并上报诊断（大写开头 / 非法字符 / 空串 / 超长）", () => {
    const { registry, diagnostics } = setup();
    const factory = pageStub("never");
    const invalidIds = [
      "Title_main", // 大写开头
      "titleMain", // 驼峰：大写出现在中间同样非法
      "1chapter", // 数字开头
      "-chapter", // 分隔符开头
      "title.main", // 点不在允许字符集内
      "title main", // 空格
      "", // 空串
      "a".repeat(33), // 超 32
    ];

    for (const id of invalidIds) registry.register(id, factory);

    expect(diagnostics).toHaveLength(invalidIds.length);
    for (const id of invalidIds) {
      expect(registry.get(id)).toBeUndefined();
    }
    // 诊断要指名道姓，只说「id 不合法」等于没说
    expect(diagnostics[0]).toContain("Title_main");
  });

  it("非法工厂被拒绝并上报诊断（注册不进去，也不污染已有条目）", () => {
    const { registry, diagnostics } = setup();
    const factory = pageStub("valid");
    registry.register("title_main", factory);

    registry.register("title_main", undefined as unknown as PageFactory);

    expect(diagnostics).toHaveLength(1);
    // 关键：被拒的注册不得把原有条目顶掉
    expect(registry.get("title_main")).toBe(factory);
  });

  it("列 id 形态与引擎出口的形态常量逐条一致（镜像不得单方面漂移）", () => {
    const { registry, diagnostics } = setup();
    const factory = pageStub("probe");
    const samples = [
      "a",
      "a1",
      "title_main",
      "chapter-1",
      "a_b-c9",
      "a".repeat(32),
      "a".repeat(33),
      "A",
      "Title",
      "1abc",
      "a.b",
      "a b",
      "-a",
      "_a",
      "",
      "标题",
    ];

    for (const id of samples) {
      const before = diagnostics.length;
      registry.register(id, factory);
      const accepted = diagnostics.length === before;
      expect(
        accepted,
        `列 id ${JSON.stringify(id)} 的接受结果应与引擎形态一致`,
      ).toBe(EXTENSION_ID_PATTERN.test(id));
    }
  });

  it("工厂拿到的上下文就是调用方给的那份（不做拷贝、不做包装）", () => {
    const { registry } = setup();
    const ctx = fakeContext();
    let received: PageContext | undefined;
    registry.register("title_main", (given) => {
      received = given;
      return { mount(): void {}, unmount(): void {} };
    });

    const factory = registry.get("title_main");
    expect(factory).toBeDefined();
    const page = factory!(ctx);

    expect(received).toBe(ctx);
    // 页面实例具备页面契约的两个口
    expect(typeof page.mount).toBe("function");
    expect(typeof page.unmount).toBe("function");
  });

  it("命令面只有 navigate / choose / input / save / load 五个方法", () => {
    expect(NO_EXTRA_ENGINE_KEY).toBe(true);
    expect(ENGINE_METHODS).toHaveLength(5);
  });
});
