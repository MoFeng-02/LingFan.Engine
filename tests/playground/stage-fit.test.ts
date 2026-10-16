/**
 * 舞台适配装配：读数（外框）→ 计算（`@lingfan/shell`）→ 落笔（舞台根样式）。
 *
 * 舞台原是「作者像素 = 屏幕像素」，窗口一变内容尺寸不变；装配把基准宽高与变换写进舞台根，
 * 同一份作者坐标于是在任意窗口下等比呈现。这里钉住四件事：基准来自配置而不是样式表、
 * 变换顺序是「先平移再缩放」、窗口变化后能就地重算、舞台子树内不许出现视口单位
 * （视口单位先按真实窗口解析、再被舞台缩放一次，等于随窗口二次变化）。
 *
 * 读数只走注入的 `readFrame`：装配本身不碰窗口全局，小程序宿主换掉读数来源即可复用。
 * 宿主侧的监听注册与注销成对写在本组件里，源级断言防止只留一半。
 */
import { describe, expect, it } from "vitest";
import appSource from "../../apps/playground/src/App.vue?raw";
import fitSource from "../../apps/playground/src/host/stage/fit/app-stage-fit.ts?raw";
import frameSource from "../../apps/playground/src/host/stage/frame/app-frame.ts?raw";
import {
  createAppStageFit,
  PLAYGROUND_STAGE_CONFIG,
  PLAYGROUND_STAGE_HEIGHT,
  PLAYGROUND_STAGE_WIDTH,
} from "../../apps/playground/src/host/stage/fit";

/** 舞台子树组件（都在舞台根内，故都不该出现视口单位） */
const STAGE_COMPONENTS = import.meta.glob(
  "../../apps/playground/src/App/*.vue",
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
    expect(root.style.width).toBe(`${PLAYGROUND_STAGE_WIDTH}px`);
    expect(root.style.height).toBe(`${PLAYGROUND_STAGE_HEIGHT}px`);
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
    expect(root.style.width).toBe(`${PLAYGROUND_STAGE_WIDTH}px`);
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

  it("缺省配置＝本工程基准：1280 × 720 完整显示", () => {
    expect(PLAYGROUND_STAGE_CONFIG.width).toBe(1280);
    expect(PLAYGROUND_STAGE_CONFIG.height).toBe(720);
    expect(PLAYGROUND_STAGE_CONFIG.fit).toBe("contain");
    expect(PLAYGROUND_STAGE_WIDTH).toBe(PLAYGROUND_STAGE_CONFIG.width);
    expect(PLAYGROUND_STAGE_HEIGHT).toBe(PLAYGROUND_STAGE_CONFIG.height);
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

  it("舞台子树内不出现视口单位（缩放会与之叠加成二次自适应）", () => {
    const keys = Object.keys(STAGE_COMPONENTS);
    expect(keys.length).toBeGreaterThanOrEqual(6);
    for (const [key, source] of Object.entries(STAGE_COMPONENTS)) {
      // 只看生效的声明：注释里提到旧值（「46vh @ 720 基准」这类换算记账）不算违规
      const declarations = source.replace(/\/\*[\s\S]*?\*\//g, "");
      expect(declarations, `${key} 用了视口单位`).not.toMatch(
        /[0-9]+\.?[0-9]*(vw|vh|vmin|vmax)\b|clamp\(/,
      );
    }
  });
});
