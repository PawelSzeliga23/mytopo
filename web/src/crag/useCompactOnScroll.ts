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
