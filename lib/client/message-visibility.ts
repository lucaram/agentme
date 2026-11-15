/** Viewport visibility, excluding the sticky navigation/composer and modal overlays. */
export function visibleMessageArea(rect: { top: number; bottom: number; left: number; right: number; width: number; height: number }, viewport: { top: number; bottom: number; width: number }) {
  const height = Math.min(rect.bottom, viewport.bottom) - Math.max(rect.top, viewport.top);
  const width = Math.min(rect.right, viewport.width) - Math.max(rect.left, 0);
  return rect.height > 0 && rect.width > 0 && height >= Math.min(24, rect.height / 2) && width >= Math.min(100, rect.width / 2);
}

/** A message must stay visible in the focused tab for 500ms. Returning IDs confirms successful persistence. */
export function watchVisibleMessages(ids: string[], attribute: string, acknowledge: (ids: string[]) => Promise<string[]>) {
  const scope = new Set(ids); const done = new Set<string>(); const candidates = new Set<HTMLElement>(); const since = new Map<string, number>();
  let stopped = false; let sending = false; let frame = 0; let retryAt = 0;
  const active = () => document.visibilityState === "visible" && document.hasFocus() && !document.querySelector("dialog[open], [role='dialog'][aria-modal='true']");
  async function check() {
    if (stopped || sending) return;
    if (!active()) { since.clear(); return; }
    const now = performance.now(); if (now < retryAt) return;
    const header = document.querySelector("header")?.getBoundingClientRect(); const composer = document.querySelector("[data-chat-composer]")?.getBoundingClientRect();
    const top = Math.max(0, header?.bottom ?? 0); const bottom = composer && composer.top > top && composer.top < innerHeight ? composer.top : innerHeight;
    const visible: string[] = [];
    for (const element of candidates) {
      const id = element.getAttribute(attribute)!; if (done.has(id)) continue;
      const scroller = element.closest<HTMLElement>("[data-chat-scroll]"); const bounds = scroller?.getBoundingClientRect();
      if ((scroller && scroller.dataset.chatReady !== "true") || !element.isConnected || !visibleMessageArea(element.getBoundingClientRect(), { top: Math.max(top, bounds?.top ?? top), bottom: bounds ? Math.min(innerHeight, bounds.bottom) : bottom, width: innerWidth }) || getComputedStyle(element).visibility === "hidden") { since.delete(id); continue; }
      if (!since.has(id)) since.set(id, now);
      if (now - since.get(id)! >= 500) visible.push(id);
    }
    if (!visible.length) return;
    sending = true;
    try {
      const accepted = await acknowledge(visible.slice(0, 100));
      for (const id of accepted) if (scope.has(id)) { done.add(id); since.delete(id); }
      if (!accepted.length) retryAt = performance.now() + 2000;
    } catch { retryAt = performance.now() + 2000; }
    finally { sending = false; }
  }
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { void check(); }); };
  const observer = new IntersectionObserver((entries) => { for (const entry of entries) { const element = entry.target as HTMLElement; if (entry.isIntersecting) candidates.add(element); else { candidates.delete(element); since.delete(element.getAttribute(attribute)!); } } schedule(); }, { threshold: [0, 0.1, 0.5, 1] });
  for (const element of document.querySelectorAll<HTMLElement>(`[${attribute}]`)) if (scope.has(element.getAttribute(attribute)!)) observer.observe(element);
  const resize = new ResizeObserver(schedule);
  for (const selector of ["header", "[data-chat-composer]"]) { const element = document.querySelector(selector); if (element) resize.observe(element); }
  const timer = setInterval(() => { void check(); }, 250);
  window.addEventListener("scroll", schedule, true); window.addEventListener("resize", schedule); window.addEventListener("focus", schedule); window.addEventListener("blur", schedule); document.addEventListener("visibilitychange", schedule);
  return () => { stopped = true; clearInterval(timer); cancelAnimationFrame(frame); observer.disconnect(); resize.disconnect(); window.removeEventListener("scroll", schedule, true); window.removeEventListener("resize", schedule); window.removeEventListener("focus", schedule); window.removeEventListener("blur", schedule); document.removeEventListener("visibilitychange", schedule); };
}
