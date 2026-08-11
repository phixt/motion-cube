<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import WinNavigationView from "../vendor/winui-on-web/components/WinNavigationView.vue";
import { useI18n } from "../vue/i18n";
import { PREVIEW_ROUTES } from "./router";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const isPaneOpen = ref(true);

const navMenuItems = computed(() =>
  PREVIEW_ROUTES.map((r) => ({ Tag: r.name, Icon: r.icon, Content: t(r.titleKey) })),
);

const selectedNavigationItem = computed({
  get: () => {
    const current = route.name;
    return navMenuItems.value.find((i) => i.Tag === current) ?? navMenuItems.value[0];
  },
  set: (item) => {
    if (item?.Tag) void router.push({ name: item.Tag });
  },
});

const onItemInvoked = (args: { InvokedItemContainer?: { Tag?: string; SelectsOnInvoked?: boolean } } | undefined) => {
  const item = args?.InvokedItemContainer;
  if (!item || item.SelectsOnInvoked === false || !item.Tag) return;
  if (item.Tag !== route.name) void router.push({ name: item.Tag });
};
</script>

<template>
  <WinNavigationView
    v-model:IsPaneOpen="isPaneOpen"
    :SelectedItem="selectedNavigationItem"
    :MenuItems="navMenuItems"
    :FooterMenuItems="[]"
    IsBackButtonVisible="Collapsed"
    :IsPaneToggleButtonVisible="true"
    :IsSettingsVisible="false"
    @ItemInvoked="onItemInvoked">
    <router-view />
  </WinNavigationView>
</template>
