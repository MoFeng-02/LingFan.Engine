/**
 * 本宿主的帧驱动表现：元素动画 → 全屏转场 → 屏幕震动，三段共用一个 dt，顺序固定。
 *
 * 三段的时间线与插值都交给共享实现，本模块只补两类宿主侧事实：
 *
 * - **节点在不在**：共享实现不认识 DOM，也不判断节点是否存在。元素层容器缺失时，
 *   动画只累计不写样式（累计照走，播毕照常交回引擎）；遮罩缺失时转场整段跳过；
 *   舞台根缺失时震动整段跳过——震动是「舞台根上的偏移」，没有舞台根就没有可写的目标。
 * - **转场被外部清除**：读档与回溯会把系统状态整体换掉，转场可能在中途消失。
 *   此时遮罩要收掉、进度要复位，否则下一段转场会从上一段的残余进度起步。
 *   复位必须与累计同源，所以本模块镜像一份转场进度；需要复位的那一帧，
 *   向共享实现报一段零时长转场，借它的收尾分支收遮罩——那一帧不写不透明度，
 *   也不回填引擎（被清除不等于播完）。
 */
import {
  createVisualEffects,
  resolveAnimatedStyle,
  type EffectSource,
} from "@lingfan/ui";

/** 本宿主帧驱动需要的注入点；引擎侧效果源由调用方按契约提供 */
export interface HostEffectsOptions {
  /** 引擎侧效果源：动画描述、转场、震动，以及三段各自的收尾回填 */
  source: EffectSource;
  /** 元素动画的宿主节点（元素层容器）；返回 null 表示本帧没有可写节点 */
  readElementHost(): HTMLElement | null;
  /** 全屏转场遮罩；返回 null 表示本帧没有可写遮罩 */
  readOverlay(): HTMLElement | null;
  /** 舞台根：震动偏移写它的 transform；返回 null 表示震动整段跳过 */
  readStage(): HTMLElement | null;
}

/**
 * 造一个逐帧调用函数：每帧传入秒级 dt，三段按固定顺序推进。
 *
 * 返回值可直接接进帧循环的「帧驱动表现」这一段（见 `./frame-loop`）。
 */
export function createHostEffects(options: HostEffectsOptions): (dt: number) => void {
  const { source } = options;
  /** 转场进度镜像：与共享实现内部那份同步推进、同步复位 */
  let transitionElapsed = 0;
  /** 本帧 dt：转场分支要在共享实现累计之前先读它，镜像才与它同拍 */
  let frameDt = 0;
  /** 复位帧标记：这一帧由镜像发起，只收遮罩、不回填引擎 */
  let resetting = false;

  const effects = createVisualEffects({
    source: {
      animations: () => source.animations(),
      transition: () => {
        const live = source.transition();
        const overlay = options.readOverlay();
        if (overlay === null) return undefined;
        if (live != null) {
          transitionElapsed += frameDt;
          return live;
        }
        if (transitionElapsed === 0) return undefined;
        resetting = true;
        return { duration: 0 };
      },
      shake: () => {
        const live = source.shake();
        const stage = options.readStage();
        if (live == null || stage === null) return undefined;
        return live;
      },
      animationFinished: (seq) => {
        source.animationFinished(seq);
      },
      transitionFinished: () => {
        if (resetting) {
          resetting = false;
          return;
        }
        source.transitionFinished();
      },
      shakeFinished: () => {
        source.shakeFinished();
      },
    },
    animation: {
      readAnimationHost: () => options.readElementHost(),
      onAnimatedProperty: (node, property, value) => {
        const style = resolveAnimatedStyle(property, value);
        if (style !== null) Object.assign(node.style, style);
      },
    },
    surface: {
      onTransitionFrame: (opacity) => {
        if (resetting) return;
        const overlay = options.readOverlay();
        if (overlay === null) return;
        overlay.style.opacity = String(opacity);
        overlay.style.display = "block";
      },
      onTransitionDone: () => {
        transitionElapsed = 0;
        const overlay = options.readOverlay();
        if (overlay !== null) overlay.style.display = "none";
      },
      onShakeFrame: (x, y) => {
        const stage = options.readStage();
        if (stage === null) return;
        stage.style.transform = `translate(${x}px, ${y}px)`;
      },
      onShakeDone: () => {
        const stage = options.readStage();
        if (stage === null) return;
        stage.style.transform = "";
      },
    },
  });

  return (dt) => {
    frameDt = dt;
    effects(dt);
  };
}
