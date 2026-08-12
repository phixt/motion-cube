<script setup lang="ts">
import { useRouter } from "vue-router";
import WinButton from "../../vendor/winui-on-web/components/WinButton.vue";
import WinTextBlock from "../../vendor/winui-on-web/components/WinTextBlock.vue";
import { useI18n } from "../i18n";

const { t } = useI18n();
const router = useRouter();

const actions: { route: string; key: string; accent?: boolean }[] = [
  { route: "game", key: "start.play", accent: true },
  { route: "library", key: "start.library" },
  { route: "editor", key: "start.editor" },
  { route: "hand", key: "start.hand" },
  { route: "keymap", key: "start.keymap" },
  { route: "help", key: "start.help" },
];

const go = (route: string) => void router.push({ name: route });
</script>

<template>
  <div class="start-page">
    <WinTextBlock class="start-title" :Text="t('start.title')" FontSize="38" FontWeight="SemiBold" />
    <WinTextBlock class="page-sub" :Text="t('start.sub')" FontSize="14" />
    <div class="start-actions">
      <WinButton
        v-for="a in actions"
        :key="a.route"
        :data-route="a.route"
        :Content="t(a.key)"
        :Style="a.accent ? 'AccentButtonStyle' : 'DefaultButtonStyle'"
        MinWidth="200"
        @Click="go(a.route)" />
    </div>
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

.start-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin-top: 22px;
}
</style>
