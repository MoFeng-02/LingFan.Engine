/**
 * 页面结构（React 形态）：与骨架的 index.html 逐层对齐——引擎与适配器不认识它，
 * 换框架只改这份模板与组合根。所有 id 都是与引擎侧共用的契约，改名必须同步
 * `src/main.tsx` 里的句柄表与 `src/styles/stage.css`。
 *
 * 本组件**不碰引擎**：装配在 `src/main.tsx`（唯一组合根），交互监听由骨架的
 * `src/host/` 用原生事件绑定——React 在这里只负责把节点渲染出来。
 */
import { UiHost } from "./UiHost.tsx";

export function App() {
  return (
    // 舞台视口：铺满窗口、只读尺寸与收拢点击。三个子层各住一个坐标系：
    // 舞台根按设计基准缩放，震动层跟着舞台一起抖，UI 层按窗口像素排布。
    // 各层 z 由 main.tsx 按 shell.layers 写入。
    <div id="stage-viewport">
      {/* 舞台根：宽高与变换由适配装配写入，这里不写死 */}
      <div id="stage-root">
        {/* 震动层：屏幕震动只改这一层的位移，缩放留在父层。
             挂载层也住这里——组件坐标由作者按设计基准摆放，必须随舞台一起缩与抖。 */}
        <div id="stage-shake">
          <div id="stage"></div>
          {/* UI 挂载层：`mount` 命令显示/隐藏的组件挂在这里（可选节点，缺了只是没有 UI）。
               内容由 `UiHost` 渲染——父子关系归 React，组合根不再往这个容器里写节点。 */}
          <div id="mounts">
            <UiHost />
          </div>
        </div>
      </div>
      {/* 宿主 UI 层：按窗口像素排布，不随舞台缩放 */}
      <div id="shell-ui">
        <div id="nvl"></div>
        <div id="dialogue">
          <div id="speaker"></div>
          <div id="text">加载中……</div>
          <div id="hint"></div>
        </div>
        <div id="choices"></div>
        <div id="notifications"></div>
        <div id="toolbar">
          <span>存档</span>
          <select id="slot"></select>
          <button id="save">存</button>
          <button id="load">读</button>
        </div>
        {/* 历史面板槽位：可选节点（本层不给也能跑，只是没有回看与回溯） */}
        <div id="history"></div>
        {/* 偏好面板槽位：可选节点（本层不给也能跑，只是没有音量/字速面板） */}
        <div id="prefs"></div>
        <div id="error"></div>
      </div>
      {/* 转场遮罩：盖住整屏（含舞台与 UI 层），故与两个层平级而不是住在 UI 层里 */}
      <div id="transition"></div>
    </div>
  );
}
