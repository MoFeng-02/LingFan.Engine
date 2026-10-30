/**
 * 启动界面与渲染切换：源码级互锁。
 *
 * 这条判据的**行为**部分拆在别处：屏幕判定「列 id 空串 / 列类型不是 game」是纯函数
 * （`packages/ui/src/screen/`），加载与卸载的差量归宿主 `switch.ts`。本文件守的是
 * 三类「编译得过、跑起来也像在工作」的接线错误：
 *
 * 1. **舞台不许进条件分支**。舞台节点在装配期就被 `must()` 抓住，一旦被 `v-if` 摘掉，
 *    下一帧 `must` 拿不到它，宿主手上的句柄会变成指向已脱离文档的节点——症状不是黑屏，
 *    是没有装配。所以真正的判据不是「两界面不同时存在」，而是「两界面不同时可见、
 *    不同时参与交互与无障碍树」。
 * 2. **判据必须是列类型而不是列名白名单**。写死列名换个工程就指到不存在的列。
 * 3. **启动界面自身的挂载/卸载是真的**。舞台常驻不等于启动界面也常驻：它必须能反复
 *    进出，且每次进来都是新实例（旧实例的焦点与绑定闭包不能留在原地）。
 *
 * 判据只看剥掉注释后的代码骨架：注释里写「舞台要常驻」不算违规，写了代码才算。
 */
import { describe, expect, it } from "vitest";
import nativeHtml from "../../template/v1/__PROJECT__/index.html?raw";
import nativeEntry from "../../template/v1/__PROJECT__/src/main.ts?raw";
import nativeSwitch from "../../template/v1/__PROJECT__/src/host/switch.ts?raw";
import nativeBoot from "../../template/v1/__PROJECT__/src/host/boot.ts?raw";
import nativeScreenView from "../../template/v1/__PROJECT__/src/host/screen/view.ts?raw";
import vueApp from "../../template/v1/overlays/vue/src/App.vue?raw";
import vueStart from "../../template/v1/overlays/vue/src/StartScreen.vue?raw";
import vueEntry from "../../template/v1/overlays/vue/src/main.ts?raw";
import reactApp from "../../template/v1/overlays/react/src/App.tsx?raw";
import reactStart from "../../template/v1/overlays/react/src/StartScreen.tsx?raw";
import reactEntry from "../../template/v1/overlays/react/src/main.tsx?raw";

/** 剥注释：判据只看代码骨架（HTML 注释、JS 块注释与行注释） */
function code(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** 舞台节点 id：它们必须一直留在页面结构里，不进任何条件分支 */
const STAGE_IDS = [
  "stage-root",
  "stage",
  "nvl",
  "dialogue",
  "speaker",
  "text",
  "hint",
];

/** 三种形态的落点：视图、入口、启动界面 */
const FORMS = [
  { id: "原生", view: nativeHtml, entry: nativeEntry, start: nativeScreenView },
  { id: "Vue", view: code(vueApp), entry: vueEntry, start: code(vueStart) },
  {
    id: "React",
    view: code(reactApp),
    entry: reactEntry,
    start: code(reactStart),
  },
];

describe("启动界面：舞台常驻", () => {
  it("三形态的页面结构都渲染出全部舞台节点", () => {
    for (const form of FORMS) {
      for (const id of STAGE_IDS) {
        expect(form.view, `${form.id} 缺舞台节点 #${id}`).toContain(
          `id="${id}"`,
        );
      }
    }
  });

  it("框架形态的启动界面不是舞台的兄弟分支（不进 v-if 的另一支）", () => {
    // v-else 让两块互斥：舞台进了假分支就被摘掉，`must()` 当场拿不到节点
    expect(code(vueApp)).not.toMatch(/v-else/);
    expect(code(reactApp)).not.toMatch(/<StartScreen\s*\/>\s*\)\s*:\s*\(/);
  });

  it("启动界面自己在场时把舞台让位，且让位数与舞台层数对得上", () => {
    // 只写 inert 会留下「摸得到但点不动」，只写 aria-hidden 会留下「看不见却被读出来」
    expect(nativeSwitch).toContain('setAttribute("inert"');
    expect(nativeSwitch).toContain('setAttribute("aria-hidden"');
    expect(nativeSwitch).toContain('removeAttribute("inert")');
    expect(nativeSwitch).toContain('removeAttribute("aria-hidden")');
  });
});

describe("启动界面：判据是列类型不是列名白名单", () => {
  it("宿主切换按当前列类型判断，不出现写死的列名", () => {
    const written = code(nativeSwitch);
    expect(written).toContain("currentColumnType()");
    expect(written).not.toMatch(/"(chapter[0-9]+|title_main|__PROJECT__)"/);
  });

  it("三形态组合根都不把屏幕态写死：屏幕态只从宿主推来", () => {
    for (const form of FORMS) {
      const entry = code(form.entry);
      expect(entry, `${form.id} 组合根没有把屏幕态交给宿主推`).not.toContain(
        'screen: "',
      );
    }
  });
});

describe("启动界面：自身真挂真卸", () => {
  it("框架形态的启动界面按屏幕态真挂假挂，不是 display:none", () => {
    expect(code(vueStart)).toContain("v-if=");
    expect(code(vueStart)).not.toContain("display: none");
    expect(code(reactStart)).toContain("return null");
  });

  it("原生形态每次进启动界面都造新节点（旧节点可能留着焦点与闭包）", () => {
    const written = code(nativeSwitch);
    expect(written).toContain("createStartScreenElement(view)");
    expect(written).toContain("replaceWith(next)");
  });

  it("原生形态的启动界面容器不吃舞台的推进点击", () => {
    expect(code(nativeSwitch)).toContain("stopPropagation()");
  });
});

describe("启动界面：值从宿主来，不从组件里猜", () => {
  it("三种形态都不读本地字面量标题（标题来自工程清单）", () => {
    for (const form of FORMS) {
      expect(form.start, `${form.id} 的启动界面写死了标题`).not.toContain(
        "__PROJECT__",
      );
    }
  });

  it("「继续」的可用性由屏幕态决定，不在组件里查存档", () => {
    expect(nativeScreenView).toContain("resume.slot");
    expect(nativeScreenView).not.toContain("list(");
    expect(code(vueStart)).toContain("resumable");
    expect(code(reactStart)).toContain("resumeSlot");
  });

  it("宿主把「开始」翻成具体列 id：没有可进入的列就报错而不是空导航", () => {
    expect(nativeSwitch).toContain("firstGameColumn(");
    expect(nativeSwitch).toContain("reportError(");
  });

  it("装配顺序：屏幕切换在引擎启动之前接好，拆除在引擎销毁之前", () => {
    const boot = code(nativeBoot);
    const wire = boot.indexOf("createScreenSwitch({");
    const start = boot.indexOf("engine.start()");
    const dispose = boot.indexOf("screenSwitch.dispose()");
    expect(wire).toBeGreaterThan(0);
    expect(start).toBeGreaterThan(wire);
    expect(dispose).toBeGreaterThan(start);
  });
});
