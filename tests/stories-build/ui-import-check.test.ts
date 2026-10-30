/**
 * UI 文件的 import 面判定：允许清单与越界诊断。
 *
 * 这组断言盯的是**判定顺序**：先判越界再判允许。顺序错了的典型症状是
 * `@/host/boot` 被「别名 UI」规则顺手放过——它的前缀看着像别名，实际指向宿主。
 *
 * 扫描器一侧盯的是「不靠正则」：注释里的假 import 不许报、`import type` 与内联
 * `type` 修饰符要认成纯类型、动态 `import()` 与 `require()` 是运行期依赖要报。
 */
import { describe, expect, it } from "vitest";
import {
  checkUiImports,
  scanUiImports,
} from "../../packages/stories-build/src/ui/scan-imports.ts";

const FILE = "ui/hub/hub.vue";

/** 一份最小 `.vue`：把给定 import 行塞进 `<script setup>` */
function vueWith(lines: readonly string[]): string {
  return [
    "<template>",
    '  <div class="hub">hub</div>',
    "</template>",
    "",
    '<script setup lang="ts">',
    ...lines,
    "</script>",
    "",
  ].join("\n");
}

/** 扫 + 判一条链：返回该文件全部越界项 */
function violationsOf(source: string, ext = ".vue", file = FILE) {
  return checkUiImports(file, scanUiImports(source, ext));
}

describe("UI import 面 · 允许清单", () => {
  it("相对路径引用 ui/ 内的子组件 ⇒ 通过", () => {
    const source = vueWith(['import Panel from "./panel.vue";']);
    expect(violationsOf(source)).toEqual([]);
  });

  it("别名 `@/ui/other` 与相对路径等价 ⇒ 通过", () => {
    const source = vueWith(['import { map } from "@/ui/map/map";']);
    expect(violationsOf(source)).toEqual([]);
  });

  it("框架包（vue / react / react-dom / react/jsx-runtime）⇒ 通过", () => {
    const source = vueWith([
      'import { ref } from "vue";',
      'import React from "react";',
      'import { createPortal } from "react-dom";',
      'import { jsx } from "react/jsx-runtime";',
    ]);
    expect(violationsOf(source)).toEqual([]);
  });

  it("从引擎包取纯类型 ⇒ 通过", () => {
    const source = vueWith([
      'import type { SceneType } from "@lingfan-engine/core";',
      'import { type ElementNode, type StoryCommand } from "@lingfan-engine/core";',
    ]);
    expect(violationsOf(source)).toEqual([]);
  });

  it("相对路径的 .css ⇒ 通过（同目录随 UI 一起走）", () => {
    const source = vueWith(['import "./hub.css";']);
    expect(violationsOf(source)).toEqual([]);
  });
});

describe("UI import 面 · 越界诊断", () => {
  it("`@/host/boot` ⇒ 反向依赖宿主", () => {
    const violations = violationsOf(
      vueWith(['import { boot } from "@/host/boot";']),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toContain("不得反向依赖宿主");
    expect(violations[0]?.line).toBe(6);
  });

  it("`@/gen/x` ⇒ 依赖构建产物", () => {
    const violations = violationsOf(
      vueWith(['import { uis } from "@/gen/x";']),
    );
    expect(violations[0]?.reason).toContain("不得依赖构建产物");
  });

  it("`@/Stories.src/lib/y` ⇒ 焊死创作输入", () => {
    const violations = violationsOf(
      vueWith(['import { SYS } from "@/Stories.src/lib/y";']),
    );
    expect(violations[0]?.reason).toContain("不得依赖故事源");
  });

  it("引擎包的值导入 ⇒ 只能取类型", () => {
    const violations = violationsOf(
      vueWith(['import { SYS } from "@lingfan-engine/core";']),
    );
    expect(violations[0]?.reason).toContain(
      "只能从引擎包取类型（import type），不能取运行期值",
    );
  });

  it("裸包 `lodash` ⇒ 拷贝后无法解析", () => {
    const violations = violationsOf(
      vueWith(['import { debounce } from "lodash";']),
    );
    expect(violations[0]?.reason).toContain("不得依赖外部包（拷贝后无法解析）");
    expect(violations[0]?.reason).toContain("lodash");
  });

  it("相对路径越出 ui/（`../../host/boot`）⇒ 越界，且不按相对路径放过", () => {
    const violations = violationsOf(
      vueWith(['import { boot } from "../../host/boot";']),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toContain("不得引用 src/ui 之外的文件");
    expect(violations[0]?.reason).toContain("src/host/boot");
  });

  it("`@/ui/../host/x` 同样按越界处理（别名不能绕过沙箱）", () => {
    const violations = violationsOf(
      vueWith(['import { boot } from "@/ui/../host/x";']),
    );
    expect(violations[0]?.reason).toContain("不得引用 src/ui 之外的文件");
  });

  it("`@/main.ts` 与 `@/boot` 同属组合根；`@/mainmenu` 不算", () => {
    const boot = violationsOf(vueWith(['import { boot } from "@/main.ts";']));
    expect(boot[0]?.reason).toContain("不得引用组合根");
    const unrelated = violationsOf(
      vueWith(['import { x } from "@/mainmenu";']),
    );
    expect(unrelated[0]?.reason).toContain("不得依赖外部包");
  });
});

describe("UI import 面 · 扫描器形态覆盖", () => {
  it("`.ts` 的六种形态逐条报出，`line` 与 `typeOnly` 都对", () => {
    const source = [
      'import { ref } from "vue";',
      'import type { SceneType } from "@lingfan-engine/core";',
      'import { type ElementNode } from "@lingfan-engine/core";',
      'export { SYS } from "@lingfan-engine/core";',
      'const lazy = () => import("./panel.vue");',
      'const legacy = () => require("./panel.vue");',
      '// import { fake } from "./fake";',
    ].join("\n");
    const refs = scanUiImports(source, ".ts");
    expect(refs.map((ref) => [ref.line, ref.specifier, ref.typeOnly])).toEqual([
      [1, "vue", false],
      [2, "@lingfan-engine/core", true],
      [3, "@lingfan-engine/core", true],
      [4, "@lingfan-engine/core", false],
      [5, "./panel.vue", false],
      [6, "./panel.vue", false],
    ]);
  });

  it("注释里的假 import 不报", () => {
    const source = vueWith([
      '// import { boot } from "@/host/boot";',
      '/* import { x } from "@/gen/x"; */',
      'import "./hub.css";',
    ]);
    expect(violationsOf(source)).toEqual([]);
  });

  it("动态 import() 与 require() 是运行期依赖，同样判定", () => {
    const source = vueWith([
      'const a = () => import("@/host/boot");',
      'const b = () => require("@/gen/x");',
    ]);
    const reasons = violationsOf(source).map((violation) => violation.reason);
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toContain("不得反向依赖宿主");
    expect(reasons[1]).toContain("不得依赖构建产物");
  });

  it("`export ... from` 也是依赖", () => {
    const violations = violationsOf(
      vueWith(['export { x } from "@/host/boot";']),
    );
    expect(violations[0]?.reason).toContain("不得反向依赖宿主");
  });

  it("`.ts` 与 `.tsx` 按 TS 解析，行号取原文件", () => {
    const source = [
      'import { ref } from "vue";',
      "",
      'import { boot } from "@/host/boot";',
    ].join("\n");
    const refs = scanUiImports(source, ".tsx");
    expect(refs.map((ref) => ref.line)).toEqual([1, 3]);
    expect(refs[1]?.specifier).toBe("@/host/boot");
  });

  it("`.vue` 的两块 `<script>` 都要扫（setup 与普通块并存）", () => {
    const source = [
      '<script lang="ts">',
      'import { boot } from "@/host/boot";',
      "</script>",
      "",
      '<script setup lang="ts">',
      'import { uis } from "@/gen/x";',
      "</script>",
      "",
    ].join("\n");
    const refs = scanUiImports(source, ".vue");
    expect(refs.map((ref) => ref.specifier)).toEqual([
      "@/host/boot",
      "@/gen/x",
    ]);
  });

  it('`.html` 只扫 `type="module"` 的 script 块', () => {
    const source = [
      "<html><body>",
      "<script>",
      '  import { boot } from "@/host/boot";',
      "</script>",
      '<script type="module">',
      '  import { uis } from "@/gen/x";',
      "</script>",
      "</body></html>",
    ].join("\n");
    const refs = scanUiImports(source, ".html");
    expect(refs.map((ref) => ref.specifier)).toEqual(["@/gen/x"]);
    expect(refs[0]?.line).toBe(6);
  });
});
