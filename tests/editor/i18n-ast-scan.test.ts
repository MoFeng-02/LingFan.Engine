/**
 * 宿主面 AST 扫描器测试。
 *
 * 测试要点：
 * - 只认登记函数名的字面量调用（裸调用与成员调用），别名清单显式配置、不隐式猜测；
 * - 动态调用（变量/拼接/模板串/缺参）跳过并报告行列号，不静默；
 * - 默认只收含 CJK 的字面量，all 收全部非空；空串字面量不收；
 * - 注释/字符串内部不误抓，模板串内嵌表达式整棵跳过；
 * - 同键去重 + 稳定排序（确定性）；扫描范围谓词排除依赖/构建/生成物/测试/声明文件；
 * - 未标记检测：含 CJK 但未包登记调用的字面量显式报告（不进键集合），
 *   登记调用任意参位、import/export 指定符、模板串都跳过。
 */
import { describe, expect, it } from "vitest";
import {
  findUnmarkedHostTexts,
  isScannableSourcePath,
  scanHostSource,
} from "../../packages/editor/src/scan/index.ts";

const FILE = "src/host/panels/history.ts";

describe("scanHostSource · 调用识别", () => {
  it('收裸调用 t("字面量") 与成员调用 i18n.t("字面量")', () => {
    const text = ['const a = t("你好");', 'panel.title = i18n.t("历史");'].join(
      "\n",
    );
    expect(scanHostSource(text, FILE).keys).toEqual(["你好", "历史"]);
  });

  it("别名清单显式配置：登记的 tr 收，未登记的 __ 不收", () => {
    const text = ['tr("攻击");', '__("防御");', 't("逃跑");'].join("\n");
    const result = scanHostSource(text, FILE, { functions: ["t", "tr"] });
    expect(result.keys).toEqual(["攻击", "逃跑"]);
    expect(result.dynamic).toEqual([]);
  });

  it("缺省清单只有 t：tr 未登记时不收也不报告", () => {
    const result = scanHostSource('tr("攻击");', FILE);
    expect(result.keys).toEqual([]);
    expect(result.dynamic).toEqual([]);
  });

  it("别名清单为空或含空名 fail-closed 抛错", () => {
    expect(() => scanHostSource("", FILE, { functions: [] })).toThrow(
      /别名清单不能为空/,
    );
    expect(() => scanHostSource("", FILE, { functions: ["t", ""] })).toThrow(
      /空函数名/,
    );
  });

  it("多参调用只认首参字面量", () => {
    expect(scanHostSource('t("确定", 2);', FILE).keys).toEqual(["确定"]);
  });
});

describe("scanHostSource · 动态调用报告", () => {
  it("变量/拼接/模板串/缺参都进 dynamic，带 1 基行列号与函数名", () => {
    const text = [
      "const key =变量;",
      "t(key);",
      't("前" + "后");',
      "t(`模板`);",
      "t();",
    ].join("\n");
    const result = scanHostSource(text, FILE);
    expect(result.keys).toEqual([]);
    expect(result.dynamic).toEqual([
      { line: 2, column: 1, callee: "t" },
      { line: 3, column: 1, callee: "t" },
      { line: 4, column: 1, callee: "t" },
      { line: 5, column: 1, callee: "t" },
    ]);
  });

  it("成员调用的动态形态同样报告（callee 记末段名）", () => {
    const result = scanHostSource("i18n.t(key);", FILE);
    expect(result.dynamic).toEqual([{ line: 1, column: 1, callee: "t" }]);
  });
});

describe("scanHostSource · 语言过滤与边界", () => {
  it("默认只收含 CJK 的字面量；all 收全部非空", () => {
    const text = ['t("Hello");', 't("确定 OK");', 't("㐀");'].join("\n");
    expect(scanHostSource(text, FILE).keys).toEqual(["㐀", "确定 OK"]);
    expect(scanHostSource(text, FILE, { all: true }).keys).toEqual([
      "Hello",
      "㐀",
      "确定 OK",
    ]);
  });

  it("空串字面量不收也不报告", () => {
    const result = scanHostSource('t("");', FILE, { all: true });
    expect(result.keys).toEqual([]);
    expect(result.dynamic).toEqual([]);
  });

  it("注释与字符串内部不误抓", () => {
    const text = [
      '// t("注释里的");',
      '/* t("块注释里的"); */',
      'const s = "t(\\"字符串里的\\")";',
    ].join("\n");
    const result = scanHostSource(text, FILE);
    expect(result.keys).toEqual([]);
    expect(result.dynamic).toEqual([]);
  });

  it("模板串内嵌表达式整棵跳过：外层报动态，内层 t 不收", () => {
    const result = scanHostSource('t(`外${t("内")}尾`);', FILE);
    expect(result.keys).toEqual([]);
    expect(result.dynamic).toEqual([{ line: 1, column: 1, callee: "t" }]);
  });

  it("同键去重 + 稳定排序，重复运行逐字节一致", () => {
    const text = ['t("乙");', 't("甲");', 't("乙");'].join("\n");
    const first = scanHostSource(text, FILE);
    expect(first.keys).toEqual(["乙", "甲"]);
    expect(scanHostSource(text, FILE)).toEqual(first);
  });
});

describe("findUnmarkedHostTexts · 未标记静态文案检测", () => {
  it("裸 CJK 字面量与未登记调用内的字面量都报告，带 1 基行列号", () => {
    const text = ['const label = "未标记";', 'console.log("提示");'].join("\n");
    expect(findUnmarkedHostTexts(text, FILE)).toEqual([
      { line: 1, column: 15, text: "未标记" },
      { line: 2, column: 13, text: "提示" },
    ]);
  });

  it("登记调用的直接实参任意参位都跳过（第二参不误报）", () => {
    expect(findUnmarkedHostTexts('t("键", "上下文");', FILE)).toEqual([]);
    expect(findUnmarkedHostTexts('i18n.t("键", "上下文");', FILE)).toEqual([]);
  });

  it("别名清单显式配置：登记的 tr 跳过，未登记的 __ 照报", () => {
    const text = ['tr("已登记");', '__("未登记");'].join("\n");
    expect(
      findUnmarkedHostTexts(text, FILE, { functions: ["t", "tr"] }),
    ).toEqual([{ line: 2, column: 4, text: "未登记" }]);
  });

  it("import/export 模块指定符跳过", () => {
    const text = [
      'import x from "中文模块";',
      'export { a } from "中文出口";',
    ].join("\n");
    expect(findUnmarkedHostTexts(text, FILE)).toEqual([]);
  });

  it("模板串整棵跳过（含内嵌表达式里的字面量）", () => {
    const text = [
      "const a = `纯模板文案`;",
      'const b = `外${t("内")}尾`;',
    ].join("\n");
    expect(findUnmarkedHostTexts(text, FILE)).toEqual([]);
  });

  it("只报含 CJK 的；空别名清单 fail-closed 抛错", () => {
    expect(findUnmarkedHostTexts('const s = "hello";', FILE)).toEqual([]);
    expect(() => findUnmarkedHostTexts("", FILE, { functions: [] })).toThrow(
      /别名清单不能为空/,
    );
  });

  it("注释不误抓；登记调用内的字符串不算未标记；按源码序稳定输出", () => {
    const text = ['// "注释里的"', 't("已标记");', 'const u = "未标记";'].join(
      "\n",
    );
    expect(findUnmarkedHostTexts(text, FILE)).toEqual([
      { line: 3, column: 11, text: "未标记" },
    ]);
  });

  it("未标记与动态调用共存：动态调用不吞未标记；未登记别名不豁免", () => {
    const text = [
      "const a = t(key);",
      'const b = tr("别名已标记");',
      'const c = "未标记";',
    ].join("\n");
    const options = { functions: ["t", "tr"] };
    const scan = scanHostSource(text, FILE, options);
    expect(scan.keys).toEqual(["别名已标记"]);
    expect(scan.dynamic).toEqual([{ line: 1, column: 11, callee: "t" }]);
    expect(findUnmarkedHostTexts(text, FILE, options)).toEqual([
      { line: 3, column: 11, text: "未标记" },
    ]);
    // 别名未登记（缺省只认 t）⇒ tr 里的中文按未标记报，不隐式猜测
    expect(findUnmarkedHostTexts(text, FILE)).toEqual([
      { line: 2, column: 14, text: "别名已标记" },
      { line: 3, column: 11, text: "未标记" },
    ]);
  });
});

describe("isScannableSourcePath · 扫描范围谓词", () => {
  it("收 src 下的 .ts 源文件（含 host 子目录）", () => {
    expect(isScannableSourcePath("src/main.ts")).toBe(true);
    expect(isScannableSourcePath("src/host/panels/history.ts")).toBe(true);
  });

  it("排除依赖/构建/生成物目录、测试与声明文件、非 .ts", () => {
    expect(isScannableSourcePath("node_modules/x/a.ts")).toBe(false);
    expect(isScannableSourcePath("src/dist/a.ts")).toBe(false);
    expect(isScannableSourcePath("src/gen/a.ts")).toBe(false);
    expect(isScannableSourcePath("src/a.test.ts")).toBe(false);
    expect(isScannableSourcePath("src/a.d.ts")).toBe(false);
    expect(isScannableSourcePath("src/a.vue")).toBe(false);
    expect(isScannableSourcePath("")).toBe(false);
  });

  it("反斜杠与前导 ./ 归一化后判定一致", () => {
    expect(isScannableSourcePath("src\\host\\panels\\history.ts")).toBe(true);
    expect(isScannableSourcePath("./src/main.ts")).toBe(true);
    expect(isScannableSourcePath(".\\src\\a.test.ts")).toBe(false);
  });
});
