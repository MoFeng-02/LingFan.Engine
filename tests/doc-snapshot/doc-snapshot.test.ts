/**
 * 文档快照与实现对齐（文档回填批的验收锚）。
 *
 * 文档/注释是实现的快照：这里把「文档里写的数字与语义」钉到「代码实测」上，
 * 防止快照随实现演进而悄悄过期。公共面（docs/、core 源码）的断言
 * 在 CI 无内部文档时照样跑；内部面（agent.md、规约/台账）缺失时相应断言静默跳过。
 * 锚点 id 逐字落在用例标题里，供锚点覆盖核对检索。
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILTIN_OP_NAMES } from "@lingfan-engine/core";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const readIf = (rel: string): string | null =>
  existsSync(join(ROOT, rel)) ? read(rel) : null;

const specDir = "私有文档/新引擎规约";
const spec = (name: string): string | null => readIf(`${specDir}/${name}`);

describe("文档快照·op 全集与分组", () => {
  it("spec01-op-count：内建 op 实测 76，文档与规约同口径", () => {
    expect(BUILTIN_OP_NAMES.size).toBe(76);
    const opsZh = read("docs/src/content/docs/reference/ops.mdx");
    const opsEn = read("docs/src/content/docs/en/reference/ops.mdx");
    expect(opsZh).toContain("76");
    expect(opsEn).toContain("76");
    const s01 = spec("01-故事格式与命令集.md");
    if (s01 !== null) expect(s01).toContain("已实现 76");
  });

  it("spec10-groups-9：op 分九组，文档九域、规约九组", () => {
    const opsZh = read("docs/src/content/docs/reference/ops.mdx");
    const opsEn = read("docs/src/content/docs/en/reference/ops.mdx");
    expect(opsZh).toContain("9 个域");
    expect(opsEn).toContain("nine domains");
    const s10 = spec("10-自定义op与扩展.md");
    if (s10 !== null) {
      expect(s10).toContain("九组");
      expect(s10).not.toContain("八组");
      expect(s10).toContain("76");
    }
  });

  it("spec04-builtins-9：内置函数实测 9 个，规约同口径", () => {
    const builtins = read("packages/core/src/runtime/expr/builtins.ts");
    for (const fn of [
      "random",
      "min",
      "max",
      "abs",
      "clamp",
      "arrayGet",
      "dictGet",
      "optGet",
      "len",
    ]) {
      expect(builtins).toContain(`case "${fn}"`);
    }
    const s04 = spec("04-变量作用域与表达式.md");
    if (s04 !== null) expect(s04).toContain("9 个");
  });

  it("spec-package-core：规约落点统一 packages/core，无旧包名残留", () => {
    for (const name of [
      "02-执行模型与状态.md",
      "09-元素系统.md",
      "10-自定义op与扩展.md",
    ]) {
      const s = spec(name);
      if (s !== null) expect(s).not.toContain("packages/engine");
    }
  });
});

describe("文档快照·语义纠正", () => {
  it("docs-ext-wait-correct：扩展 op 可声明 wait:true 建等待（第三态），旧『不产生等待点』已纠正", () => {
    const zh = read("docs/src/content/docs/concepts/story.md");
    const en = read("docs/src/content/docs/en/concepts/story.md");
    expect(zh).toContain("wait: true");
    expect(zh).not.toContain("扩展 op 同样不产生等待点");
    expect(en).toContain("wait: true");
    expect(en).not.toContain("produce no wait points");
  });

  it("docstring-submit-only-load：scene 提交只拒 load，其余放行（docstring 与实现一致）", () => {
    const engine = read("packages/core/src/runtime/engine.ts");
    const sceneEnv = read("packages/core/src/contracts/scene-env.ts");
    expect(engine).toContain("只拒 `load`");
    expect(engine).not.toContain("整次拒绝位置类");
    expect(sceneEnv).toContain("除 `load` 外");
    expect(sceneEnv).not.toContain("整次拒绝存档类");
  });

  it("spec03-media-in-state：媒体随状态入快照（SYS 键），非独立 mediaState", () => {
    const s03 = spec("03-回溯与历史.md");
    if (s03 !== null) {
      expect(s03).toContain("媒体副作用随状态记账");
      expect(s03).not.toContain("单独记账 mediaState");
    }
  });

  it("spec10-atomic-call：call/组件 submit 帧原子，不可逐句回退", () => {
    const s03 = spec("03-回溯与历史.md");
    if (s03 !== null) {
      expect(s03).toContain("不可逐句回退");
      expect(s03).toContain("组件");
    }
  });

  it("spec05-flow-body-legal：flow 列也能带 body（body 与 columnKind 正交）", () => {
    const s07 = spec("07-文本创作模式.md");
    if (s07 !== null) expect(s07).toContain("flow 列也能带 body");
  });

  it("spec05-k2-package-dek：资源包级 DEK + 路径 AAD（非每文件独立 DEK）", () => {
    const s05 = spec("05-存档与安全.md");
    if (s05 !== null) {
      expect(s05).toContain("包级 DEK");
      expect(s05).toContain("路径 AAD");
      expect(s05).not.toContain("每文件/每档独立随机 DEK");
    }
  });
});

describe("文档快照·数字与清单", () => {
  it("agentmd-numbers-accurate：agent.md 内容文件/产物页数/桥查数与实测一致", () => {
    const agent = readIf("agent.md");
    if (agent !== null) {
      expect(agent).toContain("55 个 md/mdx");
      expect(agent).toContain("80 页");
      expect(agent).toContain("七查");
      expect(agent).toContain("installTauriBridge");
    }
  });

  it("en-fallback-list：英文真翻译与回退清单公示", () => {
    const enIndex = read("docs/src/content/docs/en/index.mdx");
    expect(enIndex).toContain("Translation status");
    expect(enIndex).toContain("25 Chinese pages");
  });

  it("docs-body-page：列身体专页存在且与代码一致（恰两层/SceneEnv/submit）", () => {
    const zh = read("docs/src/content/docs/guides/body-column.md");
    const en = read("docs/src/content/docs/en/guides/body-column.md");
    expect(zh).toContain("SceneEnv");
    expect(zh).toContain("只认一层");
    expect(en).toContain("SceneEnv");
  });

  it("ledger-lag-registered：台账滞后观察已登记（待裁定补建，不擅自重写历史）", () => {
    const readme = readIf("私有文档/tasks/README.md");
    if (readme !== null) expect(readme).toContain("台账滞后观察");
  });
});
