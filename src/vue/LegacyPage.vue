<script setup lang="ts">
/**
 * 旧页面宿主：在 Vue 壳内挂载迁移前的命令式 render 函数。
 * 页面逐个迁移完成后，路由改为指向新 SFC，本组件随旧页面一起删除。
 */
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { renderEditorPage } from "../pages/editor";
import { renderHandCalibPage } from "../pages/handCalib";
import { renderLibraryPage } from "../pages/library";
import type { Route } from "../router";

const props = defineProps<{ route: Route }>();

const host = ref<HTMLElement | null>(null);
let cleanup: (() => void) | null = null;

const render = (route: Route): void => {
  if (!host.value) return;
  cleanup?.();
  cleanup = null;
  switch (route) {
    case "library":
      renderLibraryPage(host.value);
      break;
    case "editor":
      renderEditorPage(host.value);
      break;
    case "hand":
      cleanup = renderHandCalibPage(host.value);
      break;
  }
};

onMounted(() => render(props.route));
watch(() => props.route, (r) => render(r));
onBeforeUnmount(() => cleanup?.());
</script>

<template>
  <div ref="host" class="legacy-page-host"></div>
</template>

<style>
/* 旧 .page 是 position:absolute; inset:0，宿主需相对定位并撑满内容区 */
.legacy-page-host {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

/* 迁移过渡期隐藏旧导航条：路由切换交给 WinUI 导航 */
.legacy-page-host .nav-bar {
  display: none;
}
</style>
