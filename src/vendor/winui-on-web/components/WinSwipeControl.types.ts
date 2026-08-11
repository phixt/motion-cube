// Vendored from WinUIonWeb (https://github.com/Furry-Xiyi/WinUIonWeb)
// commit a61bf49365d1048c4a7b8d799e3cb925f47d479f (2026-08-11T09:18:33+08:00) - components/WinSwipeControl.types.ts
// License: GPL-3.0 (see src/vendor/winui-on-web/LICENSE and THIRD_PARTY_NOTICES.md)
// Managed by scripts/sync-winui.mjs - do not edit by hand.
// @ts-nocheck
export type SwipeMode = 'Reveal' | 'Execute';
export type SwipeBehaviorOnInvoked = 'Auto' | 'Close' | 'RemainOpen';
export type SwipeSide = 'Left' | 'Right' | 'Top' | 'Bottom';

export interface SwipeCommand {
  Label?: string;
  Description?: string;
  IconSource?: string | SwipeIconSource;
  CanExecute?: (parameter?: unknown) => boolean;
  Execute: (parameter?: unknown) => void;
}

export interface SwipeIconSource {
  Symbol?: string;
  Glyph?: string;
  UriSource?: string;
}

export interface SwipeItemInvokedEventArgs {
  SwipeControl: {
    Close: () => void;
    Content: HTMLElement | undefined;
    Element: HTMLElement | undefined;
  };
}

export interface SwipeItem {
  Text?: string;
  IconSource?: string | SwipeIconSource;
  Background?: string;
  Foreground?: string;
  BehaviorOnInvoked?: SwipeBehaviorOnInvoked;
  Command?: SwipeCommand;
  CommandParameter?: unknown;
  Invoked?: (sender: SwipeItem, args: SwipeItemInvokedEventArgs) => void;
}

export interface SwipeItems {
  Mode?: SwipeMode;
  Items: SwipeItem[];
}
