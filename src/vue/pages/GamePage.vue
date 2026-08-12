<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import WinTextBlock from "../../vendor/winui-on-web/components/WinTextBlock.vue";
import { mountGamePage } from "../../pages/game";
import { useI18n } from "../i18n";

const { t } = useI18n();
const host = ref<HTMLElement | null>(null);
let dispose: (() => void) | null = null;

onMounted(() => {
  if (host.value) dispose = mountGamePage(host.value);
});

onBeforeUnmount(() => dispose?.());
</script>

<template>
  <div class="game-page-vue">
    <header class="game-header">
      <WinTextBlock :Text="t('game.title')" FontSize="20" FontWeight="SemiBold" />
      <WinTextBlock class="game-sub" :Text="t('game.sub')" FontSize="13" />
    </header>
    <div ref="host" class="game-legacy-host"></div>
  </div>
</template>

<style>
.game-page-vue {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.game-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 35;
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 8px 14px;
  pointer-events: none;
  color: var(--text-primary);
}

.game-sub {
  color: var(--text-secondary);
}

.game-legacy-host {
  position: absolute;
  inset: 0;
}

.game-legacy-host .game-page {
  position: absolute;
  inset: 0;
}

/* 旧页内嵌标题栏/导航已由 WinUI 壳接管 */
.game-legacy-host .game-top {
  display: none;
}
</style>
