// Vendored from WinUIonWeb (https://github.com/Furry-Xiyi/WinUIonWeb)
// commit a61bf49365d1048c4a7b8d799e3cb925f47d479f (2026-08-11T09:18:33+08:00) - utils/navigationTransitionInfo.d.ts
// License: GPL-3.0 (see src/vendor/winui-on-web/LICENSE and THIRD_PARTY_NOTICES.md)
// Managed by scripts/sync-winui.mjs - do not edit by hand.
// @ts-nocheck
export const NavigationTrigger_NavigatingTo: string
export const NavigationTrigger_NavigatingAway: string
export const NavigationTrigger_BackNavigatingTo: string
export const NavigationTrigger_BackNavigatingAway: string

export interface NavigationTransitionInfo {
  Type: string
  Effect?: string
}

export function createDrillInNavigationTransitionInfo(): NavigationTransitionInfo
export function getNavigationTransitionInfoClassName(
  NavigationTransitionInfo: NavigationTransitionInfo | null,
  NavigationTrigger?: string
): string
