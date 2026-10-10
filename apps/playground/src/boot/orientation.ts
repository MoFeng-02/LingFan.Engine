/**
 * 方向与全屏的落壳策略：把「偏好变化 → 平台调用」之间的去重状态机收成两个工厂，
 * 状态留在各自闭包里（每个策略一份，不跨实例共享）。
 *
 * 两种偏好都是「尽力而为」：平台忽略、无壳形态或缺少用户手势都不算错误——方向只记诊断，
 * 全屏静默（偏好已持久化，下次有手势的切换生效）。去重的意义在于：偏好里的音量、
 * 字速、键位等任意一项变化都会触发监听，方向与全屏只在**自身取值真的变了**时才落壳。
 */
import type { FullscreenApplier } from "@lingfan/adapters";
import type { OrientationMode, OrientationPort } from "@lingfan/engine";
import { resolveOrientationMode } from "@lingfan/engine";

/** 方向落壳策略的装配参数：端口与两个取值来源都以具名注入（缺省语义由调用方给定） */
export interface OrientationPolicyOptions {
  /** 壳方向端口（无壳形态传恒未应用的实现） */
  orientationPort: OrientationPort;
  /** 玩家方向偏好（每次应用时现取；未设置 = 跟随工程默认） */
  preference: () => OrientationMode | undefined;
  /** 工程默认方向（每次应用时现取；清单未声明 = undefined） */
  manifestDefault: () => OrientationMode | undefined;
}

/**
 * 造方向落壳策略：返回「应用一次当前方向」的函数，同值不重复落壳（其他偏好变化不落壳）。
 * 返回的函数可直接交给偏好订阅；启动期先自行调用一次即可完成首帧前落壳。
 */
export function createOrientationPolicy(
  options: OrientationPolicyOptions,
): () => void {
  let applied: OrientationMode | undefined;
  return () => {
    const mode = resolveOrientationMode(
      options.preference(),
      options.manifestDefault(),
    );
    if (mode === applied) return;
    applied = mode;
    void options.orientationPort.apply(mode).then(
      (effective) => {
        if (!effective) console.info(`[orientation] ${mode} 未被当前平台应用`);
      },
      (error: unknown) => {
        console.error("[orientation] 应用失败：", error);
      },
    );
  };
}

/** 全屏落壳策略的装配参数：窗口/文档能力以注入的应用器给定 */
export interface FullscreenPolicyOptions {
  /** 全屏应用器（Tauri 窗口命令或浏览器 Fullscreen API） */
  applier: FullscreenApplier;
  /** 全屏偏好（每次应用时现取；未设置 = 窗口化） */
  preference: () => boolean | undefined;
}

/** 全屏落壳策略：启动期恢复值与后续订阅应用分开给出（前者不做去重比较） */
export interface FullscreenPolicy {
  /** 启动期要恢复的全屏状态（构造时取一次偏好；未设置 = 窗口化） */
  readonly initial: boolean;
  /** 应用当前偏好：与上次应用值相同则不动（其他偏好变化不落窗） */
  apply(): void;
}

/**
 * 造全屏落壳策略：`initial` 供启动期直接恢复上次状态，`apply` 交给偏好订阅。
 *
 * 启动期不走 `apply` —— 那时窗口刚建，值本来就「没变」，但恢复动作本身必须发出去；
 * 而起始的已应用值仍记为 `initial`，于是订阅后的第一次同值触发不会重复落窗。
 */
export function createFullscreenPolicy(
  options: FullscreenPolicyOptions,
): FullscreenPolicy {
  let applied = options.preference() ?? false;
  return {
    initial: applied,
    apply(): void {
      const on = options.preference() ?? false;
      if (on === applied) return;
      applied = on;
      void options.applier.apply(on);
    },
  };
}
