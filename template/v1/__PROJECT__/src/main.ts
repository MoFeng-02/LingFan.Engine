/**
 * 组合根（唯一全知位置：装配适配器 → 加载组装工程 → 建引擎 → 挂载展示层）。
 *
 * 本宿主**不依赖任何 UI 框架**——这是「引擎框架无关」的活证明：渲染直接操作 DOM，
 * 换成 Vue / React / 其他只改本文件与 index.html，引擎与适配器零改动。
 * 全功能参考实现（打字机细节/NVL/历史面板/存读档/音频四通道/键位）见引擎仓库 `apps/playground`。
 *
 * 接线顺序（规约 00 §3.3 分工铁律 / 08-U1 只写状态 + 订阅渲染）：
 *   1. 装配适配器：`loadProjectFromFetch`（工程文件）+ ResourcePort（媒体寻址）+ AudioPort（播放）
 *   2. 加载并组装工程（清单 + 故事文本 → 纯函数 `assembleProject`）
 *   3. 建引擎：new StoryEngine
 *   4. 挂载：订阅 onStateChanged 渲染 + rAF 帧循环（帧级键直读，不进事件流）
 */
import { SYS, StoryEngine } from "@lingfan/engine";
import {
  createStaticResourcePort,
  createWebAudioPort,
  loadProjectFromFetch,
} from "@lingfan/adapters";
import {
  Typewriter,
  createAudioRenderer,
  renderInlineMarkup,
} from "@lingfan/ui";

/**
 * 工程清单与故事文件：**都在应用资源根 `Resources/` 内**（08-U7）。
 * 宿主把 `Resources` 作为静态根，故逻辑路径就是 `project.json` / `Stories/**`。
 * 清单放在资源根内是有意为之——只有资源根内的文件才会进打包产物，dev 与 prod 同机制。
 */
const MANIFEST = "project.json";
const STORIES = ["Stories/title/title_main.story"];

const stage = document.querySelector<HTMLElement>("#stage");
const speakerEl = document.querySelector<HTMLElement>("#speaker");
const textEl = document.querySelector<HTMLElement>("#text");

function show(message: string): void {
  if (textEl !== null) textEl.textContent = message;
}

async function main(): Promise<void> {
  const story = await loadProjectFromFetch({
    manifest: MANIFEST,
    stories: STORIES,
  });

  const engine = new StoryEngine(story, { historyLimit: 200 });
  const audioPort = createWebAudioPort({
    onError: (message) => console.warn(`[audio] ${message}`),
  });
  const audio = createAudioRenderer(
    engine,
    audioPort,
    createStaticResourcePort(),
    { onError: (message) => console.warn(`[resource] ${message}`) },
  );

  let typewriter: Typewriter | null = null;
  let shown = "";

  engine.onStateChanged(({ key, value }) => {
    if (key === SYS.currentDialogSpeaker && speakerEl !== null) {
      speakerEl.textContent = typeof value === "string" ? value : "";
    } else if (key === SYS.currentDialogText) {
      typewriter = new Typewriter(typeof value === "string" ? value : "", 30);
      shown = "";
    }
  });
  engine.onEvent(({ payload }) => {
    if (payload.kind === "engine.error") {
      console.error(`[engine] ${payload.code}: ${payload.message}`);
      show(`${payload.code}: ${payload.message}`);
    }
  });

  let last = 0;
  const frame = (now: number): void => {
    const dt = last > 0 ? (now - last) / 1000 : 0;
    last = now;
    typewriter?.tick(dt);
    const next = typewriter?.visible ?? "";
    if (next !== shown && textEl !== null) {
      shown = next;
      textEl.innerHTML = renderInlineMarkup(next);
    }
    audio.pollPosition(); // 08 §三.2 媒体位置帧级回写
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // 08 §七 输入：语义归核心层，这里只做映射（推进仅在对话等待中有效）
  const advance = (): void => {
    if (engine.get(SYS.waiting) === "dialog") engine.advance();
  };
  stage?.addEventListener("pointerdown", advance);
  document.addEventListener("keydown", (event) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      advance();
    }
  });

  engine.start();
}

void main().catch((error: unknown) => {
  show(`启动失败：${String(error)}`);
  console.error(error);
});
