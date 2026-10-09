/**
 * 叙事覆盖层嵌入演示：模拟「一个已经在跑的游戏」接入叙事能力。
 *
 * 目的是证明**接入成本**：宿主游戏有自己的渲染循环与角色，接入只需
 * ① 给一个容器 ② 建引擎 ③ `createNarrativeOverlay` ④ 转发输入 —— 四步。
 * 本文件之外没有任何「照抄参考宿主」的渲染代码（对比 `App.vue` 的近两千行）。
 *
 * 演示同时展示两件事：
 * - **宿主循环不暂停**（方块一直走动，帧数持续增长）——覆盖式对话的前提；
 * - **输入域让位**：叙事等待推进时按键归叙事，覆盖层收起后按键归宿主游戏。
 */
import { StoryEngine, type Story } from "@lingfan/engine";
import {
  createFetchProjectFilesPort,
  createStaticResourcePort,
  loadProject,
} from "@lingfan/adapters";
import {
  createElementResourceResolver,
  createNarrativeOverlay,
  type NarrativeOverlay,
} from "@lingfan/ui";
// 默认故事清单与守卫都从故事侧出口取：生成物路径与清单形态只在那一个目录里出现，
// 覆盖层演示与组合根共用同一份（换生成器输出名或调整默认清单时只改一处）。
import { STORIES, guards } from "./stories";

const MANIFEST = "project.json";
/** 覆盖层字速（字符/秒）：演示用固定值，正式宿主按玩家偏好注入 */
const OVERLAY_TEXT_SPEED = 30;

const errorEl = document.querySelector<HTMLElement>("#error")!;
function report(message: string): void {
  errorEl.textContent = message;
  errorEl.classList.add("on");
}

// —— 宿主游戏：自有循环，接入叙事层后照常运行（不暂停）——
const hero = document.querySelector<HTMLElement>("#hero")!;
const hud = document.querySelector<HTMLElement>("#game-hud")!;
let heroX = 80;
let heroDir = 1;
let frames = 0;
let hostKeys = 0;
function hostFrame(dt: number): void {
  frames += 1;
  heroX += heroDir * 90 * dt;
  if (heroX > 620) heroDir = -1;
  if (heroX < 80) heroDir = 1;
  hero.style.left = `${Math.round(heroX)}px`;
  hud.textContent = `宿主循环帧 ${frames}\n宿主按键被消费 ${hostKeys}\n（覆盖层收起时方向键归宿主）`;
}
let last = performance.now();
function hostLoop(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  hostFrame(dt);
  requestAnimationFrame(hostLoop);
}
requestAnimationFrame(hostLoop);

async function main(): Promise<void> {
  // ① 加载工程（组装归引擎纯函数）
  const filesPort = createFetchProjectFilesPort({ manifest: MANIFEST, stories: STORIES });
  const story: Story = await loadProject(filesPort);

  // ② 建引擎（平台端口按形态注入；嵌入场景通常还有宿主的存档端口）
  const engine = new StoryEngine(story, { guards });
  const resourcePort = createStaticResourcePort();
  // 元素资源解析是异步的而元素渲染是同步的：用库里现成的同步查表皮接上。
  // 回调经闭包延后读 `overlay`（挂载后才可能触发），避免声明顺序耦合。
  const elementResources = createElementResourceResolver({
    resolve: (path) => resourcePort.resolve(path),
    onResolved: () => overlay.sync(),
  });

  // ③ 一行挂载：覆盖层自带五挂载点 + 层级 + 打字机 + 帧循环
  const overlay: NarrativeOverlay = createNarrativeOverlay({
    container: document.querySelector<HTMLElement>("#embed")!,
    engine,
    textSpeed: OVERLAY_TEXT_SPEED,
    resolveResource: elementResources.resolveForElement,
    onError: report,
  });

  // ④ 输入转发：宿主只在「域为叙事」时把按键交出去
  //    （本演示无外部玩法系统，域恒为叙事；有玩法接管时应切 world 让位）
  window.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") {
      if (!overlay.shouldConsumeInput(e)) return;
      e.preventDefault();
      overlay.advance();
      return;
    }
    if (e.key === "Escape") {
      hostKeys += 1; // 示例：宿主自己消费的按键
    }
  });

  engine.start();
  // 调试面：把引擎与装配器挂到 window，便于在浏览器控制台直接观察运行状态
  (window as unknown as { __embed: unknown }).__embed = {
    engine,
    overlay,
    info: () => ({
      frames,
      hostKeys,
      waiting: overlay.view().waiting,
      text: overlay.view().text,
      canAdvance: overlay.view().canAdvance,
      options: overlay.view().menuOptions,
      mounts: Object.keys(overlay.mounts),
    }),
  };
}

void main().catch((e: unknown) => report(String(e)));
