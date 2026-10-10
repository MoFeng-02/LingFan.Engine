/**
 * 宿主接线互锁（源级扫描，不跑构建）：锁住三类「改动即坏」的接线契约——
 * 1. packages/ui/src/host/** 的宿主纯度：无模块级可变状态、无 document/window、无框架 import；
 * 2. App.vue 输入判据顺序：onKeydown 与 onWheel 的叙事路由门槛先于动作分发；
 * 3. main.ts 浏览器故事清单形态，与生成守卫注册表在 src/** 的唯一引用点。
 * 扫描面用 import.meta.glob 以 `?raw` 读源码文本；词法判据前先剥掉注释、
 * 字符串与正则字面量，避免文档注释里的 `document` 等词造成误报。
 */
import { describe, expect, it } from "vitest";

const playground = import.meta.glob("../../apps/playground/src/**/*.{ts,vue}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const hostSources = import.meta.glob("../../packages/ui/src/host/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/**
 * 剥掉行/块注释、字符串/模板字面量与正则字面量，只留代码骨架。
 * 正则字面量用启发式识别：`/` 前一个有效字符是标点（或位于开头）时按正则跳过，
 * 标识符后的 `/` 视为除号——足够覆盖常规排版，同时保证正则里的 `{}` 不干扰括号深度。
 */
function stripToCodeSkeleton(source: string): string {
  let out = "";
  let i = 0;
  const prevSignificant = (): string => {
    for (let j = out.length - 1; j >= 0; j -= 1) {
      if (!/\s/.test(out.charAt(j))) return out.charAt(j);
    }
    return "";
  };
  while (i < source.length) {
    const ch = source.charAt(i);
    const next = i + 1 < source.length ? source.charAt(i + 1) : "";
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      out += " ";
      continue;
    }
    if (ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i += 1;
      while (i < source.length && source.charAt(i) !== ch) {
        if (source.charAt(i) === "\\") i += 1;
        i += 1;
      }
      i += 1;
      out += " ";
      continue;
    }
    if (ch === "/" && "([{,;=:!&|?+-*%~^".includes(prevSignificant())) {
      i += 1;
      while (i < source.length && source.charAt(i) !== "/") {
        if (source.charAt(i) === "\\") i += 1;
        i += 1;
      }
      i += 1;
      while (i < source.length && /[a-z]/i.test(source.charAt(i))) i += 1;
      out += " ";
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * 找骨架里括号深度 0 的 `let` / `var` 声明（= 模块级可变状态）。
 * `for (let i …)` 的循环变量作用域限于循环体，不算模块级状态，跳过。
 */
function firstDepthZeroMutable(skeleton: string): string | null {
  const tokens = skeleton.match(/[{}]|[A-Za-z_$][\w$]*/g) ?? [];
  let depth = 0;
  let prev = "";
  for (const token of tokens) {
    if (token === "{") depth += 1;
    else if (token === "}") depth -= 1;
    else if (depth === 0 && (token === "let" || token === "var") && prev !== "for") {
      return token;
    } else if (/^[A-Za-z_$]/.test(token)) {
      prev = token;
    }
  }
  return null;
}

/** 断言 `needles` 在 `raw` 的 `from` 偏移之后按给定顺序依次出现（保序钉）。 */
function expectOrderedNeedles(raw: string, from: number, needles: string[]): void {
  let cursor = from;
  for (const needle of needles) {
    const at = raw.indexOf(needle, cursor);
    expect(at, `自偏移 ${cursor} 起找不到判据串：${needle}`).toBeGreaterThan(-1);
    cursor = at + needle.length;
  }
}

describe("宿主接线互锁（源级扫描）", () => {
  const appVueKey = Object.keys(playground).find((key) => key.endsWith("/src/App.vue"));
  const mainKey = Object.keys(playground).find((key) => key.endsWith("/src/main.ts"));
  const guardsKey = Object.keys(playground).find((key) =>
    key.endsWith("/src/stories/guards.ts"),
  );

  it("扫描面覆盖 playground src 与 host 源（防 glob 失配假绿）", () => {
    expect(Object.keys(playground).length).toBeGreaterThanOrEqual(30);
    expect(appVueKey, "扫描面缺 src/App.vue").toBeDefined();
    expect(mainKey, "扫描面缺 src/main.ts").toBeDefined();
    expect(guardsKey, "扫描面缺 src/stories/guards.ts").toBeDefined();
    const hostKeys = Object.keys(hostSources);
    expect(hostKeys.length).toBeGreaterThanOrEqual(6);
    for (const name of ["index", "frame-loop", "duration", "effects", "layer-view", "state-view"]) {
      expect(
        hostKeys.some((key) => key.endsWith(`/${name}.ts`)),
        `host 扫描面缺 ${name}.ts`,
      ).toBe(true);
    }
  });

  it("host/** 保持宿主纯度：无模块级可变状态、无 document/window、无框架 import", () => {
    for (const [key, raw] of Object.entries(hostSources)) {
      const skeleton = stripToCodeSkeleton(raw);
      const mutable = firstDepthZeroMutable(skeleton);
      expect(mutable, `${key} 出现模块级可变状态（${mutable ?? "?"}）`).toBeNull();
      const domGlobals = skeleton.match(/\b(document|window)\b/) ?? [];
      expect(domGlobals, `${key} 出现 document/window 引用`).toEqual([]);
      expect(
        raw,
        `${key} 出现框架 import`,
      ).not.toMatch(/(from|import)\s*\(?\s*["'](vue|react)["']/);
    }
  });

  it("纯度扫描器自检：深度 0 的 let 判红；函数内 let、注释/字符串提及、for 变量、正则花括号判绿", () => {
    expect(firstDepthZeroMutable(stripToCodeSkeleton("let x = 1;\nconst a = 2;"))).toBe("let");
    expect(firstDepthZeroMutable(stripToCodeSkeleton("export let y = 1;"))).toBe("let");
    expect(
      firstDepthZeroMutable(stripToCodeSkeleton("function f(): void {\n  let inner = 1;\n}")),
    ).toBeNull();
    expect(firstDepthZeroMutable(stripToCodeSkeleton("// let ghost = 1;\nconst a = 1;"))).toBeNull();
    expect(firstDepthZeroMutable(stripToCodeSkeleton('const note = "let ghost";'))).toBeNull();
    expect(
      firstDepthZeroMutable(stripToCodeSkeleton("for (let i = 0; i < 3; i += 1) {\n  step(i);\n}")),
    ).toBeNull();
    expect(
      firstDepthZeroMutable(stripToCodeSkeleton("const re = /\\d{2}/g;\nlet after = 1;")),
    ).toBe("let");
  });

  it("App.vue 输入判据顺序保持基线：onKeydown 先捕获态再叙事路由，onWheel 路由门槛先于 back/forward", () => {
    if (appVueKey === undefined) throw new Error("扫描面缺 src/App.vue（glob 失配）");
    const raw = playground[appVueKey];
    expectOrderedNeedles(raw, 0, [
      "function onKeydown(e: KeyboardEvent): void {",
      "if (captureAction.value !== null) return;",
      "if (!routesToNarrative(inputScope.current(), e.target)) return;",
      'keyMatches("advance"',
      'keyMatches("history"',
    ]);
    expectOrderedNeedles(raw, 0, [
      "function onWheel(event: WheelEvent): void {",
      "if (!routesToNarrative(inputScope.current(), event.target)) return;",
      "if (event.deltaY < 0) engine.back();",
      "else if (event.deltaY > 0) engine.forward();",
    ]);
  });

  it("main.ts 浏览器故事清单保持 const 声明与四章路径按序形态", () => {
    if (mainKey === undefined) throw new Error("扫描面缺 src/main.ts（glob 失配）");
    const raw = playground[mainKey];
    const start = raw.indexOf("const STORIES = [");
    expect(start, "main.ts 缺 const STORIES = [ 声明").toBeGreaterThan(-1);
    const end = raw.indexOf("];", start);
    expect(end, "main.ts 的 STORIES 清单缺收口 ];").toBeGreaterThan(-1);
    expectOrderedNeedles(raw.slice(start, end), 0, [
      "Stories/chapter1/chapter1.story",
      "Stories/chapter2/chapter2.story",
      "Stories/chapter3/chapter3.story",
      "Stories/chapter4/vocab_tour.story",
    ]);
  });

  it("生成守卫注册表在 src/** 只经 stories/guards.ts 单点进入", () => {
    if (guardsKey === undefined) throw new Error("扫描面缺 src/stories/guards.ts（glob 失配）");
    const hits = Object.entries(playground)
      .map(([key, raw]) => ({
        key,
        count: (raw.match(/Stories\.src\/gen\/fun_register/g) ?? []).length,
      }))
      .filter((entry) => entry.count > 0);
    expect(hits.map((entry) => entry.key), "生成注册表引用点漂移").toEqual([guardsKey]);
    expect(hits.length).toBe(1);
    expect(playground[guardsKey]).toContain(
      'export { guards } from "../../Stories.src/gen/fun_register.g";',
    );
  });
});
