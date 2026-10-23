/**
 * 页面结构（React 形态）：与骨架的 index.html 逐层对齐——引擎与适配器不认识它，
 * 换框架只改这份模板与组合根。所有 id 都是与引擎侧共用的契约，改名必须同步
 * `src/main.tsx` 里的句柄表与 `src/styles/stage.css`。
 *
 * 本组件**不碰引擎**：装配在 `src/main.tsx`（唯一组合根），交互监听由骨架的
 * `src/host/` 用原生事件绑定——React 在这里只负责把节点渲染出来。
 */
export function App() {
  return (
    // 舞台根：屏幕震动（shake）施于此；各层 z 由 main.tsx 按 shell.layers 写入
    <div id="stage-root">
      <div id="stage"></div>
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
      <div id="transition"></div>
      <div id="error"></div>
    </div>
  );
}
