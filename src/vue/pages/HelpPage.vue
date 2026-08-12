<script setup lang="ts">
import WinTextBlock from "../../vendor/winui-on-web/components/WinTextBlock.vue";
import { useI18n } from "../i18n";

const { t } = useI18n();

const gameOps = ["help.opDrag", "help.opKeys", "help.opFormula", "help.opSpeed"];
</script>

<template>
  <div class="help-page">
    <WinTextBlock class="page-title" :Text="t('help.title')" FontSize="28" FontWeight="SemiBold" />

    <section class="help-section">
      <WinTextBlock class="help-h2" :Text="t('help.project')" FontSize="17" FontWeight="SemiBold" />
      <WinTextBlock :Text="t('help.projectDesc')" />
    </section>

    <section class="help-section">
      <WinTextBlock class="help-h2" :Text="t('help.gameOps')" FontSize="17" FontWeight="SemiBold" />
      <ul class="help-list">
        <li v-for="op in gameOps" :key="op">{{ t(op) }}</li>
      </ul>
    </section>

    <section class="help-section">
      <WinTextBlock class="help-h2" :Text="t('help.editorOps')" FontSize="17" FontWeight="SemiBold" />
      <WinTextBlock class="page-note" :Text="t('help.editorPlaceholder')" />
    </section>
  </div>
</template>

<style>
.help-page {
  height: 100%;
  box-sizing: border-box;
  overflow: auto;
  padding: 24px 28px;
  color: var(--text-primary);
}

.help-section {
  margin-top: 18px;
  max-width: 720px;
}

.help-h2 {
  color: var(--text-primary);
  margin-bottom: 6px;
}

.help-list {
  margin: 8px 0 0;
  padding-left: 22px;
  color: var(--text-secondary);
  line-height: 1.7;
}

.page-note {
  color: var(--text-tertiary);
  font-size: 13px;
  margin-top: 6px;
}
</style>
