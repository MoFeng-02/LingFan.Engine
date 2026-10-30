/**
 * 宿主节点契约：`index.html` 里那些固定 id 在宿主侧长什么样，以及出错往哪儿写。
 *
 * id 是宿主与页面的互锁（脚手架测试逐条核对每个 `must()` 的 id 都真的写在 `index.html` 里）。
 * 缺节点必须在**模块求值期立刻抛错**，而不是等某次渲染静默失败——一行
 * 「宿主缺少节点：#text」比在页面里找一个不动的 div 好查得多。所以 `must()` 的调用点
 * 集中在组合根（`main.ts`）：那里一眼能看全宿主依赖了页面的哪些节点。
 *
 * 句柄只解析一次（不是每次渲染都查一遍）：页面结构是静态的，节点不会在运行期出现或消失。
 * 各视图拿到的都是已确认存在的节点，因此不必自己查、也不必兜空。
 */

/** 按选择器取节点；缺失即抛（错误文案带上选择器，便于直接对照 `index.html`） */
export function must<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (el === null) throw new Error(`宿主缺少节点：${selector}`);
  return el;
}

/**
 * 按选择器取**可选**节点：缺失返回 `null`，不抛。
 *
 * 只给「有则增强、无则退化成没有该功能」的节点用——目前三个：偏好面板的容器、
 * 整屏页面容器、UI 挂载层容器。它们和 `must()` 的区别是**契约强度**：页面结构由
 * 叠加层重写时（Vue / React / 小程序各自的 `App`），那份页面可以选择不提供这些槽位，
 * 此时对应功能不启用，游戏照常跑；而 `must()` 守的节点缺一个就是装配错误，必须当场抛。
 */
export function optional<T extends HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

/** 常驻节点句柄表：装配期就要用到、且页面里始终存在的那些 */
export interface StageDom {
  /** 舞台根：屏幕震动施加位移的对象 */
  root: HTMLElement;
  /** 舞台：元素层容器，也是元素动画节点的查找范围 */
  stage: HTMLElement;
  /** 对话层：说话人 / 正文 / 提示三件套的容器 */
  dialogue: HTMLElement;
  /** 说话人一行 */
  speaker: HTMLElement;
  /** 正文一行 */
  text: HTMLElement;
  /** 等待态提示符（对话等待时显示 ▼） */
  hint: HTMLElement;
  /** NVL 累积层 */
  nvl: HTMLElement;
  /** 等待态层：选项 / 输入 / 提示都渲染进这里 */
  choices: HTMLElement;
  /** 通知层：提示条追加到这里 */
  notifications: HTMLElement;
  /** 工具条：存档槽与存 / 读按钮 */
  toolbar: HTMLElement;
  /**
   * 偏好面板槽位（**可选**：`null` = 本页面没给这个槽位）。
   *
   * 与上面 15 个 `must()` 节点的区别：那些是引擎渲染的落点，缺一个就是装配错误；
   * 这个只是「没有面板就没有音量/字速 UI」，游戏照常跑，所以按可选处理。
   * 取用点：`optional("#prefs")`；`layer-z.ts` 写 `prefs` 层 z 时会判空。
   */
  prefs: HTMLElement | null;
  /**
   * UI 挂载层容器（**可选**：`null` = 本页面不给 UI 挂载留槽位）。
   *
   * 给了就按 `SYS.mounts` 把 `src/ui/` 下的 UI 挂进来（`mount` op 控制显隐），
   * 不给则 `mount` 只改状态、没有任何组件出现——降级是「少功能」，不是错误。
   * 与 `prefs` 同属「有则增强」的槽位：取用点 `optional("#mounts")`。
   */
  mounts: HTMLElement | null;
  /** 存档槽下拉 */
  slot: HTMLSelectElement;
  /** 存按钮 */
  save: HTMLButtonElement;
  /** 读按钮 */
  load: HTMLButtonElement;
  /** 全屏转场遮罩 */
  transition: HTMLElement;
  /** 引擎错误横幅 */
  error: HTMLElement;
}

/**
 * 造一个诊断出口：写进页面上的错误条**并**打控制台。
 * 两条都要——页面上的那条给玩家看（黑屏时至少知道发生了什么），控制台那条给排查用。
 * 引擎自己报的错误不走这里（它的控制台行带 `[engine]` 前缀，见 `engine-wiring.ts`）。
 */
export function createErrorReporter(dom: StageDom): (message: string) => void {
  return (message: string): void => {
    dom.error.textContent = message;
    console.error(`[host] ${message}`);
  };
}

/**
 * 启动失败的可见出口：正文与错误条各写一行「启动失败：…」，原始错误进控制台。
 * 装配中途失败时舞台是空的，这行字是玩家唯一能看到的线索。
 */
export function reportBootFailure(dom: StageDom, error: unknown): void {
  dom.text.textContent = `启动失败：${String(error)}`;
  dom.error.textContent = `启动失败：${String(error)}`;
  console.error(error);
}
