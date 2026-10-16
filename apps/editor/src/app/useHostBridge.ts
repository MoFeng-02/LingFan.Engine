import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { Ref } from "vue";
import {
  detectLocalHost,
  fetchWatchStatus,
  pollWatch,
  postPackRequest,
  type LocalHostEndpoint,
} from "../infra";
import type { PackRequest, PackResult } from "../contracts";
import type { DialogPort } from "../domain";
import type { ProjectPorts } from "./useProjectPorts";

export interface HostBridgeDeps {
  ports: Pick<ProjectPorts, "hostRoot">;
  /** 「宿主未启动」横幅开关（由探测结果驱动；**不用模态**——见探测处注） */
  hostHint: Ref<boolean>;
  dialog: DialogPort;
  rightTab: Ref<string>;
  /** 磁盘重开通道（热重载触发时走它；由工程打开域提供） */
  reloadFromDisk: () => Promise<void>;
  /** 脏文档保护判据来源 */
  dirtyCount: () => number;
}

/**
 * 宿主桥域：能力探测（本地服务在不在）+ 热重载轮询 + 打包请求转发。
 * 前端不 spawn 进程——一切宿主能力都经 `__editor_host__` HTTP 端点。
 */
export function useHostBridge(deps: HostBridgeDeps) {
  const { ports, hostHint, dialog, rightTab, reloadFromDisk, dirtyCount } =
    deps;

  /**
   * 热重载开关（作者可关）。默认**开**——它是「代码归外部编辑器」这个定位能成立的
   * **前提能力**：外部改完看不到，定位就只是半截。
   */
  const hotReloadEnabled = ref(true);
  /** 热重载是否真的在跑（宿主监视失败 ⇒ false，状态栏如实显示「不可用」） */
  const hotReloadActive = ref(false);
  /** 停轮询（页面卸载 / 开关关闭时用） */
  let stopHotReload: (() => void) | undefined;

  /** 宿主能力探测：本地服务在不在（决定「外部编辑器打开」等动作是否可做） */
  const localHost = ref<LocalHostEndpoint | undefined>(undefined);
  const localHostAvailable = computed(() => localHost.value !== undefined);
  /**
   * 能力探测：命中 ⇒ 完整体验；未命中 ⇒ 浏览器形态（**正常**路径，但**要说清怎么变完整**）。
   *
   * **为什么放在 `onMounted` 而不是 setup 顶层的裸 IIFE**：
   *   裸 IIFE 在 setup 里**一次都没执行**（`Network` 域抓到启动期零请求，
   *   而同一份代码手动调用完全正常 ⇒ 模块求值时机不可靠）。
   *   `onMounted` 是"组件已挂载、DOM 与子组件就绪"的**契约时刻**，探测放这里既可靠又不浪费。
   */
  onMounted(() => {
    void (async () => {
      const host = await detectLocalHost();
      localHost.value = host;
      // 提示**绝不模态**（用 `dialog.notify` ⇒ `DialogHost` 遮罩是
      //   `inset:0` 全屏 ⇒ 不关掉就**挡住全部点击**，表现为"点故事没反应"）。
      //   降级是"可用但能力受限"，用 `pointer-events:none` 的横幅说清，不拦操作。
      if (host === undefined) hostHint.value = true;
      else {
        // 宿主工作区根（完整磁盘路径，watch 端点回传）——chip tooltip 的「全路径」来源。
        // 它是**宿主监视根**，不必然等于用户 FSA 打开的工程目录（两者各自陈述，不混同）。
        void fetchWatchStatus(host).then((status) => {
          if (status?.root !== undefined) ports.hostRoot.value = status.root;
        });
        if (hotReloadEnabled.value) startHotReload(host);
      }
    })();
  });

  /* ——— 热重载 ——— */

  /**
   * 起热重载轮询。
   *
   * **脏文档保护**：有未保存改动时**不自动重载**，只提示 ——
   * 静默重载会丢掉作者的改动（与 `Workspace.replaceClean` 拒绝脏文档同一处理）。
   */
  function startHotReload(host: LocalHostEndpoint): void {
    stopHotReload?.();
    hotReloadActive.value = true;
    stopHotReload = pollWatch(host, () => {
      if (dirtyCount() > 0) {
        void dialog.notify({
          title: "检测到磁盘变更，但当前有未保存改动",
          message:
            "为避免丢失你的改动，未自动重载。请先保存，或撤销改动后等待自动重载。",
          tone: "warning",
        });
        return;
      }
      void reloadFromDisk();
    });
  }

  onBeforeUnmount(() => {
    stopHotReload?.();
    stopHotReload = undefined;
  });

  /**
   * 打包请求转发：**前端不 spawn 进程**，只发请求给本地宿主。
   *
   * token 从哪来：宿主把 `capabilities` 打进 `/__editor_host__/ping` 的响应里
   * 才是正解，但当前 ping 只回 `{ok:true}`（不泄露任何路径/token）。
   * ⇒ 这里改为**从探测时的基址直接请求 `/{token}/pack`** 需要 token ⇒
   *   走既有 `localHost` 端点对象里的 token（探测时由宿主一并给出）。
   *
   * `packing` 记账：打包以分钟计，面板切走后**状态栏仍显示「打包中…」**
   * ——长任务的存在感不随面板显隐丢失。
   */
  const packing = ref(false);
  async function sendPackRequest(request: PackRequest): Promise<PackResult> {
    const host = localHost.value;
    if (host === undefined || host.token === "") {
      return { ok: false, reason: "本地宿主未就绪（缺少访问令牌）" };
    }
    packing.value = true;
    try {
      // 失败已由 `postPackRequest` 折成 `{ ok: false, reason }`（宿主未启动是正常降级）
      return await postPackRequest(host, request);
    } finally {
      packing.value = false;
    }
  }

  /** 状态栏「打包」入口（toggle 右栏打包页——已在 ⇒ 回诊断） */
  function togglePackPane(): void {
    rightTab.value = rightTab.value === "pack" ? "diagnostics" : "pack";
  }

  return {
    hotReloadEnabled,
    hotReloadActive,
    localHost,
    localHostAvailable,
    packing,
    sendPackRequest,
    togglePackPane,
    startHotReload,
  };
}

export type HostBridgeState = ReturnType<typeof useHostBridge>;
