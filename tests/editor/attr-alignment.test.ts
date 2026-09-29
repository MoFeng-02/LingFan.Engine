/**
 * T02-03 三面对齐互锁：**契约声明面 ↔ 编辑器表单面 ↔ 运行期消费面**。
 *
 * D-01（8+1 个元素属性写了不生效且不报错）之所以能长期潜伏，是因为没有任何测试同时看
 * 这三面：`lf-engine-add-op` 的 5 处同步与 `bridge_check.rs` 的跨语言互锁都只覆盖
 * 「声明 ↔ schema」，不覆盖「**是否有消费者**」。本测试从 `packages/ui/src/element/*.ts`
 * **源码**提取真实读取的属性名（`props.x` / `pick(props, "a", "b")` / 解构），与
 * `ELEMENT_ATTRIBUTES` 求差集，并断言：
 *
 * ① 消费面 ⊆ 声明面（渲染器读了契约外的键 = 契约漂移，红）；
 * ② 「声明 − 消费 − 白名单」必须与 `UNIMPLEMENTED_ELEMENT_ATTRS` **精确相等**——
 *    未实现清单就是差集的唯一合法去处，多一个少一个都红（T01-01 止血清单不许漂移）；
 * ③ 机制自证：往声明面里塞一个假属性，同一个差集函数必须把它标出来（验收项
 *    「故意加假属性 → 测试必须红」的等价形态——真改契约会被 ①/② 抓住）。
 *
 * T02-03 建立时反向逮出**第 9 个**失真属性 `stretch`（`image`/`imagebutton`/`portrait`
 * 有表单但零消费）：T01-01 的人工盘点按已知 8 键 grep、没从契约全集反推差集——
 * 这正是本互锁存在的意义。
 *
 * 锚点：`element-attr-three-face-alignment`
 */
import { describe, expect, it } from "vitest";
import { ELEMENT_ATTRIBUTES } from "@lingfan/engine";
import { UNIMPLEMENTED_ELEMENT_ATTRS } from "@lingfan/editor";

// 运行期消费面 = `packages/ui/src/element/**`（新文件加入时必须同步此清单——漏了会红）
import STYLE_SOURCE from "../../packages/ui/src/element/style.ts?raw";
import INTERACTION_SOURCE from "../../packages/ui/src/element/interaction.ts?raw";
import RENDERERS_SOURCE from "../../packages/ui/src/element/renderers.ts?raw";
import RENDER_SOURCE from "../../packages/ui/src/element/render.ts?raw";
import RESOURCE_SOURCE from "../../packages/ui/src/element/resource.ts?raw";
import ANIMATION_SOURCE from "../../packages/ui/src/element/animation.ts?raw";
import REGISTRY_SOURCE from "../../packages/ui/src/element/registry.ts?raw";

/** 消费面提取不到、但确属渲染器职责的键（键 → 用途说明；**必须写理由**） */
const RENDERER_ONLY_ATTRS: Readonly<Record<string, string>> = {};

const SOURCES = [
  STYLE_SOURCE,
  INTERACTION_SOURCE,
  RENDERERS_SOURCE,
  RENDER_SOURCE,
  RESOURCE_SOURCE,
  ANIMATION_SOURCE,
  REGISTRY_SOURCE,
];

/** 去注释（字符串里的 `://` 不当行注释切） */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'\w])\/\/.*$/gm, "$1");
}

/** 从 ui 元素层源码提取实际读取的属性名（三种取值形态） */
function consumedAttributes(sources: readonly string[]): Set<string> {
  const consumed = new Set<string>();
  for (const raw of sources) {
    const source = stripComments(raw);
    // ① `props.x` / `ctx.element.props.x`
    for (const m of source.matchAll(/props\.([A-Za-z_$][\w$]*)/g)) {
      consumed.add(m[1] ?? "");
    }
    // ② `pick(props, "a", "b", …)`（老引擎多键别名）
    for (const m of source.matchAll(
      /pick\s*\(\s*[\w.$]*props\s*,\s*("[^"]+"(?:\s*,\s*"[^"]+")*)\s*\)/g,
    )) {
      for (const key of (m[1] ?? "").matchAll(/"([^"]+)"/g)) {
        consumed.add(key[1] ?? "");
      }
    }
    // ③ `const { a, b } = child.props`（Grid 附着）
    for (const m of source.matchAll(/\{([^{}]+)\}\s*=\s*[\w.$]*props\b/g)) {
      for (const name of (m[1] ?? "").split(",")) {
        const key = (name ?? "").trim();
        if (/^[A-Za-z_$][\w$]*$/.test(key)) consumed.add(key);
      }
    }
  }
  consumed.delete("");
  return consumed;
}

/** 声明面 − 消费面 − 渲染器白名单（= 必须与未实现清单精确相等的集合） */
function unimplementedCandidates(declared: ReadonlySet<string>): Set<string> {
  const consumed = consumedAttributes(SOURCES);
  const rest = new Set<string>();
  for (const attr of declared) {
    if (consumed.has(attr) || attr in RENDERER_ONLY_ATTRS) continue;
    rest.add(attr);
  }
  return rest;
}

describe("T02-03 元素属性三面对齐互锁", () => {
  it("消费面 ⊆ 契约声明面（渲染器不读契约外的键）", () => {
    const consumed = consumedAttributes(SOURCES);
    const outside = [...consumed].filter((a) => !ELEMENT_ATTRIBUTES.has(a));
    expect(outside, `契约外被读取：${outside.join(", ")}`).toEqual([]);
    // 抽取器自检：三种形态各抽到至少一个已知键（防正则退化成空集 = 假绿）
    for (const known of ["x", "zindex", "text", "source", "colspan", "disabled"]) {
      expect(consumed.has(known), `抽取器漏读 ${known}`).toBe(true);
    }
  });

  it("声明 − 消费 − 白名单 === 未实现清单（精确相等，双向防漂移）", () => {
    const candidates = unimplementedCandidates(ELEMENT_ATTRIBUTES);
    const extra = [...candidates].filter(
      (a) => !UNIMPLEMENTED_ELEMENT_ATTRS.has(a),
    );
    const missing = [...UNIMPLEMENTED_ELEMENT_ATTRS].filter(
      (a) => !candidates.has(a),
    );
    expect(extra, "已声明、无消费者、却不在止血清单里（写了会静默无效）").toEqual(
      [],
    );
    expect(missing, "止血清单里有键已有消费者（应实现并回滚表单下架）").toEqual([]);
  });

  it("未实现清单 ⊆ 契约（清单不许写契约里不存在的键）", () => {
    const outside = [...UNIMPLEMENTED_ELEMENT_ATTRS].filter(
      (a) => !ELEMENT_ATTRIBUTES.has(a),
    );
    expect(outside).toEqual([]);
  });

  it("机制自证：往声明面塞假属性，差集必须把它标出来（契约新增即红）", () => {
    const tampered = new Set([...ELEMENT_ATTRIBUTES, "ghostAttr"]);
    expect(unimplementedCandidates(tampered).has("ghostAttr")).toBe(true);
  });

  it("渲染器白名单的键必须真实存在于契约（理由表不许记错键名）", () => {
    const outside = Object.keys(RENDERER_ONLY_ATTRS).filter(
      (a) => !ELEMENT_ATTRIBUTES.has(a),
    );
    expect(outside).toEqual([]);
  });
});
