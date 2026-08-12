<script setup lang="ts">
import WinTextBlock from "../../vendor/winui-on-web/components/WinTextBlock.vue";
import { useI18n } from "../i18n";

const { t } = useI18n();

/** 引导：各功能入口在左侧导航，这里仅作说明 */
const guideItems = [
  { key: "start.guideGame", icon: "\uE768" },
  { key: "start.guideLibrary", icon: "\uE8A5" },
  { key: "start.guideEditor", icon: "\uE70F" },
  { key: "start.guideHand", icon: "\uE7EF" },
  { key: "start.guideKeymap", icon: "\uE713" },
  { key: "start.guideHelp", icon: "\uE897" },
];
</script>

<template>
  <div class="start-page">
    <WinTextBlock class="start-title" :Text="t('start.title')" FontSize="38" FontWeight="SemiBold" />
    <WinTextBlock class="page-sub" :Text="t('start.sub')" FontSize="14" />
    <WinTextBlock class="start-guide-hint" :Text="t('start.guide')" FontSize="14" />
    <ul class="start-guide-list">
      <li v-for="g in guideItems" :key="g.key">
        <span class="guide-icon" aria-hidden="true">{{ g.icon }}</span>
        <span>{{ t(g.key) }}</span>
      </li>
    </ul>
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
  gap: 10px;
  padding: 24px;
  color: var(--text-primary);
}

.start-title {
  color: var(--text-primary);
}

.page-sub {
  color: var(--text-secondary);
}

.start-guide-hint {
  margin-top: 18px;
  color: var(--text-secondary);
}

.start-guide-list {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
  color: var(--text-primary);
}

.start-guide-list li {
  display: flex;
  align-items: center;
  gap: 10px;
}

.guide-icon {
  font-family: "WinUIOnWebIcons";
  font-size: 16px;
  color: var(--accent-base);
  width: 20px;
  text-align: center;
}
</style>
