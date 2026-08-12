<script setup lang="ts">
import { useRouter } from "vue-router";
import WinButton from "../../vendor/winui-on-web/components/WinButton.vue";
import WinTextBlock from "../../vendor/winui-on-web/components/WinTextBlock.vue";
import { useI18n } from "../i18n";

const { t } = useI18n();
const router = useRouter();

const play = () => void router.push({ name: "game" });
</script>

<template>
  <div class="start-page">
    <WinTextBlock class="start-title" :Text="t('start.title')" FontSize="38" FontWeight="SemiBold" />
    <WinTextBlock class="page-sub" :Text="t('start.sub')" FontSize="14" />
    <WinButton class="start-play" :Content="t('start.play')" Style="AccentButtonStyle" MinWidth="220" @Click="play" />
  </div>
</template>

<style>
.start-page {
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 16px;
  padding: 24px;
  color: var(--text-primary);
}

.start-title {
  color: var(--text-primary);
}

.page-sub {
  color: var(--text-secondary);
}

.start-play {
  margin-top: 12px;
}
</style>
