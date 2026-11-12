/**
 * 直达某列这条链路的宿主侧接线判据。
 *
 * 链路：开发编排脚本把章节 id 放进环境变量 → 组合根读出并注入 → 页面挂载后
 * 直达该列。宿主这一侧只做三件事：把 id 交给会话层、跳过启动页、照常量一次舞台尺寸。
 *
 * 断言落在源码文本上（`?raw`），因为这条链路的正确性取决于「哪一段代码在什么时机
 * 调用了什么」，跑起来反而看不见；源码级断言能钉住调用时机与参数传递。
 */
import { describe, expect, it } from "vitest";
import appSource from "../../apps/playground/src/App.vue?raw";
import appPropsSource from "../../apps/playground/src/host/session/app-props.ts?raw";
import appSessionSource from "../../apps/playground/src/host/session/app-session.ts?raw";
import mainSource from "../../apps/playground/src/main.ts?raw";

describe("直达链路的宿主接线", () => {
  it("组合根从环境变量读入章节 id 并注入", () => {
    expect(mainSource).toContain("entry: import.meta.env.VITE_LFEN_ENTRY,");
  });

  it("注入契约带可选的章节 id 字段", () => {
    expect(appPropsSource).toContain("entry?: string;");
  });

  it("会话层提供直达动作，并把列 id 交给引擎侧", () => {
    expect(appSessionSource).toContain(
      "onEnterColumn: (columnId: string) => void;",
    );
    expect(appSessionSource).toContain("options.enterGame(columnId);");
    expect(appSessionSource).toContain(
      "enterGame: (columnId?: string) => void;",
    );
  });

  it("页面挂载后直达：跳过启动页这一路", () => {
    const mountedBody = appSource.slice(
      appSource.indexOf("onMounted(() => {"),
      appSource.indexOf("onUnmounted(() => {"),
    );
    expect(mountedBody).toContain("onEnterColumn(props.entry)");
    expect(appSource).toContain(
      "const { onStart, onEnterColumn, onContinue, togglePause, restart } = life;",
    );
  });
});
