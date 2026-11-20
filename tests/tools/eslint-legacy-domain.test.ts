/**
 * 老 WebView 守卫的文件域（eslint-legacy-domain-extended / eslint-legacy-no-disease /
 * banned-builtins-guard）。
 *
 * 脚手架交付物（template/ 下各形态源码，含小程序 overlay）与仓内小程序参考宿主
 * （apps/miniprogram）一样要在基线 WebView（Safari 13.1+/Chrome 85+）上跑。esbuild 的
 * `build.target` 只转译**语法**，不补 `Array.prototype.at`、`Object.hasOwn` 这类基线之后
 * 才有的**内建方法**——用了它们产物语法合法、运行期却 `TypeError` 白屏。所以内建必须由
 * eslint 的 `lingfan/legacy-webview-compat` 兜底，且文件域要覆盖模板源码。
 *
 * 两道判据：
 * - 配置源结构：禁用清单单一声明（LEGACY_WEBVIEW_SELECTORS/GLOBALS），legacy 块文件域
 *   含 template；
 * - 生效面：问 ESLint 本人（calculateConfigForFile / lintText）模板与小程序文件上守卫
 *   真的活着——flat config 按规则名整体覆盖，只写在某块文本里不等于生效。
 */
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import eslintConfigSource from "../../eslint.config.js?raw";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** 老 WebView 禁用内建的单一来源常量（16 条 MemberExpression 选择器） */
function legacySelectors(): string[] {
  const at = eslintConfigSource.indexOf("const LEGACY_WEBVIEW_SELECTORS = [");
  expect(at, "配置源缺少 LEGACY_WEBVIEW_SELECTORS 常量").toBeGreaterThan(-1);
  const end = eslintConfigSource.indexOf("\n];", at);
  expect(end, "LEGACY_WEBVIEW_SELECTORS 常量未闭合").toBeGreaterThan(at);
  const block = eslintConfigSource.slice(at, end);
  const selectors =
    block.match(/MemberExpression\[[^\]]*\](?:\[[^\]]*\])*/g) ?? [];
  expect(selectors.length, "LEGACY_WEBVIEW_SELECTORS 不是 16 条").toBe(16);
  return selectors;
}

describe("老 WebView 守卫：配置源结构（eslint-legacy-domain-extended）", () => {
  const LEGACY = "lingfan/legacy-webview-compat";

  function legacyBlock(): string {
    const at = eslintConfigSource.indexOf(`name: "${LEGACY}"`);
    expect(at, `配置源缺少 ${LEGACY}`).toBeGreaterThan(-1);
    // 块文本取到下一个 name: 块为止（只关心本块 files 域）
    const next = eslintConfigSource.indexOf('name: "', at + 1);
    return eslintConfigSource.slice(at, next === -1 ? undefined : next);
  }

  it("文件域覆盖模板源码（含小程序 overlay）与既有 packages/apps", () => {
    const block = legacyBlock();
    expect(block).toContain('"packages/**/*.ts"');
    expect(block).toContain('"apps/*/src/**/*.{ts,vue}"');
    expect(
      block,
      "legacy 域未扩到 template——脚手架交付物用基线后内建会在用户工程白屏",
    ).toContain('"template/**/src/**/*.{ts,vue}"');
  });

  it("禁用清单单一声明：legacy 块展开常量，不另抄一份（banned-builtins-guard）", () => {
    const block = legacyBlock();
    expect(legacySelectors()).toHaveLength(16);
    expect(block).toContain("...LEGACY_WEBVIEW_SELECTORS");
    expect(block).toContain("...LEGACY_WEBVIEW_GLOBALS");
    // 单一声明：选择器常量全配置源只定义一次
    const occurrences =
      eslintConfigSource.match(/const LEGACY_WEBVIEW_SELECTORS = \[/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });
});

describe("老 WebView 守卫：生效面（eslint-legacy-no-disease）", () => {
  // 模板骨架 / 小程序 overlay / 仓内小程序参考宿主各取一个真实文件
  const TEMPLATE_FILE = "template/v1/__PROJECT__/src/host/boot.ts";
  const MP_OVERLAY_FILE = "template/v1/overlays/miniprogram/src/mp/host.ts";
  const MP_APP_FILE = "apps/miniprogram/src/host/host.ts";

  async function effectiveRules(
    file: string,
  ): Promise<{ syntax: string[]; globals: string[] }> {
    const eslint = new ESLint({ cwd: ROOT });
    const config = await eslint.calculateConfigForFile(file);
    const syntaxRule = config.rules?.["no-restricted-syntax"];
    const syntax = Array.isArray(syntaxRule)
      ? syntaxRule
          .slice(1)
          .map((entry: unknown) =>
            typeof entry === "string"
              ? entry
              : (entry as { selector?: string }).selector,
          )
          .filter((s): s is string => typeof s === "string")
      : [];
    const globalsRule = config.rules?.["no-restricted-globals"];
    const globals = Array.isArray(globalsRule)
      ? globalsRule
          .slice(1)
          .map((entry: unknown) =>
            typeof entry === "string"
              ? entry
              : (entry as { name?: string }).name,
          )
          .filter((s): s is string => typeof s === "string")
      : [];
    return { syntax, globals };
  }

  const effective = new Map<string, { syntax: string[]; globals: string[] }>();

  beforeAll(async () => {
    for (const file of [TEMPLATE_FILE, MP_OVERLAY_FILE, MP_APP_FILE]) {
      effective.set(file, await effectiveRules(file));
    }
  }, 120_000);

  it.each([TEMPLATE_FILE, MP_OVERLAY_FILE, MP_APP_FILE])(
    "%s 上 16 条老 WebView 内建守卫全部生效",
    (file) => {
      const { syntax } = effective.get(file)!;
      const missing = legacySelectors().filter((s) => !syntax.includes(s));
      expect(
        missing,
        `${file} 上失效的老 WebView 守卫：${missing.join(" / ")}`,
      ).toEqual([]);
    },
  );

  it.each([TEMPLATE_FILE, MP_OVERLAY_FILE, MP_APP_FILE])(
    "%s 上 structuredClone/BigInt 全局守卫生效",
    (file) => {
      const { globals } = effective.get(file)!;
      expect(globals).toContain("structuredClone");
      expect(globals).toContain("BigInt");
    },
  );

  it("模板文件用基线后内建 → eslint 红；replaceAll（基线内合法）不报", async () => {
    const eslint = new ESLint({ cwd: ROOT });
    const filePath = "template/v1/__PROJECT__/src/host/legacy-probe.ts";
    const banned = await eslint.lintText("const x = [1, 2].at(0);\n", {
      filePath,
    });
    const bannedMessages = banned[0]?.messages ?? [];
    expect(
      bannedMessages.some((m) => m.ruleId === "no-restricted-syntax"),
      "模板文件用 Array.prototype.at 应被老 WebView 守卫拦下",
    ).toBe(true);

    const legal = await eslint.lintText(
      'const y = "a-b".replaceAll("-", "_");\n',
      { filePath },
    );
    const legalLegacy = (legal[0]?.messages ?? []).filter(
      (m) =>
        m.ruleId === "no-restricted-syntax" ||
        m.ruleId === "no-restricted-globals",
    );
    expect(
      legalLegacy,
      "replaceAll 在基线内合法，不该被老 WebView 守卫误报",
    ).toEqual([]);
  }, 120_000);
});
