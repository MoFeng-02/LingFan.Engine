/**
 * 组件面板（元素 36 类型归类 + 命令 op 源）测试。
 *
 * 测试纪律：
 * - **互锁**（面板覆盖 36 类型且与契约不越界、不缺项）：
 *   分组表按组序拍平 **逐项等于** `ELEMENT_TYPES`（含顺序）；op 分组覆盖 `listOps()` 全集
 * - **回归锚定**：容器组 ∪ 滚动组 === `ELEMENT_CONTAINER_TYPES`（面板 badge 语义所依据的事实）
 * - **单一事实源**：op 分组标签不再散落在视图里（源码互锁）
 * - **边界**：中文标签覆盖全集、无重复归属、空组不存在
 */

import { describe, expect, it } from "vitest";
import { ELEMENT_CONTAINER_TYPES, ELEMENT_TYPES } from "@lingfan/engine";
import {
  ELEMENT_TYPE_GROUPS,
  elementLabel,
  listOpGroups,
  listOps,
  OP_GROUP_LABELS,
  OP_GROUP_ORDER,
} from "@lingfan/editor";
import componentPaletteSource from "../../apps/editor/src/components/ComponentPalette.vue?raw";
import storyTimelineSource from "../../apps/editor/src/components/StoryTimeline.vue?raw";
import appSource from "../../apps/editor/src/App.vue?raw";

const flatElementTypes = ELEMENT_TYPE_GROUPS.flatMap((group) => [...group.types]);

describe("互锁：元素分组表 ↔ ELEMENT_TYPES 契约", () => {
  it("按组序拍平逐项等于 ELEMENT_TYPES（不越界、不缺项、顺序一致）", () => {
    expect(flatElementTypes).toEqual([...ELEMENT_TYPES]);
  });

  it("面板覆盖 36 类型", () => {
    expect(ELEMENT_TYPES.length).toBe(36);
    expect(flatElementTypes.length).toBe(36);
  });

  it("无重复归属（每个类型恰好属于一组）", () => {
    expect(new Set(flatElementTypes).size).toBe(flatElementTypes.length);
  });

  it("无空组；组标签非空且唯一", () => {
    const labels = ELEMENT_TYPE_GROUPS.map((group) => group.label);
    for (const group of ELEMENT_TYPE_GROUPS) {
      expect(group.types.length, group.group).toBeGreaterThan(0);
      expect(group.label, group.group).not.toBe("");
    }
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(ELEMENT_TYPE_GROUPS.map((g) => g.group)).size).toBe(
      ELEMENT_TYPE_GROUPS.length,
    );
  });

  it("每个类型都有中文标签（面板不用裸类型名）", () => {
    for (const type of ELEMENT_TYPES) {
      expect(elementLabel(type), type).not.toBe(type);
      expect(elementLabel(type).length, type).toBeGreaterThan(0);
    }
  });
});

describe("回归锚定：容器组 ∪ 滚动组 = 支持 children 的契约集合", () => {
  it("分组划分与 ELEMENT_CONTAINER_TYPES 恰好人手相扣", () => {
    const layout = ELEMENT_TYPE_GROUPS.find((g) => g.group === "container");
    const scroll = ELEMENT_TYPE_GROUPS.find((g) => g.group === "scroll");
    expect(layout, "container 组").toBeDefined();
    expect(scroll, "scroll 组").toBeDefined();
    const union = [...(layout?.types ?? []), ...(scroll?.types ?? [])];
    // 面板对这两组全部显示「容器」badge（可容纳子元素）——事实锚定，分组调整时须同步
    expect(new Set(union)).toEqual(new Set(ELEMENT_CONTAINER_TYPES));
  });
});

describe("互锁：op 分组 ↔ listOps() 全集", () => {
  it("覆盖全部 op（无遗漏、无重复）", () => {
    const grouped = listOpGroups().flatMap((group) =>
      group.ops.map((item) => item.op),
    );
    const all = listOps().map((meta) => meta.op);
    expect(new Set(grouped)).toEqual(new Set(all));
    expect(grouped.length).toBe(all.length);
    expect(grouped.length).toBeGreaterThan(0);
  });

  it("组顺序 = OP_GROUP_ORDER；每组标签取自 OP_GROUP_LABELS（单一事实源）", () => {
    const groups = listOpGroups();
    expect(groups.map((group) => group.group)).toEqual([...OP_GROUP_ORDER]);
    for (const group of groups) {
      expect(group.label).toBe(OP_GROUP_LABELS[group.group]);
      expect(group.label).not.toBe("");
    }
  });

  it("每组 op 的标签非空（面板不显示裸 op 名）", () => {
    for (const group of listOpGroups()) {
      for (const item of group.ops) {
        expect(item.label, item.op).not.toBe("");
      }
    }
  });
});

describe("源码互锁：分组清单只在纯逻辑模块，视图不另立一份", () => {
  it("组件面板消费纯模块导出的分组，未硬编码类型清单", () => {
    expect(componentPaletteSource).toContain("ELEMENT_TYPE_GROUPS");
    expect(componentPaletteSource).toContain("listOpGroups");
    // 不出现任何「裸类型清单」写法（类型名只应来自契约）
    expect(componentPaletteSource).not.toMatch(/"panel"\s*,\s*"frame"/);
    expect(componentPaletteSource).not.toContain("richtext"); // 不存在的类型名
  });

  it("时间线复用同一 op 分组源，旧的硬编码标签表已消除", () => {
    expect(storyTimelineSource).toContain("listOpGroups");
    expect(storyTimelineSource).not.toMatch(/group:\s*"narrative",\s*label:\s*"叙事"/);
    expect(storyTimelineSource).not.toContain("listOps"); // 不再自行拼装分组
  });

  it("拖拽源契约：面板与列分组各用独立 MIME（落点可据 kind 分派）", () => {
    expect(componentPaletteSource).toContain(
      'const DRAG_TYPE = "application/x-lingfan-palette"',
    );
    expect(componentPaletteSource).toContain("draggable");
    expect(componentPaletteSource).toContain('kind, id');
  });

  it("左栏 tab 用容器 div 承接 v-show（多根组件上挂运行时指令会静默失效）", () => {
    // 回归锚定：`ColumnList` 是多根模板，直接给它 v-show → Vue 只报 console warning，
    // 面板实际不隐藏。CDP 首轮实测逮到（App.vue 现改为 div.left-pane-body 承接）。
    expect(appSource).toContain(
      `<div v-show="leftTab === 'columns'" class="left-pane-body">`,
    );
    expect(appSource).toContain(
      `<div v-show="leftTab === 'palette'" class="left-pane-body">`,
    );
    expect(appSource).not.toMatch(/<ColumnList[^>]*v-show/);
    expect(appSource).not.toMatch(/<ComponentPalette[^>]*v-show/);
  });
});

describe("回归锚定：时间线元素容器的「插入」只产元素草稿", () => {
  it("元素层插入走 createElementDraft + ELEMENT_TYPE_GROUPS（与组件面板同源）", () => {
    expect(storyTimelineSource).toContain('field === "elements"');
    expect(storyTimelineSource).toContain("createElementDraft");
    expect(storyTimelineSource).toContain("ELEMENT_TYPE_GROUPS");
    expect(storyTimelineSource).toContain("elementLabel"); // 中文标签同源，不裸显类型名
  });

  it("元素层下拉按字段分派（v-if/v-else），命令容器的 op 下拉不受影响", () => {
    expect(storyTimelineSource).toContain(
      `v-if="container.field === 'elements'"`,
    );
    expect(storyTimelineSource).toContain(`v-else v-model="insertOp"`);
    // 命令容器仍产 {op} 形态（只此一处，元素分支已提前 return）
    expect(storyTimelineSource).toContain(`{ op: insertOp.value }`);
  });
});

describe("D-60 文案守卫：面板不得泄露内部计划／也不得说错可用路径", () => {
  /** 剥离注释后再断言——守卫的对象是**用户可见文案**，不是注释 */
  function stripComments(source: string): string {
    return source
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  }
  const code = stripComments(componentPaletteSource);
  const hint = code.slice(
    code.indexOf('class="palette-hint"'),
    code.indexOf("palette-search"),
  );

  it("提示区块确实取到且非空（否则下面的断言会假 PASS）", () => {
    expect(hint.length).toBeGreaterThan(20);
    expect(hint).toContain("palette-hint");
  });

  it("禁出现内部计划词（随后续 / 待提供 / 后续任务 / TODO / 未实现）", () => {
    for (const word of ["随后续", "待提供", "后续任务", "TODO", "未实现"]) {
      expect(hint).not.toContain(word);
    }
  });

  it("改前那句泄露路线图的原文已彻底消失", () => {
    expect(code).not.toContain("命令的落点创建随后续任务提供");
  });

  it("如实描述两条可用路径（元素拖舞台 / 命令走「插入」）", () => {
    expect(hint).toContain("舞台画布");
    expect(hint).toContain("插入");
  });

  it("计数仍由纯数据驱动（类型/命令数不写死）", () => {
    expect(hint).toContain("elementCount");
    expect(hint).toContain("opCount");
  });
});