/**
 * 舞台适配装配：读数（外框）→ 计算（`@lingfan/shell`）→ 落笔（舞台根样式）。
 *
 * 舞台原是「作者像素 = 屏幕像素」，窗口一变内容尺寸不变；装配把基准宽高与变换写进舞台根，
 * 同一份作者坐标于是在任意窗口下等比呈现。这里钉住五件事：基准来自配置而不是样式表、
 * 变换顺序是「先平移再缩放」、窗口变化后能就地重算、两层坐标系各归各的
 * （舞台层随舞台缩放，故不许出现视口单位；UI 层随窗口自适应，故必须用视口相对尺寸）、
 * UI 层组件确实住在舞台根之外。
 *
 * 读数只走注入的 `readFrame`：装配本身不碰窗口全局，小程序宿主换掉读数来源即可复用。
 * 宿主侧的监听注册与注销成对写在本组件里，源级断言防止只留一半。
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_STAGE_CONFIG } from "@lingfan/engine";
import appSource from "../../apps/playground/src/App.vue?raw";
import fitSource from "../../apps/playground/src/host/stage/fit/app-stage-fit.ts?raw";
import frameSource from "../../apps/playground/src/host/stage/frame/app-frame.ts?raw";
import mainSource from "../../apps/playground/src/main.ts?raw";
import manifestSource from "../../apps/playground/Resources/project.json?raw";
import { createAppStageFit } from "../../apps/playground/src/host/stage/fit";

/** 舞台层组件（住在舞台根内，随舞台缩放 ⇒ 不许出现视口单位） */
const STAGE_COMPONENTS = import.meta.glob(
  "../../apps/playground/src/App/ExtensionOverlayCard.vue",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** UI 层组件（住在窗口坐标系里，随窗口自适应 ⇒ 必须至少有一处视口相对尺寸） */
const SHELL_UI_COMPONENTS = import.meta.glob(
  "../../apps/playground/src/App/{ToolbarPanel,NotificationLayer,DialoguePanel,SettingsPanels}.vue",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** UI 层里的挂载容器：本身不定尺寸，归 UI 层但不参与「必须响应式」这条 */
const SHELL_UI_CONTAINERS = import.meta.glob(
  "../../apps/playground/src/App/DemoHost.vue",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** 组件目录全集：上面三组必须盖全，新增组件不能悄悄漏检 */
const ALL_APP_COMPONENTS = import.meta.glob(
  "../../apps/playground/src/App/*.vue",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** 舞台适配装配目录（用于钉住「工程取值不留本地副本」） */
const FIT_MODULES = import.meta.glob(
  "../../apps/playground/src/host/stage/fit/*.ts",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** 假舞台根：只记账样式写入（测试环境没有 DOM） */
function fakeRoot(): HTMLElement {
  return { style: {} } as unknown as HTMLElement;
}

/** 变换串里的数字，顺序 = 平移 x、平移 y、缩放 x、缩放 y */
function numbersOf(transform: string): number[] {
  return (transform.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

describe("舞台适配装配", () => {
  it("基准宽高来自配置：舞台根被写成基准尺寸与等比变换", () => {
    const root = fakeRoot();
    const fit = createAppStageFit({
      readFrame: () => ({ width: 1600, height: 900 }),
      readStageRoot: () => root,
    });
    const layout = fit.apply();
    expect(layout?.scaleX).toBeCloseTo(1.25, 6);
    expect(root.style.width).toBe(`${DEFAULT_STAGE_CONFIG.width}px`);
    expect(root.style.height).toBe(`${DEFAULT_STAGE_CONFIG.height}px`);
    expect(root.style.transform).toBe("translate(0px, 0px) scale(1.25, 1.25)");
    // 先平移再缩放 ⇒ 原点必须左上角；写成中心原点会把偏移量也缩放一遍
    expect(root.style.transformOrigin).toBe("0 0");
  });

  it("留边窗口：缩放取短边，余量按偏移居中", () => {
    const root = fakeRoot();
    const fit = createAppStageFit({
      readFrame: () => ({ width: 1000, height: 1000 }),
      readStageRoot: () => root,
    });
    fit.apply();
    expect(root.style.transform).toBe(
      "translate(0px, 218.75px) scale(0.78125, 0.78125)",
    );
  });

  it("换基准只换配置：竖屏基准也吃得下，尺寸随之改而样式表不动", () => {
    const root = fakeRoot();
    const fit = createAppStageFit({
      readFrame: () => ({ width: 1000, height: 1000 }),
      readStageRoot: () => root,
      config: { width: 750, height: 1334 },
    });
    fit.apply();
    expect(root.style.width).toBe("750px");
    expect(root.style.height).toBe("1334px");
    const [offsetX, offsetY, scaleX, scaleY] = numbersOf(
      root.style.transform ?? "",
    );
    expect(offsetX).toBeCloseTo(218.890555, 6);
    expect(offsetY).toBeCloseTo(0, 6);
    expect(scaleX).toBeCloseTo(1000 / 1334, 6);
    expect(scaleY).toBeCloseTo(scaleX ?? 0, 6);
  });

  it("窗口变化后就地重算：同一个装配连续套用两次不残留旧值", () => {
    const root = fakeRoot();
    let frame = { width: 1600, height: 900 };
    const fit = createAppStageFit({
      readFrame: () => frame,
      readStageRoot: () => root,
    });
    fit.apply();
    frame = { width: 800, height: 900 };
    const layout = fit.apply();
    expect(layout?.scaleX).toBeCloseTo(0.625, 6);
    expect(root.style.width).toBe(`${DEFAULT_STAGE_CONFIG.width}px`);
    expect(root.style.transform).toBe(
      "translate(0px, 225px) scale(0.625, 0.625)",
    );
  });

  it("舞台根未挂载：不写样式、不抛错", () => {
    const fit = createAppStageFit({
      readFrame: () => ({ width: 1600, height: 900 }),
      readStageRoot: () => null,
    });
    expect(fit.apply()).toBeNull();
  });

  it("缺省配置＝引擎内建基准：1280 × 720 完整显示", () => {
    expect(DEFAULT_STAGE_CONFIG.width).toBe(1280);
    expect(DEFAULT_STAGE_CONFIG.height).toBe(720);
    expect(DEFAULT_STAGE_CONFIG.fit).toBe("contain");
    expect(fitSource).toContain("options.config ?? DEFAULT_STAGE_CONFIG");
  });

  it("工程取值只声明在清单里：本工程 shell.stage 与内建基准一致", () => {
    const stage = (
      JSON.parse(manifestSource) as {
        shell?: { stage?: { width?: number; height?: number; fit?: string } };
      }
    ).shell?.stage;
    expect(stage).toEqual({
      width: DEFAULT_STAGE_CONFIG.width,
      height: DEFAULT_STAGE_CONFIG.height,
      fit: DEFAULT_STAGE_CONFIG.fit,
    });
    // 复合根解析后经 props 注入装配：工程取值不在宿主源码里留第二份
    expect(mainSource).toContain("resolveStageConfig(manifest)");
    expect(appSource).toContain("config: props.stage");
    for (const [key, source] of Object.entries(FIT_MODULES)) {
      expect(source, `${key} 又写了一份工程取值`).not.toMatch(
        /PLAYGROUND_STAGE|stage-config/,
      );
    }
    // 原本的本地取值模块已删除：装配目录里只剩出口与装配两个文件
    expect(
      Object.keys(FIT_MODULES)
        .sort()
        .map((key) => key.split("/").pop()),
    ).toEqual(["app-stage-fit.ts", "index.ts"]);
  });

  it("源级：装配不读窗口与文档，读数只经 readFrame 注入", () => {
    expect(fitSource).not.toMatch(/\bwindow\b|\bdocument\b/);
    expect(fitSource).toMatch(/transformOrigin = "0 0"/);
    expect(fitSource).toMatch(/stageTransform\(layout\)/);
  });

  it("宿主接线：尺寸变化监听注册与注销成对", () => {
    for (const type of ["resize", "orientationchange"]) {
      expect(appSource).toContain(
        `window.addEventListener("${type}", applyStageFit)`,
      );
      expect(appSource).toContain(
        `window.removeEventListener("${type}", applyStageFit)`,
      );
    }
    // 挂载期先套一次：外框尺寸只有挂载后才量得到
    expect(appSource).toMatch(
      /applyStageFit\(\);\s*\n\s*window\.addEventListener\("resize"/,
    );
  });

  it("变换分层：适配写舞台根、震动写内容层，两层各写各的 transform", () => {
    // 舞台根归适配装配（宽高与变换都由它写），内容层只是它的孩子
    expect(appSource).toContain("readStageRoot: () => stageEl.value");
    expect(appSource).toContain('ref="stageShakeEl"');
    expect(appSource).toContain('class="stage-shake"');
    expect(appSource).toContain("shakeEl: stageShakeEl");
    // 震动落点必须走内容层：写成舞台根会把整场缩放那一条 transform 覆盖掉
    expect(frameSource).toMatch(/readStage: \(\) => shakeEl\.value/);
    expect(frameSource).not.toMatch(/readStage: \(\) => stageEl\.value/);
    // 内容层撑满舞台根并自带内边距：摆放从舞台根挪到这里，尺寸不能再由根承担
    const shakeBlock = appSource.slice(appSource.indexOf(".stage-shake {"));
    expect(shakeBlock).toContain("width: 100%");
    expect(shakeBlock).toContain("height: 100%");
    expect(shakeBlock).toContain("padding: 22px 40px");
  });

  it("舞台层组件不出现视口单位（缩放会与之叠加成二次自适应）", () => {
    const entries = Object.entries(STAGE_COMPONENTS);
    expect(entries.map(([key]) => key.split("/").pop())).toEqual([
      "ExtensionOverlayCard.vue",
    ]);
    for (const [key, source] of entries) {
      // 只看生效的声明：注释里提到旧值（「46vh @ 720 基准」这类换算记账）不算违规
      const declarations = source.replace(/\/\*[\s\S]*?\*\//g, "");
      expect(declarations, `${key} 用了视口单位`).not.toMatch(
        /[0-9]+\.?[0-9]*(vw|vh|vmin|vmax)\b|clamp\(/,
      );
    }
  });

  it("UI 层组件按窗口折算尺寸：随窗口自适应，不随舞台缩放", () => {
    const entries = Object.entries(SHELL_UI_COMPONENTS);
    expect(entries.map(([key]) => key.split("/").pop()).sort()).toEqual([
      "DialoguePanel.vue",
      "NotificationLayer.vue",
      "SettingsPanels.vue",
      "ToolbarPanel.vue",
    ]);
    for (const [key, source] of entries) {
      const declarations = source.replace(/\/\*[\s\S]*?\*\//g, "");
      expect(declarations, `${key} 没有随窗口折算的尺寸`).toMatch(
        /[0-9]+\.?[0-9]*(vw|vh)\b/,
      );
    }
    // 会接事件的部件各自恢复指针事件（UI 层容器是 none，点击要穿到舞台与外框）
    for (const name of ["ToolbarPanel", "DialoguePanel", "SettingsPanels"]) {
      const source = entries.find(([key]) => key.endsWith(`${name}.vue`))?.[1];
      expect(source, `${name} 缺 pointer-events: auto`).toContain(
        "pointer-events: auto",
      );
    }
    // 提示条不可交互：容器保持穿透
    const notify = entries.find(([key]) =>
      key.endsWith("NotificationLayer.vue"),
    )?.[1];
    expect(notify).not.toContain("pointer-events: auto");
  });

  it("两层分组盖全组件目录：新增组件不能悄悄漏检", () => {
    const classified = [
      ...Object.keys(STAGE_COMPONENTS),
      ...Object.keys(SHELL_UI_COMPONENTS),
      ...Object.keys(SHELL_UI_CONTAINERS),
    ].sort();
    expect(classified).toEqual(Object.keys(ALL_APP_COMPONENTS).sort());
  });

  it("UI 层是舞台根的兄弟：UI 不在缩放里，扩展覆盖层仍在舞台里", () => {
    const mainClose = appSource.indexOf("</main>");
    const uiLayer = appSource.indexOf('class="shell-ui"');
    expect(mainClose).toBeGreaterThan(-1);
    expect(uiLayer).toBeGreaterThan(mainClose);
    for (const tag of [
      "<ToolbarPanel",
      "<NotificationLayer",
      "<DialoguePanel",
      "<SettingsPanels",
    ]) {
      expect(appSource.indexOf(tag), `${tag} 应住在 UI 层`).toBeGreaterThan(
        uiLayer,
      );
    }
    expect(appSource.indexOf("<ExtensionOverlayCard")).toBeLessThan(mainClose);
    // UI 层容器铺满窗口但不吃指针事件：点击与滚轮要落到舞台与外框上
    const uiBlock = appSource.slice(uiLayer, appSource.indexOf(".error {"));
    expect(uiBlock).toContain("position: fixed");
    expect(uiBlock).toContain("inset: 0");
    expect(uiBlock).toContain("display: flex");
    expect(uiBlock).toContain("pointer-events: none");
  });

  it("UI 层自带文字默认值，且与舞台根同色（它住在舞台外，继承不到那套外观）", () => {
    const blockOf = (selector: string) => {
      const start = appSource.indexOf(`${selector} {`);
      expect(start, `缺 ${selector} 样式块`).toBeGreaterThan(-1);
      const block = appSource.slice(start);
      return block.slice(0, block.indexOf("}"));
    };
    const stageColor = /color:\s*(#[0-9a-f]{3,8})/i.exec(
      blockOf(".stage"),
    )?.[1];
    expect(stageColor).toBeDefined();
    const uiBlock = blockOf(".shell-ui");
    expect(uiBlock).toMatch(/color:\s*#[0-9a-f]{3,8}/i);
    expect(/color:\s*(#[0-9a-f]{3,8})/i.exec(uiBlock)?.[1]).toBe(stageColor);
    expect(uiBlock).toContain("font-size:");
  });
});
