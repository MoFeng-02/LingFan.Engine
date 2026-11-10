/**
 * 模板宿主的舞台适配互锁：三层节点、接线归属、唯一变换写入者，以及 UI 层的响应式口径。
 *
 * 这些约束的形状都是「某个名字只许出现在某个地方」——跑一次装配只能证明当下这一版通了，
 * 下次有人把 fitter 塞回组合根、或在舞台根上另写一次变换，它照样通。所以判据落在
 * **源码文本**上，并且按目录取原文（新增宿主文件自动纳入）。
 *
 * 关键：先剥注释再匹配。否则「把接线注释掉」会让用例继续绿——这类假绿在本仓出现过。
 *
 * 读文本用 `?raw` / `import.meta.glob` 而不碰 fs：`tests/template` 属前端域，禁 Node 导入。
 * 样式表是唯一例外——见下方 `readStyleTable` 的理由。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import stageFitSource from "../../template/v1/__PROJECT__/src/host/stage-fit.ts?raw";
import bootSource from "../../template/v1/__PROJECT__/src/host/boot.ts?raw";
import effectsSource from "../../template/v1/__PROJECT__/src/host/effects.ts?raw";
import skeletonMain from "../../template/v1/__PROJECT__/src/main.ts?raw";
import skeletonHtml from "../../template/v1/__PROJECT__/index.html?raw";
import vuePage from "../../template/v1/overlays/vue/src/App.vue?raw";
import reactPage from "../../template/v1/overlays/react/src/App.tsx?raw";

/**
 * 模板样式表按字节读：vitest 的 `?raw` 对 `.css` 会被 stub 成空串（`css: false`），
 * 拿它做断言只会得到「找不到」，不是「没写」。
 */
function readStyleTable(): string {
  return readFileSync(
    fileURLToPath(
      new URL(
        "../../template/v1/__PROJECT__/src/styles/stage.css",
        import.meta.url,
      ),
    ),
    "utf8",
  );
}

/** 模板宿主全部源码（键 = 相对仓根的路径，值 = 原文） */
const HOST_SOURCES = import.meta.glob(
  "../../template/v1/__PROJECT__/src/**/*.ts",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** 宿主文件的短名（`host/boot.ts` 这种），失败信息里更好读 */
function shortName(path: string): string {
  const marker = "/__PROJECT__/src/";
  const at = path.indexOf(marker);
  return at < 0 ? path : path.slice(at + marker.length);
}

/** 去块注释（含 JSX 的 `{/* … *\/}` 外壳）与行注释；`://` 不当行注释切 */
function stripCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'\w])\/\/.*$/gm, "$1");
}

/** 去 HTML 注释：页面结构与样式表里没有行注释概念 */
function stripMarkup(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 出现次数（断言「恰好一处」「零处」用） */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** 一份宿主源码里出现某串的文件短名清单 */
function filesContaining(needle: string): string[] {
  return Object.keys(HOST_SOURCES)
    .filter((path) => stripCode(HOST_SOURCES[path] ?? "").includes(needle))
    .map(shortName)
    .sort();
}

const hostText = Object.keys(HOST_SOURCES)
  .sort()
  .map((path) => stripCode(HOST_SOURCES[path] ?? ""))
  .join("\n");

const fitText = stripCode(stageFitSource);
const bootText = stripCode(bootSource);
const effectsText = stripCode(effectsSource);

describe("模板舞台适配：接线归属", () => {
  it("适配编排住在 host/stage-fit.ts，组合根只调用接线函数", () => {
    // 编排与装配是两件事：混在一起会让 boot 同时负责端口、引擎、面板与几何。
    expect(fitText).toContain("createStageFitter");
    expect(fitText).toContain("createStagePort");
    expect(fitText).toContain("fitter.refresh()");

    expect(bootText).toContain("wireStageFit(");
    // 组合根不直接建 fitter / port：建了就说明接线被绕过，监听成对也无从谈起
    expect(bootText).not.toContain("createStageFitter");
    expect(bootText).not.toContain("createStagePort");
  });

  it("适配配置在 boot 内部按清单解析，组合根不解析", () => {
    // 清单在 boot 内部才装载（组合根拿不到它的时机比装配更早），
    // 所以「按清单取 shell.stage」这件事只能发生在 boot 里。
    expect(bootText).toContain("resolveStageConfig(manifest, options.stage)");
    expect(bootText).toContain("stage?: StageConfig");
    expect(stripCode(skeletonMain)).not.toContain("resolveStageConfig");
  });

  it("读数只经视口外框，不量已被缩放的舞台根", () => {
    // 量 stageRoot 会量到缩放后的尺寸，于是每帧越量越小——这是本条要守的错法。
    expect(fitText).toContain("dom.viewport.clientWidth");
    expect(fitText).toContain("dom.viewport.clientHeight");
    expect(fitText).not.toContain("dom.stageRoot.client");
    expect(hostText).not.toContain("stageRoot.client");
  });
});

describe("模板视频端口：填充读元素表，不写死缺省", () => {
  it("boot 的 createWebVideoPort 用 videoFitOf 求填充", () => {
    // 视频层一屏只有一个呈现层，填充方式只能来自当前元素表：端口在挂载时才求值，
    // 换列或元素被替换后自动跟随。写死缺省词会让「video 上写了 stretch」在浏览器端
    // 独独不生效——三端语义不一致里最难查的那一类，且只在某一端显形。
    expect(bootText).toContain("createWebVideoPort(");
    expect(bootText).toMatch(/fit:\s*\(\)\s*=>\s*videoFitOf\(/);
    // 缺省词的回退只许有一层，在引擎侧（`videoFitOf` 内部）；宿主自己再兜一层
    // 就等于把「作者写了但写错」与「作者没写」压成同一种行为，诊断也就无从提示。
    expect(bootText).not.toContain("DEFAULT_ELEMENT_FIT");
  });
});

describe("模板舞台适配：变换写入者纪律", () => {
  it("震动只写震动层，且不再引用已删除的 root 字段", () => {
    expect(effectsText).toContain("dom.shake.style.transform");
    // `root` 字段已删：留着它就是两个坐标系，震动会带着舞台根一起位移
    expect(effectsText).not.toContain("dom.root");
    expect(hostText).not.toContain("dom.root");
  });

  it("整个宿主里只有 effects.ts 写 style.transform，恰好两处且都指向震动层", () => {
    // 变换串由 shell 侧的舞台端口拼（`stageTransform`），宿主不自己拼；
    // 宿主的唯一变换写手是震动，且只写位移分量，缩放留在父层。
    const writers = filesContaining("style.transform");
    expect(writers).toEqual(["host/effects.ts"]);
    expect(count(effectsText, "style.transform")).toBe(2);
    expect(count(effectsText, "dom.shake.style.transform")).toBe(2);
    // 舞台几何模块（节点句柄表）不许写变换：它的职责是解析节点
    expect(
      stripCode(
        HOST_SOURCES["../../template/v1/__PROJECT__/src/host/stage-dom.ts"] ??
          "",
      ),
    ).not.toContain("style.transform");
  });

  it("窗口监听成对：resize 与 orientationchange 各注册一次、各摘除一次", () => {
    // 宿主可能在同一页面被拆除重建，漏摘除会累积监听并在旧节点上重算。
    for (const event of ["resize", "orientationchange"]) {
      expect(
        count(hostText, `addEventListener("${event}"`),
        `${event} 注册次数`,
      ).toBe(1);
      expect(
        count(hostText, `removeEventListener("${event}"`),
        `${event} 摘除次数`,
      ).toBe(1);
    }
    expect(filesContaining('addEventListener("resize"')).toEqual([
      "host/stage-fit.ts",
    ]);
    expect(filesContaining('removeEventListener("resize"')).toEqual([
      "host/stage-fit.ts",
    ]);
  });
});

describe("模板页面结构：三层各住一个坐标系", () => {
  /** 带 id 的 div 及其在 div 树里的深度与出现序（只为判兄弟与先后） */
  interface DivAt {
    id: string;
    depth: number;
    order: number;
  }

  function divIds(source: string): DivAt[] {
    const out: DivAt[] = [];
    let depth = 0;
    let order = 0;
    for (const match of source.matchAll(/<div\b[^>]*>|<\/div>/g)) {
      const token = match[0];
      if (token.startsWith("</")) {
        depth = Math.max(0, depth - 1);
        continue;
      }
      const id = /\bid="([\w-]+)"/.exec(token)?.[1];
      if (id !== undefined) out.push({ id, depth, order: order++ });
      depth += 1;
    }
    return out;
  }

  /** 视口的直接子节点，按出现序 */
  function viewportChildren(source: string): string[] {
    const divs = divIds(source);
    const viewport = divs.find((d) => d.id === "stage-viewport");
    expect(viewport, "页面缺 #stage-viewport").toBeDefined();
    if (viewport === undefined) return [];
    return divs
      .filter((d) => d.depth === viewport.depth + 1 && d.order > viewport.order)
      .map((d) => d.id);
  }

  const pages: ReadonlyArray<readonly [string, string]> = [
    ["骨架 index.html", stripMarkup(skeletonHtml)],
    ["Vue 页面", stripMarkup(vuePage)],
    ["React 页面", stripMarkup(reactPage)],
  ];

  it.each(pages)(
    "%s：舞台根、宿主 UI 层、转场遮罩是视口的三个兄弟且按此序",
    (_label, source) => {
      // 转场要盖住整屏（含舞台与 UI 层），所以它是视口的兄弟而不是 UI 层的孩子；
      // UI 层按窗口像素排布，舞台根按设计基准缩放——两者必须是兄弟，不能嵌套。
      expect(viewportChildren(source)).toEqual([
        "stage-root",
        "shell-ui",
        "transition",
      ]);
    },
  );

  it("震动层住在舞台根之内、舞台与挂载层住在震动层之内", () => {
    const divs = divIds(stripMarkup(skeletonHtml));
    const byId = new Map(divs.map((d) => [d.id, d]));
    expect(byId.get("stage-shake")?.depth).toBe(
      (byId.get("stage-root")?.depth ?? 0) + 1,
    );
    for (const id of ["stage", "mounts"]) {
      expect(byId.get(id)?.depth).toBe(
        (byId.get("stage-shake")?.depth ?? 0) + 1,
      );
    }
  });
});

describe("模板样式表：响应式单位只许出现在 UI 层", () => {
  const css = stripMarkup(readStyleTable());
  const uiSlice = css.slice(css.indexOf("#shell-ui {"));

  it("UI 层整段带 clamp()，不写死像素", () => {
    // 整段而不是单条规则体：#shell-ui 自己没有尺寸，写了 clamp 的是它下面那批
    expect(uiSlice.length).toBeGreaterThan(0);
    expect(count(uiSlice, "clamp(")).toBeGreaterThanOrEqual(3);
  });

  it("舞台侧四条规则零 clamp/vw/vh：几何由适配算，不由视口单位算", () => {
    // 舞台根一旦用视口单位，基准就不成立了——适配写进去的宽高会被样式表覆盖。
    for (const selector of [
      "#stage-viewport",
      "#stage-root",
      "#stage-shake",
      "#stage",
    ]) {
      const rule = new RegExp(`\\n${selector} \\{([^}]*)\\}`).exec(css);
      expect(rule, `样式表缺 ${selector} 规则`).not.toBeNull();
      const body = rule?.[1] ?? "";
      for (const unit of ["clamp(", "vw", "vh"]) {
        expect(body, `${selector} 里不该出现 ${unit}`).not.toContain(unit);
      }
    }
  });

  it("UI 层的原生控件有兜底放行，面板作者漏写容器也不失活", () => {
    // 整层 pointer-events: none 才能让空白处的点击穿到舞台上推进对话；
    // 兜底网把原生控件的可点性还回来。
    expect(css).toContain(
      "#shell-ui :is(button, input, textarea, select):not(:disabled)",
    );
    expect(css).toContain("pointer-events: auto");
  });
});
