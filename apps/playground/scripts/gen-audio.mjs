// 程序化音频素材生成：用正弦/噪声 + 包络渲染 16-bit PCM WAV，零外部素材、零版权依赖。
// 运行：node apps/playground/scripts/gen-audio.mjs（从仓库根或任意目录均可，输出落到 Resources/Audio）。
// 产物：bgm_theme（柔和主题循环）/ ambient_wind（风声环境层循环）/ se_ui_click / se_ui_confirm /
//       se_whoosh（转场）/ se_type（打字音备用）。所有声音由确定性 PRNG 合成，可复现。
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "Resources", "Audio");
const SR = 44100;

// 确定性 PRNG（mulberry32）：保证每次渲染字节一致，素材可复现、可审计。
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 浮点样本 [-1,1] → 16-bit PCM WAV（单声道）。
function writeWav(name, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), buf);
  console.log(`${name}: ${(n / SR).toFixed(2)}s, ${buf.length} bytes`);
}

// 边缘淡入淡出（毫秒）：循环素材首尾归零，避免 loop 接缝爆音。
function edgeFade(samples, ms) {
  const k = Math.floor((ms / 1000) * SR);
  for (let i = 0; i < k && i < samples.length; i += 1) {
    const g = i / k;
    samples[i] *= g;
    samples[samples.length - 1 - i] *= g;
  }
  return samples;
}

const silence = (sec) => new Float64Array(Math.floor(sec * SR));
const noteFreq = {
  C3: 130.81,
  G3: 196.0,
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  G4: 392.0,
  A4: 440.0,
  C5: 523.25,
  E5: 659.25,
  A5: 880.0,
};

// ── bgm_theme：五声音阶柔和琶音 + 低吟垫底，16s 无缝循环 ──
function bgmTheme() {
  const dur = 16;
  const out = silence(dur);
  const rand = rng(20261121);
  // 琶音：C4 E4 G4 A4 G4 E4 D4 E4，每音 0.5s，4s 一轮 × 4。
  const seq = ["C4", "E4", "G4", "A4", "G4", "E4", "D4", "E4"];
  const noteLen = 0.5;
  for (let rep = 0; rep < 4; rep += 1) {
    seq.forEach((name, idx) => {
      const f = noteFreq[name];
      const start = Math.floor((rep * 4 + idx * noteLen) * SR);
      const len = Math.floor(noteLen * SR * 1.6); // 余音重叠
      for (let i = 0; i < len && start + i < out.length; i += 1) {
        const t = i / SR;
        const env = Math.exp(-t * 3.2) * (1 - Math.exp(-t * 90)); // 快起慢落
        const tone =
          Math.sin(2 * Math.PI * f * t) * 0.6 +
          Math.sin(2 * Math.PI * f * 2 * t) * 0.18;
        out[start + i] += tone * env * 0.3;
      }
    });
  }
  // 垫底：C3 + G3 长音，振幅 LFO 周期 8s（16s 内整 2 周）。
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    const lfo = 0.5 + 0.5 * Math.sin((2 * Math.PI * t) / 8 - Math.PI / 2);
    const pad =
      Math.sin(2 * Math.PI * noteFreq.C3 * t) * 0.5 +
      Math.sin(2 * Math.PI * noteFreq.G3 * t) * 0.35;
    out[i] += pad * lfo * 0.12 + (rand() - 0.5) * 0.004; // 极轻气声
  }
  return edgeFade(out, 40);
}

// ── ambient_wind：棕噪声 + 慢振幅 LFO + 一极低通，8s 循环 ──
function ambientWind() {
  const dur = 8;
  const out = silence(dur);
  const rand = rng(777);
  let brown = 0;
  let lp = 0;
  const alpha = 0.06; // 低通系数（越小越闷）
  for (let i = 0; i < out.length; i += 1) {
    const white = rand() * 2 - 1;
    brown = (brown + 0.02 * white) / 1.02;
    lp += alpha * (brown * 6 - lp);
    const t = i / SR;
    const lfo = 0.55 + 0.45 * Math.sin((2 * Math.PI * t) / 4); // 4s 呼吸
    out[i] = lp * lfo * 0.5;
  }
  return edgeFade(out, 60);
}

// ── se_ui_click：短促点击（高频 ping + 噪声瞬态），70ms ──
function seUiClick() {
  const out = silence(0.07);
  const rand = rng(11);
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    const env = Math.exp(-t * 70);
    const ping = Math.sin(2 * Math.PI * 1200 * t) * 0.7;
    const transient = i < SR * 0.004 ? (rand() * 2 - 1) * 0.5 : 0;
    out[i] = (ping + transient) * env * 0.6;
  }
  return out;
}

// ── se_ui_confirm：双音确认铃（E5→A5），280ms ──
function seUiConfirm() {
  const out = silence(0.28);
  const notes = [
    { f: noteFreq.E5, at: 0 },
    { f: noteFreq.A5, at: 0.09 },
  ];
  for (const { f, at } of notes) {
    const start = Math.floor(at * SR);
    for (let i = 0; start + i < out.length; i += 1) {
      const t = i / SR;
      const env = Math.exp(-t * 9) * (1 - Math.exp(-t * 200));
      out[start + i] +=
        (Math.sin(2 * Math.PI * f * t) * 0.7 +
          Math.sin(2 * Math.PI * f * 2 * t) * 0.2) *
        env *
        0.4;
    }
  }
  return out;
}

// ── se_whoosh：转场风声（带通扫频噪声 +  swell 包络），450ms ──
function seWhoosh() {
  const dur = 0.45;
  const out = silence(dur);
  const rand = rng(42);
  let bp = 0;
  let lp = 0;
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    const p = t / dur; // 0..1
    const sweep = 300 + 2600 * Math.sin(Math.PI * p); // 先升后降
    const alpha = Math.min(0.9, sweep / SR);
    const white = rand() * 2 - 1;
    lp += alpha * (white - lp);
    bp = lp - bp * 0.5;
    const swell = Math.sin(Math.PI * p) ** 1.5;
    out[i] = bp * swell * 0.7;
  }
  return edgeFade(out, 15);
}

// ── se_type：打字 tick（极短噪声 + 高频 sine），35ms ──
function seType() {
  const out = silence(0.035);
  const rand = rng(5);
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    const env = Math.exp(-t * 160);
    const tick =
      Math.sin(2 * Math.PI * 2500 * t) * 0.5 + (rand() * 2 - 1) * 0.4;
    out[i] = tick * env * 0.5;
  }
  return out;
}

writeWav("bgm_theme.wav", bgmTheme());
writeWav("ambient_wind.wav", ambientWind());
writeWav("se_ui_click.wav", seUiClick());
writeWav("se_ui_confirm.wav", seUiConfirm());
writeWav("se_whoosh.wav", seWhoosh());
writeWav("se_type.wav", seType());
console.log("音频素材生成完成 →", OUT);
