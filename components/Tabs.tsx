"use client";

import { Children, useEffect, useState, type ReactNode } from "react";
import { SHOW_TAB_EVENT } from "@/lib/client/sections";

export type TabSpec = {
  /** The panel's id: links to "#id" open this tab (see revealSection). */
  id: string;
  label: string;
  testId?: string;
  /** A counter on the tab: green for new things, grey for a total. */
  badge?: { count: number; tone: "new" | "total" };
};

/**
 * Tabs inside a section. Every panel stays in the page (hidden when not
 * chosen), so half-typed forms keep their text when you switch, and links to
 * an id inside any panel still work.
 */
export function Tabs({ label, tabs, children }: { label: string; tabs: TabSpec[]; children: ReactNode }) {
  const panels = Children.toArray(children);
  const [active, setActive] = useState(tabs[0]?.id);

  // A link to "#panel" (or to something inside it) chooses that tab: on arrival (the page may have
  // been opened at that address before these tabs were listening), and whenever a link is followed.
  useEffect(() => {
    let id = "";
    try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { /* not a valid address */ }
    const panel = id ? document.getElementById(id)?.closest<HTMLElement>("[data-tab-panel]") : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the address once, on arrival
    if (panel && tabs.some((t) => t.id === panel.id)) setActive(panel.id);
  }, [tabs]);
  useEffect(() => {
    const show = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (tabs.some((t) => t.id === id)) setActive(id);
    };
    window.addEventListener(SHOW_TAB_EVENT, show);
    return () => window.removeEventListener(SHOW_TAB_EVENT, show);
  }, [tabs]);

  const move = (from: number, step: number) => {
    const next = tabs[(from + step + tabs.length) % tabs.length];
    setActive(next.id);
    document.getElementById(`${next.id}-tab`)?.focus();
  };

  return (
    <div>
      <div role="tablist" aria-label={label} className="no-scrollbar flex gap-1 overflow-x-auto border-b border-border px-3 pt-3 sm:px-4">
        {tabs.map((tab, i) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              id={`${tab.id}-tab`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={tab.id}
              tabIndex={selected ? 0 : -1}
              data-testid={tab.testId ? `${tab.testId}-tab` : undefined}
              onClick={() => setActive(tab.id)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") move(i, 1);
                if (e.key === "ArrowLeft") move(i, -1);
              }}
              className={`-mb-px flex shrink-0 items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm transition ${selected ? "border-accent font-semibold text-foreground" : "border-transparent text-muted hover:text-foreground"}`}
            >
              {tab.label}
              {tab.badge && tab.badge.count > 0 && (
                <span
                  className={`rounded-full px-1.5 text-[11px] font-semibold ${tab.badge.tone === "new" ? "bg-accent text-white dark:text-black" : "bg-accent-soft text-muted"}`}
                  aria-label={tab.badge.tone === "new" ? `${tab.badge.count} new` : `${tab.badge.count} in total`}
                  data-testid={tab.testId ? `${tab.testId}-badge` : undefined}
                >
                  {tab.badge.count > 99 ? "99+" : tab.badge.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {tabs.map((tab, i) => (
        <div
          key={tab.id}
          id={tab.id}
          role="tabpanel"
          aria-labelledby={`${tab.id}-tab`}
          data-tab-panel
          data-testid={tab.testId}
          hidden={tab.id !== active}
          className="scroll-mt-40"
        >
          {panels[i]}
        </div>
      ))}
    </div>
  );
}
