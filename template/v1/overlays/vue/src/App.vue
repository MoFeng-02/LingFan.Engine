<!--
  页面结构（Vue 形态）：与骨架的 index.html 逐层对齐——引擎与适配器不认识它，
  换框架只改这份模板与组合根。所有 id 都是与引擎侧共用的契约，改名必须同步
  `src/main.ts` 里的句柄表与 `src/styles/stage.css`。

  本组件**不碰引擎**：装配在 `src/main.ts`（唯一组合根），交互监听由骨架的
  `src/host/` 用原生事件绑定——Vue 在这里只负责把节点渲染出来。

  启动界面也在本组件里，但**舞台节点不受它影响**：舞台是常驻的那一份，
  启动界面是叠在上面的一层（`StartScreen` 自己按屏幕态真挂假挂）。
-->
<script setup lang="ts">
import StartScreen from "./StartScreen.vue";
import UiHost from "./UiHost.vue";
</script>
<template>
  <!-- 舞台根：屏幕震动（shake）施于此；各层 z 由 main.ts 按 shell.layers 写入 -->
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
    <!-- 偏好面板槽位：可选节点（本层不给也能跑，只是没有音量/字速面板） -->
    <div id="prefs"></div>
    <!-- UI 挂载层：`mount` 命令显示/隐藏的组件挂在这里（可选节点，缺了只是没有 UI）。
         位置在对话与工具条之后、转场遮罩之前：UI 盖住对话层，但盖不住转场与错误条。
         内容由 `UiHost` 渲染——父子关系归 Vue，组合根不再往这个容器里写节点。 -->
    <div id="mounts">
      <UiHost />
    </div>
    <!-- 启动界面：叠在舞台之上、转场之下；舞台此时被静默但仍留在 DOM 上 -->
    <StartScreen />
    <div id="transition"></div>
    <div id="error"></div>
  </div>
</template>
