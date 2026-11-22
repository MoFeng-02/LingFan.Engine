<!--
  页面结构（Vue 形态）：与骨架的 index.html 逐层对齐——引擎与适配器不认识它，
  换框架只改这份模板与组合根。所有 id 都是与引擎侧共用的契约，改名必须同步
  `src/main.ts` 里的句柄表与 `src/styles/stage.css`。

  本组件**不碰引擎**：装配在 `src/main.ts`（唯一组合根），交互监听由骨架的
  `src/host/` 用原生事件绑定——Vue 在这里只负责把节点渲染出来。
-->
<script setup lang="ts">
import UiHost from "./UiHost.vue";
import BodyHost from "./BodyHost.vue";
</script>
<template>
  <!-- 舞台视口：铺满窗口、只读尺寸与收拢点击。三个子层各住一个坐标系：
       舞台根按设计基准缩放，震动层跟着舞台一起抖，UI 层按窗口像素排布。
       各层 z 由 main.ts 按 shell.layers 写入。 -->
  <div id="stage-viewport">
    <!-- 舞台根：宽高与变换由适配装配写入，这里不写死 -->
    <div id="stage-root">
      <!-- 震动层：屏幕震动只改这一层的位移，缩放留在父层。
           挂载层也住这里——组件坐标由作者按设计基准摆放，必须随舞台一起缩与抖。 -->
      <div id="stage-shake">
        <!-- 列身体层：这一列的身体组件画在这里（一列一个，可选节点，缺了只是没有身体）。
             身体在下、元素层在上；内容由 `BodyHost` 渲染——父子关系归 Vue。 -->
        <div id="body">
          <BodyHost />
        </div>
        <div id="stage"></div>
        <!-- UI 挂载层：`mount` 命令显示/隐藏的组件挂在这里（可选节点，缺了只是没有 UI）。
             内容由 `UiHost` 渲染——父子关系归 Vue，组合根不再往这个容器里写节点。 -->
        <div id="mounts">
          <UiHost />
        </div>
        <!-- 小游戏挂载点：引擎让出控制权时把外部小游戏画进来，随舞台缩放与震动。
             故意留空——内容由宿主按注册表往这个容器里写节点，不归 Vue 的渲染树。 -->
        <div id="minigame"></div>
      </div>
    </div>
    <!-- 宿主 UI 层：按窗口像素排布，不随舞台缩放 -->
    <div id="shell-ui">
      <div id="nvl"></div>
      <div id="dialogue">
        <div id="speaker"></div>
        <!-- 台词逐字更新：aria-live 让读屏在新句到达时播报 -->
        <div id="text" aria-live="polite">加载中……</div>
        <div id="hint"></div>
      </div>
      <div id="choices"></div>
      <div id="notifications"></div>
      <div id="toolbar">
        <label id="save-label" for="slot">存档</label>
        <select id="slot" aria-label="存档槽位"></select>
        <button id="save" aria-label="存档">存</button>
        <button id="load" aria-label="读档">读</button>
        <!-- 语言选择器（可选节点）：选项由宿主按构建期语言清单填充。
             工具条文案是静态节点（无响应式绑定），宿主经句柄直接重画，不与 Vue 渲染树打架 -->
        <select id="lang" aria-label="语言"></select>
      </div>
      <!-- 历史面板槽位：可选节点（本层不给也能跑，只是没有回看与回溯） -->
      <div id="history"></div>
      <!-- 偏好面板槽位：可选节点（本层不给也能跑，只是没有音量/字速面板） -->
      <div id="prefs"></div>
      <!-- 错误条：断言式播报，装配失败/运行期错误第一时间被读屏念出 -->
      <div id="error" role="alert" aria-live="assertive"></div>
    </div>
    <!-- 转场遮罩：盖住整屏（含舞台与 UI 层），故与两个层平级而不是住在 UI 层里 -->
    <div id="transition"></div>
  </div>
</template>
