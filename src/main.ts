import "./style.css";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) {
  throw new Error("missing #app mount point");
}

root.innerHTML = `
  <header class="hud-bar">
    <h1>Motion Cube</h1>
    <span class="hud-status">bootstrap OK</span>
  </header>
  <main class="stage"></main>
`;
