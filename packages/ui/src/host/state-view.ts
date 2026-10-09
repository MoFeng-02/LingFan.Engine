/**
 * 状态分发：把引擎状态变更（`{ key, value }`）翻译成宿主认得的一条**视图意图**。
 *
 * 引擎的状态键是弱类型的（`value: unknown`），每个键怎么解读、缺省怎么回退，是一套容易
 * 在多个宿主里各写一遍、然后慢慢走样的规则：数值键要不要落回层默认、数组键要不要兜空、
 * `"hide"` 算不算隐藏、打字机开关缺省是开还是关……这里把这套规则收成一处。
 *
 * 分工是「意图带数据、导出函数带规则」：意图只把状态里的事实搬出来（文本、设置、数组），
 * 需要宿主提供外部事实才能算出的值（默认字速、角色配色）走具名注入或导出的纯函数，
 * 于是宿主的 switch 里只剩「落到自己的 DOM / 框架状态上」这一件事。
 *
 * **键名与键分类都由宿主注入**：订阅哪几个状态键是宿主与引擎之间的接线契约，本模块不内置
 * 任何键名；「键名 → 层名」的判定也用宿主给的函数（通常就是引擎的 `instanceZLayer`）。
 *
 * 本模块是纯函数式的：不持有视图状态、不写 DOM。
 */

import type { ElementInstance, LayerId } from "@lingfan/engine";

/** 故事级打字机设置（`text_typewriter` 命令写入的状态形态） */
export interface TypingSetting {
  enabled?: boolean;
  speed?: number;
}

/** 一条视图意图：`kind` 决定宿主去看哪个字段 */
export type StateIntent =
  /** 某层的实例级 z 被改写（`z` 为 undefined = 回层默认） */
  | { kind: "layer"; layer: LayerId; z: number | undefined }
  /** 说话人一行：空串 = 无人说话 */
  | { kind: "speaker"; text: string; color: string | null }
  /** 新的一句正文；`setting` 为 undefined = 用宿主默认（打字机开、默认字速） */
  | { kind: "dialog-text"; text: string; setting: TypingSetting | undefined }
  /** 等待态机的当前态（决定对话层让位与选项区形态） */
  | { kind: "waiting"; waiting: string }
  /** NVL 模式（`"none"` = 关闭） */
  | { kind: "nvl-mode"; mode: string }
  /** NVL 缓冲行（整体替换） */
  | { kind: "nvl-buffer"; lines: readonly string[] }
  /** 菜单选项或输入提示变了：选项区整体重建 */
  | { kind: "choices" }
  /** 对话框显隐（`window show|hide`） */
  | { kind: "dialog-visible"; hidden: boolean }
  /** 舞台元素整体替换 */
  | { kind: "elements"; elements: readonly ElementInstance[] }
  /** 与本宿主无关的键 */
  | { kind: "none" };

/** 宿主订阅的状态键表：每项是引擎状态键的名字，只是换个可读的别名 */
export interface StateKeyTable {
  /** 当前说话人 */
  speaker: string;
  /** 当前正文 */
  dialogText: string;
  /** 等待态 */
  waiting: string;
  /** NVL 模式 */
  nvlMode: string;
  /** NVL 缓冲 */
  nvlBuffer: string;
  /** 菜单选项文本 */
  menuOptions: string;
  /** 菜单选项目标 */
  menuTargets: string;
  /** 对话框显隐 */
  dialogVisible: string;
  /** 舞台元素表 */
  elements: string;
}

/** 状态分发器的输入：键表 + 三个查询出口（层级反查、打字机设置、角色配色） */
export interface StateViewOptions {
  /** 宿主订阅的键表 */
  keys: StateKeyTable;
  /** 键名 → 该键是否承载某一层的实例级 z；不是层级键时返回 undefined */
  resolveLayer(key: string): LayerId | undefined;
  /** 读当前故事级打字机设置 */
  readTypingSetting(): TypingSetting | undefined;
  /** 角色配色查询；无名或未定义配色时返回 null */
  readCharacterColor(name: string): string | null;
}

/** 读说话人一行：状态键里存的是字符串，非字符串一律当空 */
function readSpeakerIntent(
  value: unknown,
  readCharacterColor: (name: string) => string | null,
): StateIntent {
  const text = typeof value === "string" ? value : "";
  // 空串也要查一次：名字为空时配色查询的返回值同样是配色口径的一部分，跳过会引入分叉
  return { kind: "speaker", text, color: readCharacterColor(text) };
}

/**
 * 创建状态分发器：返回的函数对每个状态键给出一条意图。
 * 各键互不重叠，故分支顺序只影响可读性。
 */
export function createStateView(
  options: StateViewOptions,
): (key: string, value: unknown) => StateIntent {
  const { keys } = options;
  return (key: string, value: unknown): StateIntent => {
    // 实例级 z：先问宿主这个键是不是层级键，值非数字时视为「回层默认」
    const layer = options.resolveLayer(key);
    if (layer !== undefined) {
      return { kind: "layer", layer, z: typeof value === "number" ? value : undefined };
    }
    if (key === keys.speaker) {
      return readSpeakerIntent(value, options.readCharacterColor);
    }
    if (key === keys.dialogText) {
      const text = typeof value === "string" ? value : "";
      return { kind: "dialog-text", text, setting: options.readTypingSetting() };
    }
    if (key === keys.waiting) {
      return { kind: "waiting", waiting: typeof value === "string" ? value : "none" };
    }
    if (key === keys.nvlMode) {
      return { kind: "nvl-mode", mode: typeof value === "string" ? value : "none" };
    }
    if (key === keys.nvlBuffer) {
      return { kind: "nvl-buffer", lines: Array.isArray(value) ? (value as string[]) : [] };
    }
    // 选项与目标两键分别写入：任一到达都做一次整体重建
    if (key === keys.menuOptions || key === keys.menuTargets) return { kind: "choices" };
    if (key === keys.dialogVisible) return { kind: "dialog-visible", hidden: value === "hide" };
    if (key === keys.elements) {
      return { kind: "elements", elements: (value as ElementInstance[] | undefined) ?? [] };
    }
    return { kind: "none" };
  };
}

/**
 * 本句字速：故事给了正数就用它，否则用宿主默认。
 * `0` / 负数 / 非数字都当没给——`0` 会让打字机永远不前进（表现为卡死在空台词）。
 */
export function resolveTypingCps(
  setting: TypingSetting | undefined,
  fallback: number,
): number {
  const speed = setting?.speed;
  return typeof speed === "number" && speed > 0 ? speed : fallback;
}

/** 本句是否走打字机：只有显式 `enabled === false` 才整句直出，缺省是打字机开 */
export function isTypingEnabled(setting: TypingSetting | undefined): boolean {
  return setting?.enabled !== false;
}

/**
 * NVL 层是否生效：模式开着**且**有内容。
 * 只有模式而无内容时仍走普通对话框——否则会闪出一个空白整屏层。
 */
export function isNvlActive(mode: string, lines: readonly string[]): boolean {
  return mode !== "none" && lines.length > 0;
}

/**
 * 对话层是否让位。三个让位条件互相独立：
 * NVL 接管、故事显式隐藏、以及视频等待期——视频要占满舞台，压不住底部对话框会很难看。
 */
export function isDialogueSuppressed(state: {
  nvlActive: boolean;
  hidden: boolean;
  waiting: string;
}): boolean {
  return state.nvlActive || state.hidden || state.waiting === "video";
}
