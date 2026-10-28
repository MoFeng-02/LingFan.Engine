/**
 * **宿主句柄**：`bootHost` 交出的那三样东西，以及它与既有组合根的向后兼容。
 *
 * 为什么是源码互锁而不是单元测试：`bootHost` 要 fetch、localStorage、VideoPort 全套，
 * 跑不起来；而这里要守的恰恰是**装配层的形状**——句柄里有谁、引擎是不是同一个实例、
 * 拆除顺序对不对。这些一旦漏，在用户工程里就是「两个引擎互相踩存档」或
 * 「先拆引擎导致渲染器回调打到死实例」，都在启动那一刻就炸。
 *
 * 三件事分开验：
 * 1. **句柄形状**：返回类型是 `Promise<HostHandle>`，字段齐（`engine` / `preferences` /
 *    `dispose`），并且 `preferences` 必有（本宿主恒定接线偏好层，调用方不必判空）；
 * 2. **同一实例**：`boot.ts` 只有一处 `new StoryEngine(`——单构造点 + 按名返回，
 *    句柄里那个 `engine` 不可能是第二个引擎；拆除按依赖反序且幂等；
 * 3. **向后兼容**：既有组合根一行不改——不取返回值的写法照旧编译通过（不出现
 *    `HostHandle` / 不解构返回对象），`await bootHost(...)` 与 `void bootHost(...)` 都在。
 *
 * 用 `?raw` 读文本而不碰 fs：`tests/template` 属前端域，禁 Node 导入。
 */
import { describe, expect, it } from "vitest";
import bootSource from "../../template/v1/__PROJECT__/src/host/boot.ts?raw";
import handleSource from "../../template/v1/__PROJECT__/src/host/index.ts?raw";
import skeletonMain from "../../template/v1/__PROJECT__/src/main.ts?raw";
import vueMain from "../../template/v1/overlays/vue/src/main.ts?raw";
import reactMain from "../../template/v1/overlays/react/src/main.tsx?raw";
import tauriMain from "../../template/v1/overlays/tauri/src/main.ts?raw";

/**
 * 截出源码里的一段块：从 `open` 起，到其后第一处顶格的 `}` 所在行**整行**止。
 *
 * 只用于「某个声明内部有什么」这类断言——全文搜会把别处的同名标识符也算进来。
 */
function block(source: string, open: string): string {
  const at = source.indexOf(open);
  if (at < 0) return "";
  const close = source.indexOf("\n}", at);
  if (close < 0) return source.slice(at);
  // 顶格 `}` 之后可能还跟着 `from "..."` / `;`，一律算进这一段
  const lineEnd = source.indexOf("\n", close + 1);
  return source.slice(at, lineEnd < 0 ? source.length : lineEnd);
}

/** 拆除段：幂等标志与函数体连着看（标志声明在函数外，只取函数体会漏掉它） */
const DISPOSE_BLOCK = (() => {
  const start = bootSource.indexOf("let disposed = false;");
  const end = bootSource.indexOf("return { engine, preferences, dispose };");
  return start < 0 || end < 0 ? "" : bootSource.slice(start, end);
})();
/** 句柄接口体 */
const HANDLE_BLOCK = block(bootSource, "export interface HostHandle {");

describe("宿主句柄 · 形状", () => {
  it("**`bootHost` 返回 `Promise<HostHandle>`**（不再交 `void`）", () => {
    expect(bootSource).toContain(
      "export async function bootHost(options: HostBootOptions): Promise<HostHandle>",
    );
  });

  it("**三字段齐**：`engine` / `preferences` / `dispose`", () => {
    expect(HANDLE_BLOCK).not.toBe("");
    expect(HANDLE_BLOCK).toContain("engine: StoryEngine;");
    expect(HANDLE_BLOCK).toContain("preferences: PlayerPreferences;");
    expect(HANDLE_BLOCK).toContain("dispose(): void;");
  });

  it("**`preferences` 必有**（不写成 `preferences?:`，调用方不判空）", () => {
    expect(HANDLE_BLOCK).not.toContain("preferences?:");
    expect(HANDLE_BLOCK).not.toContain("preferences: PlayerPreferences |");
  });

  it("`engine` 类型取自引擎包，不是本地再造的窄接口", () => {
    // 宽化成 `{ start(): void }` 之类会让宿主拿不到 `columns()` / `on()` / `gameState`
    expect(HANDLE_BLOCK).toContain("engine: StoryEngine;");
    expect(HANDLE_BLOCK).not.toContain("engine: {");
  });

  it("**返回值里三项按名交出**（不是新造对象、不是包装）", () => {
    expect(bootSource).toContain("return { engine, preferences, dispose };");
  });

  it("`host/index.ts` 同步转发 `HostHandle` 类型与 `bootHost`", () => {
    const reexport = block(handleSource, "export {\n  bootHost,");
    expect(reexport).toContain("bootHost,");
    expect(reexport).toContain("type HostHandle,");
    // 转发来源按全文断言：块的边界停在顶格 `}`，够不到同一行的 `from "..."`
    expect(handleSource).toContain('} from "./boot";');
  });
});

describe("宿主句柄 · 句柄里的引擎就是宿主内部那个", () => {
  it("**`boot.ts` 只有一个构造点**（第二个引擎会与第一个抢同一份存档）", () => {
    // 只数赋值形态：文档注释里提一句构造器名字不算第二个引擎
    const constructed = bootSource.match(/=\s*new StoryEngine\(/g) ?? [];
    expect(constructed).toHaveLength(1);
  });

  it("构造出来的变量就叫 `engine`，且被同一处返回", () => {
    // 只锁「变量名 = engine」与「构造参数里确实给了存档端口」这两件事：
    // 选项表会随宿主能力增长（层级表、工程默认音量…），逐字比对会把每次新增都变成假红。
    expect(bootSource).toMatch(
      /const engine = new StoryEngine\(\s*story,\s*\{[\s\S]*?savePort,[\s\S]*?\}\s*\);/,
    );
    // 构造之后没有改名/再赋值：`engine` 一直是这一个实例
    expect(bootSource).not.toContain("let engine =");
    // 行首直接赋值才是「换掉句柄里那个引擎」的形态；`const engine = new ...` 不算
    expect(bootSource).not.toMatch(/\n\s*engine = new StoryEngine\(/);
  });

  it("**交给引擎的适配器就是句柄期间在用的那几个**（渲染器订阅同一实例）", () => {
    // 音频与视频都从 `engine` 起，因此它们的 dispose 必须在 engine.dispose() 之前
    expect(bootSource).toContain("createAudioRenderer(engine");
    expect(bootSource).toContain("createVideoRenderer(engine");
    // 接线与输入映射也挂在同一个变量上
    expect(bootSource).toContain("wireEngine({");
    expect(bootSource).toContain("wireInput({ dom, engine, dialogue });");
  });

  it("`engine.start()` 只在末尾调一次（句柄交出时故事已在跑）", () => {
    const calls = bootSource
      .split("\n")
      .filter((line) => /^\s*engine\.start\(\);/.test(line));
    expect(calls).toHaveLength(1);
  });

  it("句柄里没有可写句柄泄漏（字段是 getter 之外的纯数据/方法）", () => {
    // 宿主自己改 `handle.engine = ...` 会把引擎换成第二个实例；`readonly` 挡住它
    expect(HANDLE_BLOCK).toContain("readonly engine: StoryEngine;");
    expect(HANDLE_BLOCK).toContain("readonly preferences: PlayerPreferences;");
  });
});

describe("宿主句柄 · 拆除顺序与幂等", () => {
  it("**幂等**：重复调用只生效第一次", () => {
    expect(DISPOSE_BLOCK).toContain("let disposed = false;");
    expect(DISPOSE_BLOCK).toContain("if (disposed) return;");
    expect(DISPOSE_BLOCK).toContain("disposed = true;");
  });

  it("**先停帧**（停之前任何一次回调都还可能进来）", () => {
    const stopAt = DISPOSE_BLOCK.indexOf("frameLoop.stop()");
    expect(stopAt).toBeGreaterThanOrEqual(0);
    // 停帧是拆除的第一步：它前面只允许幂等守卫
    expect(DISPOSE_BLOCK.indexOf("disposed = true;")).toBeLessThan(stopAt);
  });

  it("**渲染器先于引擎**（引擎先死，订阅回调会打到已销毁实例上）", () => {
    const audioAt = DISPOSE_BLOCK.indexOf("audio.dispose()");
    const videoAt = DISPOSE_BLOCK.indexOf("video.dispose()");
    const engineAt = DISPOSE_BLOCK.indexOf("engine.dispose()");
    expect(audioAt).toBeGreaterThanOrEqual(0);
    expect(videoAt).toBeGreaterThan(audioAt);
    expect(engineAt).toBeGreaterThan(videoAt);
  });

  it("**偏好最后收尾**（补发防抖窗内未落盘的末次修改）", () => {
    const engineAt = DISPOSE_BLOCK.indexOf("engine.dispose()");
    const prefsAt = DISPOSE_BLOCK.indexOf("preferences.dispose()");
    expect(prefsAt).toBeGreaterThan(engineAt);
  });

  it("面板在偏好之前拆（它订阅偏好层，偏好先死会漏末次回填）", () => {
    const panelAt = DISPOSE_BLOCK.indexOf("prefsPanel?.destroy()");
    const prefsAt = DISPOSE_BLOCK.indexOf("preferences.dispose()");
    expect(panelAt).toBeGreaterThanOrEqual(0);
    expect(panelAt).toBeLessThan(prefsAt);
  });

  it("六步全部在拆除体内（拆了帧、面板、两个渲染器、引擎、偏好）", () => {
    for (const step of [
      "frameLoop.stop()",
      "prefsPanel?.destroy()",
      "audio.dispose()",
      "video.dispose()",
      "engine.dispose()",
      "preferences.dispose()",
    ]) {
      expect(DISPOSE_BLOCK).toContain(step);
    }
  });
});

describe("向后兼容 · 既有组合根一行不改", () => {
  /** 四个组合根：骨架 + 三个叠加层（小程序壳不调 `bootHost`，另算） */
  const CALL_SITES = [
    ["骨架", skeletonMain, "void bootHost({"],
    ["vue", vueMain, "void bootHost({"],
    ["react", reactMain, "void bootHost({"],
    ["tauri", tauriMain, "await bootHost({"],
  ] as const;

  it("四处调用形态原样保留（`void` 三处 + `await` 一处）", () => {
    for (const [name, source, call] of CALL_SITES) {
      expect(source, name).toContain(call);
    }
  });

  it("**不取返回值也编译通过**：组合根不出现 `HostHandle`", () => {
    // 返回值从 void 变成句柄，忽略它是合法的；一旦某处开始接住再判空，
    // 这层互锁就失效了（那意味着兼容性不再由语言层面兜底，而是靠调用方小心）
    for (const [name, source] of CALL_SITES) {
      expect(source, name).not.toContain("HostHandle");
    }
  });

  it("组合根不解构返回对象（不因此变成「必须接住」）", () => {
    for (const [name, source] of CALL_SITES) {
      expect(source, name).not.toContain("} = bootHost(");
      expect(source, name).not.toContain("} = await bootHost(");
      expect(source, name).not.toContain("const handle");
    }
  });

  it("失败路径仍归宿主的 `reportBootFailure`（句柄不接管错误提示）", () => {
    for (const [name, source] of CALL_SITES) {
      expect(source, name).toContain("reportBootFailure(dom, error)");
      expect(source, name).toContain(".catch((error: unknown) => {");
    }
  });

  it("`tauri` 的 `await` 在 `Promise<void>` 的 `boot()` 里（返回句柄不改变它）", () => {
    expect(tauriMain).toContain("async function boot(): Promise<void>");
    expect(tauriMain).toContain("await bootHost({");
  });

  it("组合根仍走 `./host` 出口取 `bootHost`（不深入 `host/boot`）", () => {
    for (const [name, source] of CALL_SITES) {
      expect(source, name).not.toContain("host/boot");
    }
  });
});
