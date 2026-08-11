<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import WinButton from "../../vendor/winui-on-web/components/WinButton.vue";
import WinTextBlock from "../../vendor/winui-on-web/components/WinTextBlock.vue";
import WinToggleSwitch from "../../vendor/winui-on-web/components/WinToggleSwitch.vue";
import { useI18n } from "../../vue/i18n";
import { PREVIEW_ROUTES } from "../router";

const { t } = useI18n();
const route = useRoute();

const titleKey = computed(
  () => PREVIEW_ROUTES.find((r) => r.name === route.name)?.titleKey ?? "nav.back",
);

const demoOn = ref(false);
const clicks = ref(0);
</script>

<template>
  <div class="placeholder-page">
    <WinTextBlock class="placeholder-title" :Text="t(titleKey)" FontSize="28" FontWeight="SemiBold" />
    <WinTextBlock :Text="t('placeholder.hint')" />
    <div class="placeholder-controls">
      <WinButton Content="WinUI Button" Style="AccentButtonStyle" @Click="clicks++" />
      <WinToggleSwitch v-model:IsOn="demoOn" :OffContent="t('placeholder.off')" :OnContent="t('placeholder.on')" />
    </div>
    <WinTextBlock v-if="clicks > 0" :Text="`${t('placeholder.clicks')}: ${clicks}`" />
  </div>
</template>

<style scoped>
.placeholder-page {
  padding: 32px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
}
.placeholder-controls {
  display: flex;
  gap: 12px;
  align-items: center;
}
</style>
