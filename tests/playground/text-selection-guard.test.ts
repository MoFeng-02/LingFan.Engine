/**
 * 文本选中守卫：
 * 游玩界面的文字（台词、按钮、面板标签）只作展示——拖动、连点、双击都不该留下选中段。
 * 因此「禁止选中」写在视口锁定那一环（一处生效、全局继承），复制能力只有一个入口：
 * 部件自带 `data-lf-selectable`。本用例锁两件事：宿主两侧口径一致、破例只能发生在放行名单里。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import appSource from "../../apps/playground/src/App.vue?raw";

/**
 * 模板样式表按字节读：vitest 的 `?raw` 对 `.css` 会被 stub 成空串（`css: false`），
 * 拿它做断言只会得到「找不到」，不是「没写」。
 */
const templateStyleSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../template/v1/__PROJECT__/src/styles/stage.css",
      import.meta.url,
    ),
  ),
  "utf8",
);

/** 全局（非 scoped）样式块：视口锁定与放行名单住在这里 */
const globalStyle = appSource.slice(
  appSource.indexOf("<style>"),
  appSource.indexOf("<style scoped>"),
);

/** 舞台与 UI 两层的组件（放行名单之外不得各自声明选中策略） */
const componentSources = Object.entries(
  import.meta.glob("../../apps/playground/src/App/*.vue", {
    eager: true,
    query: "?raw",
    import: "default",
  }),
) as [string, string][];

/** 复制能力的唯一入口名：宿主两侧必须写同一个 */
const SELECTABLE_HOOK = "data-lf-selectable";

describe("参考宿主（playground）：禁止选中挂在视口锁定那一环", () => {
  it("html / body / #app 上同时给标准与 webkit 两条声明", () => {
    const lockAt = globalStyle.indexOf("#app");
    expect(lockAt).toBeGreaterThan(-1);
    const rule = globalStyle.slice(globalStyle.indexOf("{", lockAt));
    const ruleBody = rule.slice(0, rule.indexOf("}"));
    expect(ruleBody).toContain("user-select: none;");
    expect(ruleBody).toContain("-webkit-user-select: none;");
  });

  it("放行名单只放输入类与显式标记：输入框要能选词改写，其余要靠宿主自己标", () => {
    const whitelistAt = globalStyle.indexOf(SELECTABLE_HOOK);
    expect(whitelistAt).toBeGreaterThan(-1);
    const rule = globalStyle.slice(globalStyle.lastIndexOf("\n", whitelistAt));
    expect(rule).toContain("input,");
    expect(rule).toContain("textarea,");
    expect(rule).toContain(`${SELECTABLE_HOOK}] {`);
    expect(rule).toContain("user-select: text;");
    expect(rule).toContain("-webkit-user-select: text;");
  });

  it("禁止选中只此一处：舞台与 UI 两层组件不得各自声明（防多点破例）", () => {
    expect(componentSources.length).toBeGreaterThan(0);
    for (const [path, source] of componentSources) {
      expect(source, `${path} 不应自行声明 user-select`).not.toContain(
        "user-select",
      );
    }
  });
});

describe("模板宿主：同一口径（不允许选中 + 同一放行入口名）", () => {
  it("body 上写禁止选中", () => {
    const bodyAt = templateStyleSource.indexOf("body {");
    expect(bodyAt).toBeGreaterThan(-1);
    const rule = templateStyleSource.slice(bodyAt);
    const ruleBody = rule.slice(0, rule.indexOf("}"));
    expect(ruleBody).toContain("user-select: none;");
    expect(ruleBody).toContain("-webkit-user-select: none;");
  });

  it("放行名单与参考宿主同名（复制能力只认一个标记）", () => {
    const whitelistAt = templateStyleSource.indexOf(SELECTABLE_HOOK);
    expect(whitelistAt).toBeGreaterThan(-1);
    const rule = templateStyleSource.slice(
      templateStyleSource.lastIndexOf("\n", whitelistAt),
    );
    expect(rule).toContain("input,");
    expect(rule).toContain("textarea,");
    expect(rule).toContain("user-select: text;");
  });
});
