/**
 * 层 C'：鼠标拖拽模式区分（docs/base.md 第 3 条）。
 * 需要区分：拖拽转层、拖拽翻面、任意视角查看。具体手势设计待定。
 * TODO(spike): 验证 twisty-player 原生拖拽行为，再决定自定义手势层。
 */
export type DragMode = "layer" | "reorient" | "view";
