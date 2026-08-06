import "./style.css";
import { renderEditorPage } from "./pages/editor";
import { mountGamePage } from "./pages/game";
import { renderHelpPage } from "./pages/help";
import { renderKeymapPage } from "./pages/keymap";
import { renderStartPage } from "./pages/start";
import { currentRoute, onRouteChange, type Route } from "./router";

// index.html 保证 #app 存在；querySelector 非空断言 + 运行期防御
const app = document.querySelector<HTMLElement>("#app")!;
if (!app) throw new Error("missing #app mount point");

let cleanup: (() => void) | null = null;

function render(route: Route): void {
  cleanup?.();
  cleanup = null;
  switch (route) {
    case "start":
      renderStartPage(app);
      break;
    case "game":
      cleanup = mountGamePage(app);
      break;
    case "editor":
      renderEditorPage(app);
      break;
    case "keymap":
      renderKeymapPage(app);
      break;
    case "help":
      renderHelpPage(app);
      break;
  }
}

render(currentRoute());
onRouteChange(render);
