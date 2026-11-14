import type { ReactNode } from "react";
import { LocalTime } from "./LocalTime";

export type ActionActor = { handle: string; avatar: string; display_name?: string };

/** A person's current action, with its saved time in the viewer's time zone. */
export function ActionStamp({ actor, at, children }: { actor: ActionActor; at?: string; children?: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" data-testid="action-stamp">
    <span aria-hidden>{actor.avatar}</span>
    <span className="font-medium" title={`@${actor.handle}`}>{actor.display_name || `@${actor.handle}`}</span>
    {children && <span>{children}</span>}
    {at && <span className="ml-auto text-[11px] tabular-nums text-muted"><LocalTime iso={at} /></span>}
  </div>;
}
