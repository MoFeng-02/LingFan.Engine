/**
 * 视图组件解析互锁（源级扫描，不跑构建）：`.vue` 模板里用到的每个 PascalCase 标签，
 * 都必须在同文件的脚本里被绑定（import 或本地 const）或是 Vue 内建标签。
 *
 * 为什么需要这条：Vue 对未绑定的标签只在运行时 `resolveComponent` 落空——开发期是一行
 * 警告，生产期静默渲染成空元素，**测试与类型检查都不会失败**。抽取装配组件时漏搬 import
 * 就会踩这个坑，症状是整块界面空白而无任何报错。
 */
import { describe, expect, it } from "vitest";

const SFC = import.meta.glob(
  ["../../packages/*/src/**/*.vue", "../../apps/*/src/**/*.vue"],
  {
    query: "?raw",
    import: "default",
    eager: true,
  },
) as Record<string, string>;

/** Vue 内建标签：由运行时解析，不需要 import */
const BUILTIN = new Set([
  "Transition",
  "TransitionGroup",
  "Teleport",
  "KeepAlive",
  "Suspense",
  "Component",
]);

/** 取模板段（首个 `<template>` 块） */
function templateOf(source: string): string {
  const start = source.indexOf("<template>");
  if (start === -1) return "";
  const end = source.lastIndexOf("</template>");
  return end === -1 ? source.slice(start) : source.slice(start, end);
}

/** 取脚本段（`<script>` 或 `<script setup>`） */
function scriptOf(source: string): string {
  const start = source.indexOf("<script");
  if (start === -1) return "";
  const body = source.indexOf(">", start);
  const end = source.lastIndexOf("</script>");
  return end === -1 ? source.slice(body) : source.slice(body, end);
}

/** 模板里用到的 PascalCase 标签 */
function usedComponents(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(/<([A-Z][A-Za-z0-9]*)/g)) {
    const name = match[1];
    if (!BUILTIN.has(name)) found.add(name);
  }
  return [...found].sort();
}

/** 脚本里被绑定的名字（import 绑定 + `const X = …` 定义） */
function boundNames(script: string): Set<string> {
  const names = new Set<string>();
  for (const match of script.matchAll(
    /import\s+(?:type\s+)?([\s\S]*?)\s+from\s*["'][^"']+["']/g,
  )) {
    const clause = match[1];
    for (const part of clause.replace(/[{}]/g, " ").split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  for (const match of script.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=/g)) {
    names.add(match[1]);
  }
  return names;
}

/** 未绑定的标签（判据本体，便于自证）；`self` = 文件名，组件可自我引用 */
function unresolved(source: string, self = ""): string[] {
  const bound = boundNames(scriptOf(source));
  return usedComponents(templateOf(source)).filter(
    (name) => !bound.has(name) && name !== self,
  );
}

describe("视图组件解析（源级扫描）", () => {
  it("扫描面自检：命中视图文件（glob 失配时立刻失败）", () => {
    const keys = Object.keys(SFC);
    expect(keys.length).toBeGreaterThanOrEqual(30);
    expect(
      keys.some((key) => key.endsWith("components/panes/CenterStage.vue")),
    ).toBe(true);
  });

  it("判据自证：未绑定判红，绑定与内建判绿", () => {
    const bad = `<template><Missing /></template><script setup lang="ts">const x = 1;</script>`;
    expect(unresolved(bad)).toEqual(["Missing"]);
    const good = `<template><Kept /><Inner /></template>
<script setup lang="ts">
import Inner from "./Inner.vue";
const Kept = defineAsyncComponent(() => import("./Kept.vue"));
</script>`;
    expect(unresolved(good)).toEqual([]);
  });

  it("每个模板标签都有绑定（漏搬 import 时失败）", () => {
    const offenders = Object.entries(SFC)
      .map(([key, source]) => {
        const path = key.replace(/^(\.\.\/)+/, "");
        const self =
          path
            .split("/")
            .pop()
            ?.replace(/\.vue$/, "") ?? "";
        return [path, unresolved(source, self)] as const;
      })
      .filter(([, names]) => names.length > 0)
      .map(([path, names]) => `${path} —— ${names.join(", ")}`);
    expect(offenders, "模板标签未绑定：请在脚本里 import 或本地定义").toEqual(
      [],
    );
  });
});
