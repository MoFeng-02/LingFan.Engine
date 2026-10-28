import { ref } from "vue";
import type {
  DegradedOpen,
  AudioConfig,
  LayerZTable,
  ProjectWriteReport,
  ResourcePort,
  Story,
  WriteNormalizationFinding,
} from "@lingfan-engine/core";
import {
  DEFAULT_AUDIO_CONFIG,
  DEFAULT_LAYER_Z,
} from "@lingfan-engine/core";
import type { OpenedProject } from "../contracts";

/** 未绑定磁盘工程时的提示（状态口径：不携带「刚点了新建/导入」这类历史） */
export const UNBOUND_HINT =
  "未绑定磁盘工程：请用「打开工程」选择目录以启用保存";

/**
 * 工程绑定状态端口集：App 组合根里「工程开没开、能不能存」的共享 ref 族。
 * 打开工程（`applyOpened`）逐个填充；解绑（`unbindProject`）逐个清空；
 * 各视图域（搜索 / 预览 / 保存 / 打包）都从这一份状态取数，不各持副本。
 */
export function useProjectPorts() {
  const previewing = ref(false);
  /** 已打开工程：资源供给端口（未打开 = undefined → 预览不解析资源，维持示例语义） */
  const resourcePort = ref<ResourcePort | undefined>(undefined);
  /** 已打开工程的资源根名（界面显示；空 = 示例故事） */
  const projectRoot = ref("");
  /** 宿主工作区根的完整磁盘路径（watch 端点回传；空 = 浏览器形态或宿主未回传）。
   *  与 `projectRoot` 是**两个事实**：前者是宿主监视根，后者是 FSA 打开的目录名
   *  （浏览器拿不到绝对路径）——tooltip 各自标注身份，不猜两者同一。 */
  const hostRoot = ref("");
  /** 降级打开回执（缺 project.json ⇒ 合成清单打开）；undefined = 正常打开 */
  const degradedOpen = ref<DegradedOpen | undefined>(undefined);
  /** 层级表：打开工程 = 清单 `shell.layers` 覆盖；未打开 = 内建默认（预览解析实例级 z 用） */
  const layerZ = ref<LayerZTable>(DEFAULT_LAYER_Z);
  /** 工程默认音量（未打开工程 = 内建 1）：预览按它解析未写 volume 的命令 */
  const audioConfig = ref<AudioConfig>(DEFAULT_AUDIO_CONFIG);
  const openError = ref("");
  /** 保存回磁盘：`undefined` = 未打开工程或只读取径 → 保存禁用 */
  const saveFn = ref<((s: Story) => Promise<ProjectWriteReport>) | undefined>(
    undefined,
  );
  /** 单文档写回（多文档面的实际保存路径；存在即优先于整工程 `saveFn`） */
  const saveColumnFn = ref<
    | ((columnId: string, columnStory: Story) => Promise<ProjectWriteReport>)
    | undefined
  >(undefined);
  /** 按逻辑路径读资源文本（非故事视图的数据源；缺省 = 未打开工程） */
  const readTextFn = ref<((path: string) => Promise<string>) | undefined>(
    undefined,
  );
  /** 保存单个文本资源（译文表 / 清单）；缺省 = 无写回能力 */
  const saveTextFn = ref<
    ((path: string, text: string) => Promise<ProjectWriteReport>) | undefined
  >(undefined);
  /** 保存前规范化检测（与 save 同源装配；缺省 = 只读取径或无检测） */
  const inspectSaveFn = ref<
    ((s: Story) => WriteNormalizationFinding | undefined) | undefined
  >(undefined);
  /** 不可保存时的可操作提示（按钮 title） */
  const saveHint = ref("");

  return {
    previewing,
    resourcePort,
    projectRoot,
    hostRoot,
    degradedOpen,
    layerZ,
    audioConfig,
    openError,
    saveFn,
    saveColumnFn,
    readTextFn,
    saveTextFn,
    inspectSaveFn,
    saveHint,
  };
}

export type ProjectPorts = ReturnType<typeof useProjectPorts>;
export type DiagnosticSupply = OpenedProject["diagnosticSupply"];
