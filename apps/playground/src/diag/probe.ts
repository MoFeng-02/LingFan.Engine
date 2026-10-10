/**
 * 采样载荷构造：一次采样把白屏归因结论、渲染层栈、#app 规模与媒体元素状态
 * 拆成多份小载荷经 `report()` 发出（os_log 对长消息截断，载荷必须小）。
 */
import { classifyWhiteScreen } from "./classify";
import { report } from "./report";

/** 样式表盘点：总数 + 真正生效（sheet 非 null）的数量与各 link 的 href 尾段（截尾省载荷）。 */
function collectStyleSheets(): {
  count: number;
  loaded: number;
  links: { href: string; loaded: boolean }[];
} {
  const links = [...document.querySelectorAll('link[rel="stylesheet"]')].map((node) => {
    const link = node as HTMLLinkElement;
    return { href: link.href.slice(-70), loaded: link.sheet !== null };
  });
  return {
    count: document.styleSheets.length,
    loaded: links.filter((l) => l.loaded).length,
    links,
  };
}

/** 一次现场采样：先发阶段面包屑，再把媒体 / 图片 / 布局 / 样式表拆成小载荷上报（长消息会被 os_log 截断）。 */
export function snapshot(phase: string): void {
  report(`${phase}:enter`); // 面包屑：定时器确实进来了
  try {
    // 媒体/图片：**必须带 naturalWidth/complete**——画面空白时第一要问的就是「图到底加载成功没有」
    // （舞台层是空的还是画了透明的东西，只有图片自身状态能回答）
    const media = [...document.querySelectorAll("video,audio,img")]
      .slice(0, 3)
      .map((node) => {
        const el = node as HTMLVideoElement & HTMLImageElement;
        const isImg = el.tagName === "IMG";
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          src: (el.currentSrc || el.getAttribute("src") || "").slice(0, 90),
          ok: isImg
            ? el.complete && el.naturalWidth > 0
            : el.error === null && el.readyState >= 1,
          w: isImg ? el.naturalWidth : el.videoWidth || 0,
          h: isImg ? el.naturalHeight : el.videoHeight || 0,
          err: el.error ? el.error.code : null,
          rect: [Math.round(rect.width), Math.round(rect.height)],
        };
      });
    // 渲染层栈：全部显式 z-index 元素（白屏疑似层叠/裁切问题时的决定性数据）
    const layered = [...document.querySelectorAll("*")]
      .map((el) => ({ el, cs: getComputedStyle(el) }))
      .filter(({ cs }) => cs.zIndex !== "auto" && cs.display !== "none")
      .slice(0, 4) // 载荷必须小：os_log 对长消息截断（567 字符处被切）
      .map(({ el, cs }) => {
        const rect = el.getBoundingClientRect();
        return {
          key: el.id || String(el.className).slice(0, 30) || el.tagName.toLowerCase(),
          z: cs.zIndex,
          pos: cs.position,
          // 背景色：舞台层到底「什么都没画」还是「画了透明的东西」，只能看这个
          bg: cs.backgroundColor,
          rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
          vis: cs.visibility,
          op: cs.opacity,
        };
      });
    const app = document.querySelector("#app");
    const appBox = app ? app.getBoundingClientRect() : null;
    const sheets = collectStyleSheets();
    const win: [number, number] = [window.innerWidth, window.innerHeight];
    const visual: [number, number] | null = window.visualViewport
      ? [Math.round(window.visualViewport.width), Math.round(window.visualViewport.height)]
      : null;
    const appRect: [number, number] | null = appBox
      ? [Math.round(appBox.width), Math.round(appBox.height)]
      : null;
    const verdict = classifyWhiteScreen({
      bodyHtmlLen: document.body.innerHTML.length,
      appChildren: app ? app.childElementCount : -1,
      win,
      visual,
      appRect,
      styleSheets: sheets.count,
      styleSheetsLoaded: sheets.loaded,
      visibilityState: document.visibilityState,
    });
    report(`${phase}:collected`); // 面包屑：采集走完，没被几何/样式表读取抛断
    // **先发小载荷**（结论 + 判据输入），再发大载荷（层栈 + 媒体 + 样式表明细）：
    // 大载荷若在通道上出问题，至少结论不会一起丢（这也是对「载荷过大」假设的直接检验）。
    report({
      phase,
      // 初帧（Vue 挂载前）拍到的 `#app` 必然为空，该 verdict 不代表稳态、不参与归因
      initial: phase === "t0" ? 1 : 0,
      verdict,
      win,
      visual,
      appRect,
      htmlLen: document.body.innerHTML.length,
      appChildren: app ? app.childElementCount : -1,
      styleSheets: sheets.count,
      styleSheetsLoaded: sheets.loaded,
      visibility: document.visibilityState,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      appBg: app ? getComputedStyle(app).backgroundColor : null,
    });
    // 每一份载荷**只讲一件事**：os_log 会截断长消息（567 字符处被切），
    // 合在一起发时后面那些「最想知道」的字段会一起丢——分开就能各自完整落地。
    report({
      phase,
      part: "dom",
      dpr: window.devicePixelRatio,
      readyState: document.readyState,
      text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 120),
      styleSheetLinks: sheets.links,
    });
    report({ phase, part: "layered", layered });
    report({ phase, part: "media", media });
  } catch (error) {
    report(`${phase}:error ${String(error)}`);
  }
}
