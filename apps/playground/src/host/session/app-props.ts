/**
 * 参考宿主的注入契约：平台端口与工程事实由组合根（`main.ts`）装配后以 props 供给，
 * 组件内只读不重赋值。
 *
 * 契约单独成文件，是因为消费方不止 `App.vue`：各装配叶子按字段子集声明自己的入参，
 * 本接口是它们的共同上界——字段含义与是否可选以这里为准。
 */

import type { Ref } from "vue";
import type {
  AudioConfig,
  AudioPort,
  ElementFit,
  HostControls,
  HostInfo,
  I18nPort,
  LayerZTable,
  OpExtension,
  PlayerPreferences,
  ResourcePort,
  SavePort,
  SavesConfig,
  StageConfig,
  Story,
  VideoPort,
} from "@lingfan-engine/core";
import type { MountSource } from "@lingfan-engine/ui";

/** 注入契约：平台端口与工程事实由组合根以 props 供给，组件内只读不重赋值 */
export interface AppProps {
  /** 热重载：宿主以 ref 包装供给（换 value = 注入新 Story），消费方显式 .value */
  story: Ref<Story>;
  /** 平台区分：宿主事实（os/form，组合根装配；只读，用于展示与按端分支） */
  host: HostInfo;
  /** 层级（z 序）：内建默认 × 工程覆盖（shell.layers），组合根解析后注入 */
  layerZ: LayerZTable;
  /** 存档壳配置：槽位数与缩略图参数（project.json shell.saves 可覆盖） */
  saves: SavesConfig;
  /** 舞台适配配置：设计基准像素与适配策略（project.json shell.stage 可覆盖） */
  stage: StageConfig;
  /** 工程默认音量（project.json shell.audio 可覆盖）：音量的第二级，偏好乘算在渲染层 */
  audioConfig: AudioConfig;
  savePort: SavePort;
  resourcePort: ResourcePort;
  /** I18N overlay 供给（可选：浏览器形态未装配 = 原文直出） */
  i18nPort?: I18nPort;
  /** 声明制扩展（组合根装载后注入；清单未声明 = 空数组） */
  extensions: OpExtension[];
  /** 玩家偏好（组合根装配：hydrate 后注入，与存档分离） */
  preferences: PlayerPreferences;
  /** 端口工厂而非实例：restart 重建音频/视频通道时保持「选择权在组合根」 */
  createAudioPort: (onError: (message: string) => void) => AudioPort;
  createVideoPort: (
    onError: (message: string) => void,
    readContainer?: () => HTMLElement | null,
    readFit?: () => ElementFit,
  ) => VideoPort;
  /** 操作通道（组合根造）：暂停/存读/导航都经由它，组件自己不直接点引擎命令 */
  controls?: HostControls;
  /** 挂载表读数：`SYS.mounts` 的当前值经它订阅，决定 `#mounts` 里该出现哪些组件 */
  mounts: MountSource;
  /** 生成物里的 UI 组件表（名字 → 组件） */
  mountsTable: Readonly<Record<string, unknown>>;
  /** 挂载表写入口：引擎报出新表时由这里推给 `mounts` */
  onMounts: (raw: unknown) => void;
  /** 工程标题（组合根从 project.json 解析）：启动页与暂停菜单共用 */
  projectTitle: string;
  /**
   * 直达目标列 id（可选）：组合根从开发期环境变量读入，给定后跳过启动页直接进该列。
   * 缺省 = 正常从启动页开始。
   */
  entry?: string;
}
