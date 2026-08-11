// Vendored from WinUIonWeb (https://github.com/Furry-Xiyi/WinUIonWeb)
// commit a61bf49365d1048c4a7b8d799e3cb925f47d479f (2026-08-11T09:18:33+08:00) - utils/pageState.js
// License: GPL-3.0 (see src/vendor/winui-on-web/LICENSE and THIRD_PARTY_NOTICES.md)
// Managed by scripts/sync-winui.mjs - do not edit by hand.
// @ts-nocheck
import { computed, onUnmounted, ref, watch } from 'vue';

const FAVORITES_KEY = 'winui-favorites';

const readFavorites = () => {
  try {
    const value = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

const writeFavorites = (favorites) => {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  window.dispatchEvent(new CustomEvent('winui-favorites-changed', { detail: favorites }));
};

export const createPageState = (pageKey) => {
  const favorites = ref(readFavorites());
  const isFavoriteState = ref(favorites.value.includes(pageKey));
  const appThemeSetting = localStorage.getItem('winui-theme-setting');
  const resolvedAppTheme = appThemeSetting === 'dark' || appThemeSetting === 'light'
    ? appThemeSetting
    : window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const pageTheme = ref(resolvedAppTheme);

  const toggleTheme = () => {
    pageTheme.value = pageTheme.value === 'dark' ? 'light' : 'dark';
  };

  const onGalleryThemeToggle = (event) => {
    if (event?.detail === pageKey) toggleTheme();
  };

  const toggleFavorite = () => {
    const current = readFavorites();
    const next = current.includes(pageKey)
      ? current.filter((key) => key !== pageKey)
      : [...current, pageKey];

    favorites.value = next;
    isFavoriteState.value = next.includes(pageKey);
    writeFavorites(next);
  };

  const syncFavorites = () => {
    favorites.value = readFavorites();
    isFavoriteState.value = favorites.value.includes(pageKey);
  };

  window.addEventListener('storage', syncFavorites);
  window.addEventListener('winui-favorites-changed', syncFavorites);
  window.addEventListener('win-gallery-theme-toggle', onGalleryThemeToggle);

  onUnmounted(() => {
    window.removeEventListener('storage', syncFavorites);
    window.removeEventListener('winui-favorites-changed', syncFavorites);
    window.removeEventListener('win-gallery-theme-toggle', onGalleryThemeToggle);
  });

  watch(favorites, () => {
    isFavoriteState.value = favorites.value.includes(pageKey);
  });

  return {
    favorites,
    isFavoriteState,
    pageTheme,
    toggleTheme,
    toggleFavorite
  };
};

export const getStoredFavorites = readFavorites;
export const favoritesStorageKey = FAVORITES_KEY;
