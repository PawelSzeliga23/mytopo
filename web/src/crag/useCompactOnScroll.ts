import { useEffect, useState } from "react";

const COMPACT_AFTER = 120;
const EXPAND_BEFORE = 24;

/** Collapse after scrolling down a bit, expand only near the top again — the gap stops the photo flickering at one threshold. */
export function nextCompact(current: boolean, scrollY: number): boolean {
  return current ? scrollY > EXPAND_BEFORE : scrollY > COMPACT_AFTER;
}

/** Phone layout: whether the sticky photo should shrink to a strip while the route list scrolls. */
export function useCompactOnScroll(enabled: boolean): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const update = () => setCompact((current) => nextCompact(current, window.scrollY));
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [enabled]);
  return enabled && compact;
}

const COMPACT_HEIGHT = "30vh";

/** Phone photo height (CSS) — full while the page is near the top, a strip once compact. */
export function phoneViewerHeight(aspect: number, compact: boolean): string {
  return compact ? COMPACT_HEIGHT : `min(${Math.round(aspect * 100)}vw, 65vh)`;
}

/** Height the photo loses when compact. Added back as a spacer so the page keeps its length: otherwise a short page clamps scrollY back under the threshold and bounces. */
export function compactSpacer(aspect: number, compact: boolean): string | null {
  return compact ? `calc(${phoneViewerHeight(aspect, false)} - ${COMPACT_HEIGHT})` : null;
}
