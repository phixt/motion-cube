/**
 * 首页鼠标视差：全局单一输入源。
 * - Pointer Events（仅精细指针设备），输出无单位 CSS 变量 --par-u / --par-v 到页面根节点
 * - 帧率无关 lerp（1-e^(-λΔt)）；强度由显式设置控制（不受系统 reduced-motion 影响）；强度=0 时暂停 rAF
 * - 离开窗口 / 失焦 / 页面隐藏时归零或暂停；onScopeDispose 清理全部监听
 * 注意：不要在模板里把视差值绑定成 Vue 响应式做每帧渲染，直接消费 CSS 变量。
 */
import { onScopeDispose, watch, type Ref } from "vue";
import { PARALLAX_SCALE, parallaxIntensityRef } from "../../settings";

const DAMPING = 5;

export function useParallax(root: Ref<HTMLElement | null>): void {
  const finePointer = window.matchMedia("(pointer: fine)");

  let activeEl: HTMLElement | null = null;
  let raw = { u: 0, v: 0 };
  let current = { u: 0, v: 0 };
  let scale = effectiveScale();
  let raf = 0;
  let lastT = 0;

  function effectiveScale(): number {
    return PARALLAX_SCALE[parallaxIntensityRef.value] ?? PARALLAX_SCALE[2];
  }

  function target(): { u: number; v: number } {
    return { u: raw.u * scale, v: raw.v * scale };
  }

  function apply(): void {
    if (!activeEl) return;
    activeEl.style.setProperty("--par-u", current.u.toFixed(4));
    activeEl.style.setProperty("--par-v", current.v.toFixed(4));
  }

  function loop(t: number): void {
    const dt = lastT ? Math.min((t - lastT) / 1000, 0.05) : 0.016;
    lastT = t;
    const tgt = target();
    const alpha = 1 - Math.exp(-DAMPING * dt);
    current.u += (tgt.u - current.u) * alpha;
    current.v += (tgt.v - current.v) * alpha;
    apply();
    if (Math.abs(current.u - tgt.u) < 0.001 && Math.abs(current.v - tgt.v) < 0.001) {
      current.u = tgt.u;
      current.v = tgt.v;
      apply();
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(loop);
  }

  function start(): void {
    if (raf) return;
    lastT = 0;
    raf = requestAnimationFrame(loop);
  }

  function stop(): void {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  const onPointerMove = (e: PointerEvent): void => {
    if (!activeEl || scale === 0) return;
    raw = {
      u: (e.clientX / window.innerWidth - 0.5) * 2,
      v: (e.clientY / window.innerHeight - 0.5) * 2,
    };
    start();
  };

  const onReset = (): void => {
    raw = { u: 0, v: 0 };
    start();
  };

  const onVisibility = (): void => {
    if (document.hidden) {
      stop();
    } else if (activeEl) {
      const t = target();
      if (Math.abs(current.u - t.u) > 0.001 || Math.abs(current.v - t.v) > 0.001) start();
    }
  };

  const onSettingOrMotionChange = (): void => {
    scale = effectiveScale();
    if (activeEl) start();
  };

  watch(parallaxIntensityRef, onSettingOrMotionChange);
  watch(root, (el) => {
    activeEl = el;
    if (el) {
      apply();
    } else {
      stop();
    }
  });

  window.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("mouseleave", onReset);
  window.addEventListener("blur", onReset);
  document.addEventListener("visibilitychange", onVisibility);
  if (!finePointer.matches) scale = 0;

  onScopeDispose(() => {
    stop();
    window.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("mouseleave", onReset);
    window.removeEventListener("blur", onReset);
    document.removeEventListener("visibilitychange", onVisibility);
  });
}
