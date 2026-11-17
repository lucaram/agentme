"use client";
import { useState } from "react";
import { MemberPicker } from "./MemberPicker";
import type { TeamOption } from "@/lib/business/team-types";

export function TeamDashboardFilters({ owner, actorId, scope: initialScope, person: initialPerson, days, teams, people }: { owner: boolean; actorId: string; scope: string; person: string | null; days: number; teams: TeamOption[]; people: TeamOption[] }) {
  const [scope, setScope] = useState(initialScope); const [person, setPerson] = useState(initialPerson ?? (owner ? "" : actorId));
  const needsPerson = scope === "person" || owner && scope === "team";
  const options = scope === "team" ? teams : people.filter((member) => member.role === "staff" || member.former);
  return <form action="/business#customer-dashboard" method="get" className="space-y-3 rounded-2xl border border-border bg-background/40 p-4" aria-label="Dashboard filters">
    <input type="hidden" name="days" value={days} /><input type="hidden" name="person" value={needsPerson ? person : !owner && scope === "team" ? actorId : ""} />
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"><label className="space-y-1 text-sm font-medium"><span>View performance</span><select className="input" name="scope" value={scope} onChange={(event) => { setScope(event.target.value); setPerson(!owner && event.target.value === "team" ? actorId : ""); }}>{owner && <option value="all">Entire business</option>}<option value="team">{owner ? "Manager or Owner team" : "My team"}</option><option value="person">Staff member</option></select></label><button className="btn-primary self-end" disabled={needsPerson && !person}>Apply filters</button></div>
    {needsPerson && <MemberPicker label={scope === "team" ? "Filter by supervisor" : "Filter by Staff member"} options={options} value={person} onChange={setPerson} />}
    <p className="text-xs text-muted">{owner ? "Choose the whole business, a supervisor’s team or an individual Staff member." : "Your team’s activity and current Staff. Search by name or @address."}</p>
  </form>;
}
