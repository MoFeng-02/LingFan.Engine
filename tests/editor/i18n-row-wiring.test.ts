/**
 * 译文表**行编辑的接线互锁**。
 *
 * 为何要补：判据 `addTranslationRow` / `removeTranslationRow` / `renameTranslationRow`
 * 早已实现且有 5 组边界测试（`i18n-table-rows.test.ts`），但**「UI 是否接了」没有守卫**。
 * 判据全绿、组件写好了，**却没接进界面**是常见漏法 ——
 * 判据测试绿 ≠ 能力可用。
 *
 * 两个组件职责不重叠：
 * - `LangWorkbench`（右栏「本地化」tab）定位是**发现**（覆盖率 / 缺译清单），
 *   点缺译 → 跳进译文表逐条改 —— 它本就不负责编辑；
 * - 编辑在 `LangView`（中央视图打开 `.json` 时），**增删改都接了**。
 * 本守卫锁住这条链路，防它被摘掉。
 */
import { describe, expect, it } from "vitest";
import langViewSource from "../../apps/editor/src/components/LangView.vue?raw";

/** 去注释后再匹配（守卫对象是代码，不是注释里的字样） */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("译文表行编辑 · 接线互锁（判据已测，锁住 UI 那一半）", () => {
  it("**三个判据都被 import**（不是自己在组件里重写一套）", () => {
    const src = code(langViewSource);
    expect(src).toContain("addTranslationRow");
    expect(src).toContain("removeTranslationRow");
    expect(src).toContain("renameTranslationRow");
  });

  it("**增行 / 删行都有可点按钮**（能力真的暴露给译者）", () => {
    const src = code(langViewSource);
    expect(src).toMatch(/title="新增一个译文行"[^>]*@click/);
    expect(src).toMatch(/title="删除该行"[^>]*@click/);
  });

  it("**改键在原地**（点键进入重命名，不另开对话框）", () => {
    expect(code(langViewSource)).toMatch(/@click="renamingKey = row\.key"/);
  });

  it("**保存走宿主的 save 通道**（组件不自己碰文件系统 —— WebView 无 Node）", () => {
    const src = code(langViewSource);
    expect(src).toContain("emit('save'");
  });

  it("**删行是 danger 样式**（破坏性操作要视觉区分）", () => {
    expect(code(langViewSource)).toMatch(/class="mini danger"[^>]*删除该行/);
  });
});
