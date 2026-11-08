import { wayHref, wayLabel, type Way } from "@/lib/business/booking";

/** The business's own ways to book or order, as buttons (they open the business's own site, phone or WhatsApp). */
export function BusinessWays({ ways, block = false, primary = true }: { ways: Way[]; block?: boolean; primary?: boolean }) {
  if (!ways.length) return null;
  return (
    <div className={`flex flex-wrap gap-2 ${block ? "w-full flex-col" : ""}`} data-testid="business-ways">
      {ways.map((w, i) => {
        const external = w.kind !== "call" && w.kind !== "email";
        return (
          <a
            key={`${w.kind}-${w.value}`}
            href={wayHref(w)}
            className={`${i === 0 && primary ? "btn-primary" : "btn-ghost"} text-center`}
            {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}
          >
            {wayLabel(w)}
          </a>
        );
      })}
    </div>
  );
}
