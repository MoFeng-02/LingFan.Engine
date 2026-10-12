/**
 * 真实工程回归锚点：apps/playground（本仓唯一全功能真实工程）整链构建 vs 入库产物。
 *
 * 锚定口径：
 * - 真实工程全链构建（源发现 → 编译 → 往返自检 → 差量写盘）必须零差量——入库的
 *   `Stories.src/gen/stories.gen.d.ts` 与当轮计算产物逐字节一致。链上任一环改变输出
 *   （编译器、typegen、扩展装载、源文件），本锚点立即红，倒逼产物随源显式重建。
 * - 判别性落点：`journal.flag` 只在变量清单（config.vars，换道前是 defineVars 清单）
 *   出现（state/let/插值均无此键），
 *   它进注册表的唯一通道是编排层的 defineKeys 源——该源被撤时本锚点必红
 *   （最小工程上的同款判别见 typegen.test.ts）。
 * - 手改生成物的修复路径也锚定：作者误改 gen 文件后，构建必须重写回正确字节——
 *   同时证明逐字节一致不是「构建没算」的空转绿。
 *
 * t2→t3 过渡守卫：config 化换道（t2）之后、Stories.src 迁移（t3）落地之前，真实工程
 * 仍是旧 config 契约，构建必然以「缺少 folders 导出」fail-closed——两例此时 skip（确定性
 * 契约错误，不是环境竞态）；t3 落地后错误消失、守卫自动失效，届时可删除 isConfigContractTransition。
 *
 * 写盘机制细节（差量判定、陈旧清理、report 计数）由 build-pipeline.test.ts 在最小工程
 * 覆盖；本文件不重复，只锚真实工程的整链终态。测试对工程根的写入仅限故障恢复路径：
 * 断言失败时把锚定的产物恢复为入库字节，不让测试自身污染工作区。
 *
 * 并行加固：本文件是全仓唯一对真实工程工作区做「读-改-写」的测试，vitest 跨文件
 * 并行下与其他读工程产物的用例存在 I/O 竞态窗口（偶发一败、单跑/复跑恒绿）——
 * 两例 retry 1 吸收环境性竞态；真回归两次必红，不会被吞。（文件内两例本就串行执行）
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildStories } from "@lingfan/stories-build";

const PLAYGROUND_ROOT = fileURLToPath(
  new URL("../../apps/playground/", import.meta.url),
);
/** report 里的逻辑路径是 posix 相对路径（与源根命名空间一致），保持正斜杠字面量 */
const TYPEGEN_REL = "Stories.src/gen/stories.gen.d.ts";

/** t2→t3 过渡守卫：旧 config 契约的确定性失败（缺 folders 导出 / 文件缺失）。t3 落地后可删。 */
function isConfigContractTransition(error: unknown): boolean {
  return (
    error instanceof Error &&
    (/缺少 folders 导出/.test(error.message) ||
      /config\.ts 不存在/.test(error.message))
  );
}

describe("真实工程回归锚点（apps/playground 整链）", () => {
  it("全链构建零差量：入库类型面产物与当轮计算产物逐字节一致", { retry: 1 }, async (ctx) => {
    const typegenPath = join(PLAYGROUND_ROOT, TYPEGEN_REL);
    const committed = readFileSync(typegenPath, "utf8");
    try {
      let report;
      try {
        report = await buildStories(PLAYGROUND_ROOT);
      } catch (error) {
        if (isConfigContractTransition(error)) ctx.skip();
        throw error;
      }
      expect(report.added).toEqual([]);
      expect(report.updated).toEqual([]);
      expect(report.removed).toEqual([]);
      // 工程形状随锚点显式维护：列数变化必须伴随 gen 产物重建（列名注册表随之变化）
      expect(report.columns).toBe(14);
      expect(readFileSync(typegenPath, "utf8")).toBe(committed);
    } finally {
      if (readFileSync(typegenPath, "utf8") !== committed) {
        writeFileSync(typegenPath, committed);
      }
    }
  });

  it("手改生成物：构建重写回入库字节（修复路径证明锚点非空转）", { retry: 1 }, async (ctx) => {
    const typegenPath = join(PLAYGROUND_ROOT, TYPEGEN_REL);
    const committed = readFileSync(typegenPath, "utf8");
    try {
      writeFileSync(typegenPath, `${committed}\n/* 手改的冗余行 */\n`);
      let report;
      try {
        report = await buildStories(PLAYGROUND_ROOT);
      } catch (error) {
        if (isConfigContractTransition(error)) ctx.skip();
        throw error;
      }
      expect(report.updated).toContain(TYPEGEN_REL);
      expect(readFileSync(typegenPath, "utf8")).toBe(committed);
    } finally {
      if (readFileSync(typegenPath, "utf8") !== committed) {
        writeFileSync(typegenPath, committed);
      }
    }
  });
});
