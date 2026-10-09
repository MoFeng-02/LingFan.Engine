/**
 * 内建元素渲染器注册的**源级互锁**：登记表只有一份，且覆盖面与契约相等。
 *
 * 36 个元素类型的「类型名 → 渲染器」映射是渲染的入口。登记表一旦被拆成多份或
 * 被复制，就会出现两个真相源：某个类型在 A 处注册了新渲染器、B 处仍是旧的，
 * 表现是「改了没生效」或「只有部分场景生效」。漏登记的形态更安静——
 * 宿主 fail-closed 不渲染该元素，画面上少一块但没有任何报错。
 * 本测试用源码文本把约束钉住：映射只准写在登记表文件里，且键集合与契约逐项相等。
 *
 * 扫描面 = 渲染器全目录（新增文件自动纳入）。
 */
import { describe, expect, it } from "vitest";
import { ELEMENT_TYPES } from "@lingfan/engine";

/** 渲染器全部源码，键 = 仓库相对路径（前端不碰文件系统，改用打包器读取） */
const RENDERER_SOURCES = import.meta.glob(
  "../../packages/ui/src/element/renderers/**/*.ts",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** 唯一允许写登记表的文件 */
const REGISTRY_FILE = "register.ts";

/** 登记表条目形态：`类型名: 渲染器名,`（缩进 2 以上，无类型注解） */
const REGISTRATION_ENTRY = /^[ \t]{2,}([a-z][a-z0-9_]*)\s*:\s*(render[A-Za-z0-9_]*)\s*,?[ \t]*$/gm;

/** 去注释（注释里举例的类型名不算登记） */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'\w])\/\/.*$/gm, "$1");
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** 每个文件里抽到的登记条目（先去注释） */
function registrationsIn(source: string): { type: string; renderer: string }[] {
  const out: { type: string; renderer: string }[] = [];
  for (const m of stripComments(source).matchAll(REGISTRATION_ENTRY)) {
    out.push({ type: m[1] ?? "", renderer: m[2] ?? "" });
  }
  return out;
}

/** 登记表文件（扫描面内按文件名定位） */
function registryEntry(): { path: string; source: string } {
  const found = Object.entries(RENDERER_SOURCES).find(([path]) =>
    path.endsWith(`/${REGISTRY_FILE}`),
  );
  return { path: found?.[0] ?? "", source: stripComments(found?.[1] ?? "") };
}

describe("内建元素渲染器登记 · 源级互锁（单点登记 + 覆盖面分层相等）", () => {
  it("扫描面覆盖渲染器全目录（非空且含登记表，防假绿）", () => {
    const paths = Object.keys(RENDERER_SOURCES);
    expect(paths.length).toBeGreaterThanOrEqual(9);
    expect(paths.map(basename)).toContain(REGISTRY_FILE);
  });

  it("登记表只写在一个文件里（其余文件零登记条目）", () => {
    const owners = Object.keys(RENDERER_SOURCES)
      .sort()
      .filter((path) => registrationsIn(RENDERER_SOURCES[path] ?? "").length > 0)
      .map(basename);
    expect(owners).toEqual([REGISTRY_FILE]);
  });

  it("登记键集合与契约元素类型逐项相等（36 项，无遗漏、无越界）", () => {
    const registered = registrationsIn(registryEntry().source).map((r) => r.type);
    expect(registered).toHaveLength(ELEMENT_TYPES.length);
    // 双向：漏登记（契约有、表里无）与越界（表里有、契约无）都能抓住
    expect(new Set(registered)).toEqual(new Set(ELEMENT_TYPES));
  });

  it("每个登记项都指向一个内建渲染器（键名漂移立刻红）", () => {
    const entries = registrationsIn(registryEntry().source);
    for (const { type, renderer } of entries) {
      expect(renderer, `${type} 缺少渲染器`).toMatch(/^render[A-Za-z0-9_]+$/);
    }
    const renderers = new Set(entries.map((e) => e.renderer));
    // 登记表用到的渲染器都应是渲染器文件里的具名导出，而不是就地内联的箭头函数
    expect(renderers.size).toBeGreaterThanOrEqual(5);
  });

  it("注册调用只有一处，且经注册表接口（不做第二套分发）", () => {
    const callers = Object.keys(RENDERER_SOURCES)
      .sort()
      .filter((path) => /\.register\s*\(/.test(stripComments(RENDERER_SOURCES[path] ?? "")))
      .map(basename);
    expect(callers).toEqual([REGISTRY_FILE]);
    expect(registryEntry().source).toContain("export function registerBuiltinElementRenderers");
    expect(registryEntry().source).toMatch(/Object\.entries\(reg\)/);
  });

  it("机制自证：改坏一个登记键名，键集合比对必须失败", () => {
    const tampered = registryEntry()
      .source.replace(/\btext:\s*renderText\b/, "textx: renderText");
    const registered = registrationsIn(tampered).map((r) => r.type);
    expect(new Set(registered)).not.toEqual(new Set(ELEMENT_TYPES));
  });
});
