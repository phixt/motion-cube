<script setup lang="ts">
/**
 * 动画编辑器页（Vue 壳迁移版）。
 * 时间线/关键帧/3D 视口仍由 pages/editor.ts 的 renderEditorPage 渲染（逻辑密集、与
 * HandRigView/CubePlayer/Timeline 深度耦合），壳提供 WinUI 标题；时间线控件化重写留后续。
 */
import { onBeforeUnmount, onMounted, ref } from "vue";
import WinTextBlock from "../../vendor/winui-on-web/components/WinTextBlock.vue";
import { renderEditorPage } from "../../pages/editor";
import { useI18n } from "../i18n";

const { t } = useI18n();
const host = ref<HTMLElement | null>(null);

onMounted(() => {
  if (host.value) renderEditorPage(host.value);
});

onBeforeUnmount(() => {
  // renderEditorPage 不返回清理函数；其内部定时器靠 root.contains 自停，这里清空容器回收 DOM
  host.value?.replaceChildren();
});
</script>

<template>
  <div class="editor-page-vue">
    <header class="editor-header">
      <WinTextBlock :Text="t('editor.title')" FontSize="22" FontWeight="SemiBold" />
    </header>
    <div ref="host" class="editor-legacy-host"></div>
  </div>
</template>

<style>
.editor-page-vue {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  color: var(--text-primary);
}

.editor-header {
  flex: 0 0 auto;
  padding: 12px 16px 0;
}

.editor-legacy-host {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}

/* 旧页内嵌导航与 h1 标题已由 WinUI 壳接管 */
.editor-legacy-host .nav-bar,
.editor-legacy-host .page > h1 {
  display: none;
}
</style>
