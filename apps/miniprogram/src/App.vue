<script setup lang="ts">
/**
 * 应用外壳：只定全局底色与文字默认值。
 *
 * 与桌面宿主同一套口径——层自己带外观，不靠继承：小程序里 `page` 就是那层「窗口底色」，
 * 舞台层与 UI 层各自把自己需要的颜色写清楚。
 */
import { onLaunch } from "@dcloudio/uni-app";

onLaunch(() => {
  // 宿主自检入口：装载与装配都归页面（`pages/index/index.vue`），这里不做叙事接线。
});
</script>

<style>
page {
  width: 100%;
  height: 100%;
  background: #0a0a10;
  color: #e6e6f0;
  font-size: 30rpx;
}
</style>
