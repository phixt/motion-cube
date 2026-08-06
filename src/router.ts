/** 轻量 hash 路由：#/start | #/game | #/editor | #/keymap | #/help */

export const ROUTES = ["start", "game", "editor", "keymap", "help"] as const;
export type Route = (typeof ROUTES)[number];

function parseHash(hash: string): Route {
  const m = hash.match(/^#\/([a-z]+)/);
  const r = m?.[1] as Route | undefined;
  return r && ROUTES.includes(r) ? r : "start";
}

export function currentRoute(): Route {
  return parseHash(location.hash);
}

export function navigate(route: Route): void {
  if (currentRoute() === route) {
    // 同路由点击：强制重渲染（如从游戏返回开始再进入）
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    return;
  }
  location.hash = `#/${route}`;
}

export function onRouteChange(cb: (route: Route) => void): () => void {
  const handler = () => cb(currentRoute());
  window.addEventListener("hashchange", handler);
  return () => window.removeEventListener("hashchange", handler);
}
