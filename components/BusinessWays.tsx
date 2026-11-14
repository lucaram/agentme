import { wayHref, wayLabel, type Way } from "@/lib/business/booking";

/** The business's own ways to book or order, as buttons (they open the business's own site, phone or WhatsApp). */
export function BusinessWays({ ways, block = false, primary = true }: { ways: Way[]; block?: boolean; primary?: boolean }) {
  if (!ways.length) return null;
  const ordered = [...ways].sort((a, b) => Number(b.primary === true) - Number(a.primary === true));
  const render = (list: Way[], offset = 0) => list.map((w, i) => {
    const external = w.kind !== "call" && w.kind !== "email";
    return <a key={`${w.kind}-${w.value}-${w.label ?? ""}-${i}`} href={wayHref(w)} className={`${i + offset === 0 && primary ? "btn-primary" : "btn-ghost"} text-center`} {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}>{wayLabel(w)}</a>;
  });
  return (
    <div className={`flex flex-wrap gap-2 ${block ? "w-full flex-col" : ""}`} data-testid="business-ways">
      {render(ordered.slice(0, 4))}
      {ordered.length > 4 && <details className="w-full"><summary className="cursor-pointer text-sm text-accent">More options ({ordered.length - 4})</summary><div className={`mt-2 flex flex-wrap gap-2 ${block ? "flex-col" : ""}`}>{render(ordered.slice(4), 4)}</div></details>}
    </div>
  );
}
