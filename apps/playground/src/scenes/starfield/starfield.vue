<script setup lang="ts">
/**
 * 星穹：一条列的整屏画面就是一个编译进来的实时渲染组件。
 *
 * 用 PixiJS v8 在 canvas 上程序化绘制粒子星空、星云背景、流光与流星，全部动画由
 * 组件自己的 ticker 驱动——这是「自己建模做视频」的实时形态：视觉内容当场生成，
 * 不是播放预制视频文件（字面视频仍走引擎的 video op，两条路并存）。
 *
 * 与引擎的交互一律经 SceneEnv：读面（状态/列清单/历史/插值/舞台）现读不缓存，
 * 玩家操作经 submit 把纯数据命令投回引擎，换列经 navigate。组件内联的对话是原子的，
 * 不可逐句回退；要逐句回退请走普通对话列。
 *
 * 视口与适配由宿主注入（stage() 读面），组件按固定作者基准尺寸绘制，由宿主整场缩放，
 * 因此不自行监听 resize。卸载时彻底销毁 PixiJS 应用与自建纹理，不留泄漏。
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { SceneEnv } from "@lingfan-engine/core";
import {
  Application,
  CanvasSource,
  FillGradient,
  Graphics,
  Particle,
  ParticleContainer,
  Rectangle,
  Sprite,
  Texture,
} from "pixi.js";
import type { FederatedPointerEvent, Ticker } from "pixi.js";

const props = defineProps<{ env: SceneEnv }>();

// 作者坐标系基准尺寸：与舞台基准一致，宿主按适配整场缩放，组件只按这个尺寸绘制。
const BASE_WIDTH = 1280;
const BASE_HEIGHT = 720;
const STAR_COUNT = 320;

// 许愿文案：组件内联对话经 submit 投回引擎，原子呈现、不可逐句回退。
const WISH_LINES = [
  "星穹听见了。愿你的旅途，总有微光相伴。",
  "一颗星为你亮起，灵泛把这份心愿记进了夜里。",
  "流星划过——那是引擎此刻为你实时绘制的一笔。",
  "夜空因你而亮了一瞬。继续往前走吧，旅人。",
];

const hostRef = ref<HTMLDivElement | null>(null);
const revision = ref(0);
const wishCount = ref(0);

// 读面随引擎状态变更刷新；读面不保证引用稳定，每次现读。
const playerName = computed(() => {
  void revision.value;
  // 名字由故事写入状态；直达此列时尚未写入，先读状态面兜底，避免对未定义变量插值报错。
  const raw = props.env.get("game.player.name");
  if (typeof raw !== "string" || raw.length === 0) return "旅人";
  // 名字已定义：经插值面取一次，演示 interpolate 读面（失败保留原文时回退状态值）。
  const value = props.env.interpolate("{game.player.name}");
  return typeof value === "string" && value.length > 0 && !value.includes("{")
    ? value
    : raw;
});
const visitedCount = computed(() => {
  void revision.value;
  const value = props.env.get("game.world.visited");
  return Array.isArray(value) ? value.length : 0;
});
const historyLabel = computed(() => {
  void revision.value;
  return `${props.env.historyCursor()} / ${props.env.historyLength()}`;
});
const columnCount = computed(() => {
  void revision.value;
  return props.env.columns().length;
});
const currentColumn = computed(() => {
  void revision.value;
  return props.env.currentColumn();
});
const stageScale = computed(() => {
  void revision.value;
  return props.env.stage().layout.scaleX.toFixed(2);
});
const isFocused = computed(() => {
  void revision.value;
  return props.env.state.getScoped("world", "focus") === "starfield";
});

// PixiJS 应用与动画状态：随列切换装卸，卸载时统一销毁。
let app: Application | null = null;
let initPromise: Promise<void> | null = null;
let initialized = false;
let disposed = false;
let stopWatching: (() => void) | null = null;

let starTexture: Texture | null = null;
let starField: ParticleContainer<Particle> | null = null;
let sweep: Graphics | null = null;
let meteor: Sprite | null = null;
const gradients: FillGradient[] = [];
const starDrift: {
  vx: number;
  vy: number;
  phase: number;
  speed: number;
  base: number;
}[] = [];
const meteorState = {
  active: false,
  progress: 0,
  duration: 0.85,
  x0: 0,
  y0: 0,
  x1: 0,
  y1: 0,
};
let elapsed = 0;
let sweepPhase = 0;
let meteorCooldown = 5;

/** 柔光星点纹理：白心向四周透明衰减，配合加色混合得到柔和星光。 */
function createStarTexture(): Texture {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.35, "rgba(255,255,255,0.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

/** 唤一颗流星：从给定位置（或随机天区）向右下划过并淡出。 */
function launchMeteor(fromX?: number, fromY?: number): void {
  if (!meteor) return;
  const startX = fromX ?? BASE_WIDTH * (0.15 + Math.random() * 0.7);
  const startY = fromY ?? BASE_HEIGHT * Math.random() * 0.3;
  const angle = Math.PI * (0.16 + Math.random() * 0.1);
  const distance = 360 + Math.random() * 220;
  meteorState.active = true;
  meteorState.progress = 0;
  meteorState.x0 = startX;
  meteorState.y0 = startY;
  meteorState.x1 = startX + Math.cos(angle) * distance;
  meteorState.y1 = startY + Math.sin(angle) * distance;
  meteor.rotation = angle;
  meteor.alpha = 0;
  meteor.visible = true;
}

/** 向星穹许愿：唤流星 + 经 submit 投回一句原子对话。 */
function wishAt(x?: number, y?: number): void {
  launchMeteor(x, y);
  const line = WISH_LINES[wishCount.value % WISH_LINES.length];
  wishCount.value += 1;
  props.env.submit([{ op: "say", text: line, speaker: "灵泛" }]);
}

function callMeteor(): void {
  launchMeteor();
  props.env.submit([
    {
      op: "say",
      text: "流星应声而落——这是引擎此刻为你绘制的光。",
      speaker: "灵泛",
    },
  ]);
}

function backToMap(): void {
  props.env.navigate("world");
}

function onSkyTap(event: FederatedPointerEvent): void {
  wishAt(event.global.x, event.global.y);
}

/** 帧循环：星点漂移与闪烁、流光扫过、流星划过、偶发自动流星。 */
function tick(ticker: Ticker): void {
  if (!starField) return;
  const dt = Math.min(ticker.deltaMS, 100) / 1000;
  elapsed += dt;

  const children = starField.particleChildren;
  for (let i = 0; i < children.length; i += 1) {
    const particle = children[i];
    const drift = starDrift[i];
    particle.x += drift.vx * dt;
    particle.y += drift.vy * dt;
    if (particle.x < -8) particle.x += BASE_WIDTH + 16;
    else if (particle.x > BASE_WIDTH + 8) particle.x -= BASE_WIDTH + 16;
    if (particle.y < -8) particle.y += BASE_HEIGHT + 16;
    else if (particle.y > BASE_HEIGHT + 8) particle.y -= BASE_HEIGHT + 16;
    particle.alpha =
      drift.base *
      (0.55 + 0.45 * Math.sin(elapsed * drift.speed + drift.phase));
  }

  if (sweep) {
    sweepPhase = (sweepPhase + dt / 14) % 1;
    sweep.x = -320 + sweepPhase * (BASE_WIDTH + 640);
  }

  if (meteor && meteorState.active) {
    meteorState.progress += dt / meteorState.duration;
    const p = Math.min(meteorState.progress, 1);
    meteor.x = meteorState.x0 + (meteorState.x1 - meteorState.x0) * p;
    meteor.y = meteorState.y0 + (meteorState.y1 - meteorState.y0) * p;
    meteor.alpha = Math.sin(p * Math.PI) * 0.9;
    if (p >= 1) {
      meteorState.active = false;
      meteor.visible = false;
    }
  }

  meteorCooldown -= dt;
  if (meteorCooldown <= 0 && !meteorState.active) {
    launchMeteor();
    meteorCooldown = 7 + Math.random() * 6;
  }
}

/** 搭建场景：星云背景、粒子星空、流光带、流星，全部一次构建，动画走 transform。 */
function buildScene(application: Application): void {
  const stage = application.stage;
  starTexture = createStarTexture();

  // 星云背景：径向渐变（深靛蓝心 → 近黑边），一次绘制不再重绘。
  const nebulaGradient = new FillGradient({
    type: "radial",
    center: { x: BASE_WIDTH * 0.5, y: BASE_HEIGHT * 0.42 },
    innerRadius: 0,
    outerCenter: { x: BASE_WIDTH * 0.5, y: BASE_HEIGHT * 0.42 },
    outerRadius: BASE_WIDTH * 0.72,
    colorStops: [
      { offset: 0, color: 0x1b2340 },
      { offset: 0.55, color: 0x10142a },
      { offset: 1, color: 0x07080f },
    ],
    textureSpace: "global",
  });
  gradients.push(nebulaGradient);
  const nebula = new Graphics();
  nebula.rect(0, 0, BASE_WIDTH, BASE_HEIGHT).fill(nebulaGradient);
  stage.addChild(nebula);

  // 粒子星空：固定池，位置与颜色每帧更新（加色混合得到柔光）。
  const field = new ParticleContainer<Particle>({
    texture: starTexture,
    boundsArea: new Rectangle(0, 0, BASE_WIDTH, BASE_HEIGHT),
    dynamicProperties: { position: true, color: true },
  });
  field.blendMode = "add";
  const tints = [0xffffff, 0xc0caf5, 0x7aa2f7, 0xbb9af7];
  for (let i = 0; i < STAR_COUNT; i += 1) {
    const size = 0.12 + Math.random() * 0.5;
    field.addParticle(
      new Particle({
        texture: starTexture,
        x: Math.random() * BASE_WIDTH,
        y: Math.random() * BASE_HEIGHT,
        scaleX: size,
        scaleY: size,
        anchorX: 0.5,
        anchorY: 0.5,
        tint: tints[i % tints.length],
        alpha: 0.8,
      }),
    );
    starDrift.push({
      vx: -(2 + size * 10),
      vy: 1 + size * 4,
      phase: Math.random() * Math.PI * 2,
      speed: 0.6 + Math.random() * 1.8,
      base: 0.35 + Math.random() * 0.5,
    });
  }
  stage.addChild(field);
  starField = field;

  // 流光带：横向渐变（透明 → 蓝 → 透明），加色低透明度，靠 transform 扫过画面。
  const bandWidth = 220;
  const bandHeight = BASE_HEIGHT * 1.6;
  const sweepGradient = new FillGradient({
    type: "linear",
    start: { x: 0, y: 0 },
    end: { x: bandWidth, y: 0 },
    colorStops: [
      { offset: 0, color: 0x000000 },
      { offset: 0.5, color: 0x7aa2f7 },
      { offset: 1, color: 0x000000 },
    ],
    textureSpace: "global",
  });
  gradients.push(sweepGradient);
  const band = new Graphics();
  band.rect(0, 0, bandWidth, bandHeight).fill(sweepGradient);
  band.blendMode = "add";
  band.alpha = 0.1;
  band.rotation = -0.12;
  band.y = -BASE_HEIGHT * 0.3;
  stage.addChild(band);
  sweep = band;

  // 流星：星点纹理沿方向拉伸成光痕，移动并淡出。
  const streak = new Sprite(starTexture);
  streak.anchor.set(0.5);
  streak.scale.set(6, 0.35);
  streak.blendMode = "add";
  streak.visible = false;
  stage.addChild(streak);
  meteor = streak;

  // 点击夜空许愿：舞台铺满命中区，事件落在舞台上。
  stage.eventMode = "static";
  stage.hitArea = application.screen;
  stage.on("pointertap", onSkyTap);
}

/** 彻底销毁：先拆 PixiJS 应用（停 ticker、毁子树与图形上下文），再释放自建渐变与纹理。 */
function teardown(): void {
  const application = app;
  app = null;
  if (application && initialized) {
    application.destroy(
      { removeView: true, releaseGlobalResources: true },
      { children: true, context: true },
    );
  }
  initialized = false;
  for (const gradient of gradients) gradient.destroy();
  gradients.length = 0;
  starTexture?.destroy(true);
  starTexture = null;
  starField = null;
  sweep = null;
  meteor = null;
  starDrift.length = 0;
}

onMounted(() => {
  stopWatching = props.env.onChange(() => {
    revision.value += 1;
  });
  const application = new Application();
  app = application;
  initPromise = (async () => {
    await application.init({
      width: BASE_WIDTH,
      height: BASE_HEIGHT,
      background: "#07080f",
      antialias: true,
      autoDensity: true,
      preference: "webgl",
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    initialized = true;
    // 初始化完成前组件可能已卸载：此时不再搭建，交由卸载清理销毁已初始化的应用。
    if (disposed) return;
    const host = hostRef.value;
    if (!host) return;
    const canvas = application.canvas;
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    host.appendChild(canvas);
    buildScene(application);
    application.ticker.add(tick);
  })();
  void initPromise.catch(() => {
    // 初始化失败（如无 WebGL）：保持空场景，卸载时清理会跳过未初始化的应用。
  });
});

onUnmounted(() => {
  disposed = true;
  stopWatching?.();
  stopWatching = null;
  const pending = initPromise;
  initPromise = null;
  // 销毁必须等初始化落定：提前卸载时链在初始化之后，避免销毁未就绪的应用。
  if (pending) void pending.then(teardown, teardown);
  else teardown();
});
</script>

<template>
  <div ref="hostRef" class="starfield">
    <div class="starfield__veil"></div>
    <header class="starfield__title" :class="{ 'is-focused': isFocused }">
      <h1>星穹</h1>
      <p>灵泛引擎 · 实时渲染</p>
    </header>
    <div class="starfield__hud">
      <span>{{ playerName }}</span>
      <span>已探索 {{ visitedCount }} 处</span>
      <span>回溯 {{ historyLabel }}</span>
      <span>共 {{ columnCount }} 幕</span>
    </div>
    <div class="starfield__actions">
      <button type="button" @click="wishAt()">许个愿</button>
      <button type="button" @click="callMeteor">唤流星</button>
      <button type="button" @click="backToMap">返回地图</button>
    </div>
    <p class="starfield__caption">
      {{ currentColumn }} · 适配 ×{{ stageScale }}
    </p>
    <p class="starfield__hint">点击夜空，向星穹许一个愿。</p>
  </div>
</template>

<style scoped>
.starfield {
  position: absolute;
  inset: 0;
  overflow: hidden;
  color: #e6e6f0;
  font-family: Georgia, "Songti SC", "SimSun", serif;
}
.starfield__veil {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background: radial-gradient(
    ellipse at 50% 38%,
    rgba(7, 8, 15, 0) 40%,
    rgba(7, 8, 15, 0.55) 100%
  );
}
.starfield__title {
  position: absolute;
  top: 64px;
  left: 50%;
  z-index: 2;
  transform: translateX(-50%);
  text-align: center;
  pointer-events: none;
}
.starfield__title h1 {
  margin: 0;
  font-size: 64px;
  font-weight: 600;
  letter-spacing: 24px;
  text-indent: 24px;
  color: #cdd6f4;
  text-shadow: 0 0 24px rgba(122, 162, 247, 0.45);
  transition: text-shadow 0.6s ease;
}
.starfield__title.is-focused h1 {
  text-shadow: 0 0 36px rgba(122, 162, 247, 0.85);
}
.starfield__title p {
  margin: 12px 0 0;
  font-size: 16px;
  letter-spacing: 6px;
  color: #7aa2f7;
}
.starfield__hud {
  position: absolute;
  top: 32px;
  left: 40px;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 6px;
  pointer-events: none;
  font-size: 14px;
  letter-spacing: 1px;
  color: rgba(169, 177, 214, 0.82);
}
.starfield__actions {
  position: absolute;
  bottom: 64px;
  left: 50%;
  z-index: 2;
  transform: translateX(-50%);
  display: flex;
  gap: 16px;
}
.starfield__actions button {
  padding: 10px 26px;
  border: 1px solid rgba(122, 162, 247, 0.5);
  border-radius: 999px;
  background: rgba(16, 20, 42, 0.6);
  color: #cdd6f4;
  font-family: inherit;
  font-size: 16px;
  letter-spacing: 2px;
  cursor: pointer;
  transition:
    background 0.25s ease,
    border-color 0.25s ease;
}
.starfield__actions button:hover {
  background: rgba(122, 162, 247, 0.22);
  border-color: #7aa2f7;
}
.starfield__caption {
  position: absolute;
  bottom: 28px;
  left: 40px;
  z-index: 2;
  margin: 0;
  pointer-events: none;
  font-size: 12px;
  letter-spacing: 1px;
  color: rgba(169, 177, 214, 0.5);
}
.starfield__hint {
  position: absolute;
  bottom: 28px;
  right: 40px;
  z-index: 2;
  margin: 0;
  pointer-events: none;
  font-size: 13px;
  letter-spacing: 1px;
  color: rgba(169, 177, 214, 0.6);
}
</style>
