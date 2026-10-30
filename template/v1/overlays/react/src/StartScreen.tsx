/**
 * 启动界面（React 形态）：进游戏前盖住舞台的整屏界面。
 *
 * 三条边界：
 * 1. **不是引擎概念**。引擎只知道自己停在哪一列、那一列是什么类型；「该不该画这一屏」
 *    由 `screenStore` 的屏幕态决定（列 id 为空串或列类型不是 `game` 都算启动界面）。
 * 2. **舞台不卸载**。舞台节点在装配期就被 `must()` 抓住，卸载再挂回等于换一批新节点，
 *    宿主手上的句柄全部失效。这里真挂载/真卸载的只有本组件自己，舞台留在原地并被
 *    `inert` + `aria-hidden` 让位（见骨架 `src/host/switch.ts`）。
 * 3. **只画，不做判断**。标题、槽位、能不能继续全来自屏幕态；开始与继续各自调一个
 *    回调，导航到哪一列由宿主翻。
 *
 * 取值用 `useSyncExternalStore`：React 的并发渲染要求外部值按快照读，
 * 自己 `useState` + `useEffect` 会在首帧读到旧值（与 `UiHost` 同一理由）。
 */
import { useSyncExternalStore } from "react";
import { screenStore } from "./screen";

export function StartScreen() {
  const view = useSyncExternalStore(
    screenStore.subscribe,
    screenStore.snapshot,
    screenStore.snapshot,
  );
  if (view === undefined || view.screen !== "start") return null;
  const resumeSlot = view.resume.slot;
  return (
    // 点击不外传：舞台根的点击是「推进对话」，落到这里会顺带跳一句
    <div className="screen-start" onClick={(event) => event.stopPropagation()}>
      <div className="screen-start__body">
        <h1 className="screen-start__heading">{view.title}</h1>
        <p className="screen-start__subtitle">
          点开始进入故事；有存档时可从中断处继续。
        </p>
        <div className="screen-start__actions">
          <button
            className="screen-start__button"
            type="button"
            disabled={resumeSlot === undefined}
            title={view.resume.reason}
            onClick={() => {
              if (resumeSlot !== undefined) view.load(resumeSlot);
            }}
          >
            继续
          </button>
          <button
            className="screen-start__button"
            type="button"
            onClick={() => view.start()}
          >
            开始
          </button>
        </div>
      </div>
    </div>
  );
}
