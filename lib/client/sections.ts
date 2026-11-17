/** Sent when a link needs a tab chosen: the detail is the tab panel's id (see components/Tabs). */
export const SHOW_TAB_EVENT = "agentme:show-tab";

/** Open every enclosing disclosure (and choose every enclosing tab) before navigating to content inside it. */
export function revealSection(id: string, focus = false): boolean {
  const target = document.getElementById(id);
  if (!target) return false;
  for (let section = target.closest("details"); section; section = section.parentElement?.closest("details") ?? null) section.open = true;
  // Inside tabs: show the panel now (so it can be scrolled to), and tell its tabs which one is chosen.
  const panels: HTMLElement[] = [];
  for (let panel = target.closest<HTMLElement>("[data-tab-panel]"); panel; panel = panel.parentElement?.closest<HTMLElement>("[data-tab-panel]") ?? null) panels.push(panel);
  for (const panel of panels) {
    panel.hidden = false;
    window.dispatchEvent(new CustomEvent(SHOW_TAB_EVENT, { detail: panel.id }));
  }
  if (focus) {
    // A tab panel is focused through its tab; anything else through itself (or a section's summary).
    const tab = target.matches("[data-tab-panel]") ? document.getElementById(`${target.id}-tab`) : null;
    (tab ?? (target.matches("details") ? target.querySelector("summary") : target))?.focus({ preventScroll: true });
  }
  target.scrollIntoView({ block: "start" });
  return true;
}
