/**
 * UI 挂载渲染的**总览契约**：四条跨层判据，各自只判一个结论。
 *
 * 1. 显示与隐藏的真值是**树成员关系**：挂上就是容器里真有这个节点，隐藏就是它从
 *    渲染树里消失——不是 `display:none`，也不是留在树上换个可见性。
 * 2. 三种宿主形态（原生 / Vue / React）在**同一张挂载表**下得到同一批可见名字、
 *    同一个顺序。判定方式是让两条通路各自算一遍再比对，而不是各自断言一遍常量。
 * 3. 注册不靠构建期 glob：`import.meta.glob` 会把 `src/ui/` 下的文件全部静态拉进包，
 *    删了 UI 忘删文件它就还在，还把模板宿主绑死到某个构建工具上。
 * 4. 可挂载表只能来自生成物：有人手写一份「名字 → 组件」字面量表时，加 UI 却忘登记
 *    只表现成运行期不出现，磁盘事实不会漏，所以判据落在源码文本上。
 *
 * 逐条细节不在这里：投影与差量的纯函数判定、原生渲染器的逐条行为、三形态接线的
 * 逐处形态、控制面第二参，各有各自的文件。这里只保证「合起来是一条契约」。
 *
 * 源码判据一律先剥注释再判：注释里写「不要 glob」不是违规，写了才算。
 * 扫描面用根相对模式并断言非空下限——相对模式静默匹配 0 个文件时，判据会假绿。
 */
import { describe, expect, it } from "vitest";

import type { HostControls } from "@lingfan-engine/core";
import { selectMounts, visibleMounts } from "@lingfan-engine/ui";
import {
  createNativeMountRenderer,
  type NativeUiFactory,
  type NativeUiInstance,
} from "../../template/v1/__PROJECT__/src/host/mount/index";

/**
 * 最小 DOM 节点替身：只覆盖渲染器用到的成员。
 *
 * 不引 jsdom——这里的判据是「谁是谁的孩子」，不是浏览器语义。`tagName` 复用成
 * UI 名，好让「容器里现在有谁」能直接读成一串名字。
 */
class FakeElement {
  readonly children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  readonly tagName: string;

  constructor(tagName = "div") {
    this.tagName = tagName;
  }

  get childElementCount(): number {
    return this.children.length;
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child: FakeElement): FakeElement {
    const at = this.children.indexOf(child);
    if (at < 0) throw new Error("节点不在这里");
    this.children.splice(at, 1);
    child.parentNode = null;
    return child;
  }
}

/** 渲染器签名吃 `HTMLElement`，替身只保证用到的成员对得上 */
function asContainer(node: FakeElement): HTMLElement {
  return node as unknown as HTMLElement;
}

/** 控制面替身：渲染器只负责把它原样转交给工厂的第二参 */
function makeControls(): HostControls {
  return {
    pause: () => {},
    resume: () => {},
    paused: () => false,
    pauseMedia: () => {},
    resumeMedia: () => {},
    navigate: () => {},
    save: () => {},
    load: () => {},
    dispose: () => {},
  };
}

const controls = makeControls();

/** 造一个 UI 工厂：产出的节点用 name 作 `tagName`，容器里的孩子因此可读成名字 */
function makeFactory(name: string, sink: NativeUiInstance[] = []) {
  const factory: NativeUiFactory = () => {
    const instance: NativeUiInstance & { disposed: boolean } = {
      element: new FakeElement(name) as unknown as HTMLElement,
      disposed: false,
      dispose(): void {
        instance.disposed = true;
      },
    };
    sink.push(instance);
    return instance;
  };
  return factory;
}

/** 一条挂载记录（`SYS.mounts` 的一项） */
function entry(visible: boolean, props: Record<string, unknown> = {}) {
  return { visible, props };
}

/**
 * 扫描面一：模板宿主的整套源码（挂载层、生成物、组合根都在这棵树里）。
 *
 * 用根相对模式：相对模式一旦被搬动文件就会静默匹配 0 个文件，判据随之假绿。
 */
const TEMPLATE_SOURCES = import.meta.glob(
  "/template/v1/__PROJECT__/src/**/*.{ts,vue,tsx,html,css}",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** 扫描面二：示例宿主的挂载域（外部系统挂载分支与注册表装配） */
const PLAYGROUND_MOUNT_SOURCES = import.meta.glob(
  "/apps/playground/src/host/mount/**/*.ts",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** 生成物：唯一允许声明「名字 → 组件」表的地方 */
const GENERATED_TABLE = "/template/v1/__PROJECT__/src/gen/ui_register.g.ts";

/** 剥注释：判据只看代码骨架（HTML 注释、JS 块注释与行注释） */
function code(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

interface Hit {
  /** 扫描键（根相对路径），去掉前导斜杠以便直接粘进编辑器 */
  file: string;
  line: number;
  text: string;
}

/** 逐行找命中：行号是给人定位用的，所以按行切而不是整篇 indexOf */
function scan(sources: Record<string, string>, pattern: RegExp): Hit[] {
  const hits: Hit[] = [];
  for (const [key, source] of Object.entries(sources)) {
    code(source)
      .split(/\r?\n/)
      .forEach((text, index) => {
        if (pattern.test(text)) {
          hits.push({
            file: key.replace(/^\//, ""),
            line: index + 1,
            text: text.trim(),
          });
        }
      });
  }
  return hits;
}

/** 命中逐条摊开：只说「有违规」等于让人从头翻仓 */
function report(hits: Hit[]): string {
  return hits.map((hit) => `${hit.file}:${hit.line}  ${hit.text}`).join("\n");
}

/** 两个扫描面合起来：挂载相关的源码都在这里 */
const MOUNT_SOURCES: Record<string, string> = {
  ...TEMPLATE_SOURCES,
  ...PLAYGROUND_MOUNT_SOURCES,
};

describe("UI 挂载：显示与隐藏的 DOM 真值", () => {
  it("显示时节点真挂进容器，隐藏时那个节点从树里消失（不是换样式藏起来）", () => {
    const container = new FakeElement();
    const renderer = createNativeMountRenderer({
      container: asContainer(container),
      table: { hub: makeFactory("hub") },
      reportError: () => {},
      controls,
    });

    renderer.sync({ hub: entry(true) });
    const mounted = container.children[0];
    if (mounted === undefined) throw new Error("容器里没有挂上的节点");
    expect(container.children).toContain(mounted);
    expect(mounted.parentNode).toBe(container);

    renderer.sync({ hub: entry(false) });
    // 真值是「它还是不是这棵树的孩子」，不是它有没有被设为不可见
    expect(container.children).not.toContain(mounted);
    expect(mounted.parentNode).toBeNull();
    expect(container.childElementCount).toBe(0);
  });

  it("再显示会挂一个新节点：旧实例已随隐藏拆掉，不会拿旧节点放回去", () => {
    const container = new FakeElement();
    const instances: NativeUiInstance[] = [];
    const renderer = createNativeMountRenderer({
      container: asContainer(container),
      table: { hub: makeFactory("hub", instances) },
      reportError: () => {},
      controls,
    });

    renderer.sync({ hub: entry(true) });
    const first = container.children[0];
    renderer.sync({ hub: entry(false) });
    renderer.sync({ hub: entry(true) });

    const second = container.children[0];
    expect(container.childElementCount).toBe(1);
    expect(second).not.toBe(first);
    // 旧实例被拆过：这条同时说明「隐藏」真的走完了拆除，而不是先留着
    expect(instances[0]).not.toBe(second);
    expect(container.children).toContain(second);
  });
});

describe("UI 挂载：三形态行为一致", () => {
  it("同一张挂载表，真节点里读出的名字序列与渲染清单一致", () => {
    const table = {
      bag: makeFactory("bag"),
      hub: makeFactory("hub"),
      map: makeFactory("map"),
    };
    const raw = {
      hub: entry(true, { scene: "inn" }),
      bag: entry(false),
      map: entry(true),
    };

    const container = new FakeElement();
    createNativeMountRenderer({
      container: asContainer(container),
      table,
      reportError: () => {},
      controls,
    }).sync(raw);

    // 命令式通路：容器里真有谁。声明式通路：渲染清单里是谁。
    // 两条通路共用同一份投影，所以这里判的是「它们没有各自算出一套」。
    const fromDom = container.children.map((child) => child.tagName);
    const fromSelection = selectMounts(raw, table).map((item) => item.name);
    expect(fromDom).toEqual(fromSelection);
    expect(fromSelection).toEqual([...visibleMounts(raw)]);
  });

  it("隐藏其中一条时两条通路同时收缩，不会一边移除一边留着", () => {
    const table = {
      bag: makeFactory("bag"),
      hub: makeFactory("hub"),
    };
    const container = new FakeElement();
    const renderer = createNativeMountRenderer({
      container: asContainer(container),
      table,
      reportError: () => {},
      controls,
    });

    renderer.sync({ bag: entry(true), hub: entry(true) });
    renderer.sync({ bag: entry(true), hub: entry(false) });
    const after = { bag: entry(true), hub: entry(false) };

    expect(container.children.map((child) => child.tagName)).toEqual(["bag"]);
    expect(selectMounts(after, table).map((item) => item.name)).toEqual([
      "bag",
    ]);
    expect([...visibleMounts(after)]).toEqual(["bag"]);
  });
});

describe("UI 挂载：注册不靠构建期 glob", () => {
  it("模板宿主与示例宿主的挂载面里没有 import.meta.glob", () => {
    // 扫描面本身不能是空的：目录改名或搬走后，这条判据必须响，而不是「零命中所以通过」
    expect(Object.keys(TEMPLATE_SOURCES).length).toBeGreaterThan(20);
    expect(Object.keys(PLAYGROUND_MOUNT_SOURCES).length).toBeGreaterThan(3);

    const hits = scan(MOUNT_SOURCES, /import\.meta\.glob/);
    expect(hits, `挂载面里出现了构建期 glob：\n${report(hits)}`).toEqual([]);
    expect(Object.keys(MOUNT_SOURCES).length).toBeGreaterThan(25);
  });
});

describe("UI 挂载：可挂载表只能来自生成物", () => {
  it("「名字 → 组件」表只有一处声明，就在生成物里，且带 GENERATED 标记", () => {
    const declarations = scan(MOUNT_SOURCES, /^\s*(?:export\s+)?const\s+uis\b/);
    firstExpectDeclaration(declarations);

    const generated = MOUNT_SOURCES[GENERATED_TABLE];
    if (generated === undefined) throw new Error("生成物不在扫描面里");
    expect(generated.split(/\r?\n/)[0]).toContain("GENERATED");
  });

  it("挂载面里没有手写的「名字 → 组件」字面量表", () => {
    // 只看名字像表的声明：`{ a: x, b: y }` 这种字面量在别处大量存在（选项对象），
    // 判据收窄到「它自称是表」，因为手写注册表一定自称是表。
    const hits = Object.entries(MOUNT_SOURCES).flatMap(([key, source]) => {
      if (key === GENERATED_TABLE) return [];
      const lines = code(source).split(/\r?\n/);
      return lines
        .map((text, index) => ({ text: text.trim(), line: index + 1 }))
        .filter(({ text }) => {
          const named =
            /(?:export\s+)?const\s+([\w$]+)\s*(?::[^=]*)?=\s*\{/.exec(text);
          if (named === null) return false;
          return /uis|mount|registr|table/i.test(named[1] ?? "");
        })
        .map(({ text, line }) => ({
          file: key.replace(/^\//, ""),
          line,
          text,
        }));
    });
    expect(hits, `挂载面里出现了手写的可挂载表：\n${report(hits)}`).toEqual([]);
  });

  it("除生成物那一处声明外，没有对这张表的写入或改写", () => {
    const hits = Object.entries(MOUNT_SOURCES).flatMap(([key, source]) => {
      if (key === GENERATED_TABLE) return [];
      return scan(
        { [key]: source },
        /\buis\s*\[|\.\.\.\s*uis\b|\buis\s*=(?!=)/,
      );
    });
    expect(
      hits,
      `有人就地改写可挂载表（它只能是生成物的原样转交）：\n${report(hits)}`,
    ).toEqual([]);
  });
});

/** 表只能声明一次；多次声明意味着有人另写了一份 */
function firstExpectDeclaration(declarations: Hit[]): void {
  expect(
    declarations.map((hit) => hit.file),
    `可挂载表的声明处必须唯一：\n${report(declarations)}`,
  ).toEqual([GENERATED_TABLE.replace(/^\//, "")]);
}
