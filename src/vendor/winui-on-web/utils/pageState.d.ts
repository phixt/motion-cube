// Vendored from WinUIonWeb (https://github.com/Furry-Xiyi/WinUIonWeb)
// commit a61bf49365d1048c4a7b8d799e3cb925f47d479f (2026-08-11T09:18:33+08:00) - utils/pageState.d.ts
// License: GPL-3.0 (see src/vendor/winui-on-web/LICENSE and THIRD_PARTY_NOTICES.md)
// Managed by scripts/sync-winui.mjs - do not edit by hand.
// @ts-nocheck
import type { Ref } from 'vue';

export declare const favoritesStorageKey: string;

export declare const getStoredFavorites: () => string[];

export declare const createPageState: (pageKey: string) => {
  favorites: Ref<string[]>;
  isFavoriteState: Ref<boolean>;
  pageTheme: Ref<'light' | 'dark' | string>;
  toggleTheme: () => void;
  toggleFavorite: () => void;
};
