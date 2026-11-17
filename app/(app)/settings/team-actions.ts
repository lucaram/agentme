"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAgent } from "@/lib/auth";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { forgetPerson, realPerson, signInAs } from "@/lib/identities";
import { tellOwner } from "@/lib/requests/notify";
import { Departure, departureNotes, leftNote } from "@/lib/business/departure";

type Result = { error?: string };

/** Each person's own agent, to post in their My Agent. */
async function personalAgents(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const { data } = await adminClient().from("agents").select("id, owner_id").in("owner_id", ids).eq("type", "personal");
  return new Map((data ?? []).map((a) => [a.owner_id, a.id]));
}

/**
 * Settings → Profile & account → Leave business. Only the person's access to this business ends:
 * they're switched back to their personal account first, then the membership goes (the database
 * hands their assigned requests back to the team and their Staff to the receiving Owner), and the
 * people concerned are told in their My Agent.
 */
export async function leaveBusinessAction(): Promise<Result> {
  const { user, agent } = await requireAgent();
  if (agent.type !== "business" || !user.working || !user.businessRole) return { error: "Open this business from your personal account to leave it." };
  const person = await realPerson(user, agent);
  if (!person) return { error: "Please log in again." };
  const db = adminClient();

  // The same checks as the real thing, before anything changes (sole Owner, the business's own login...).
  const check = await db.rpc("leave_business", { p_business: agent.id, p_person: person, p_dry_run: true });
  if (check.error) return { error: check.error.message };
  const own = (await personalAgents([person])).get(person);
  if (!own) return { error: "Your personal account couldn't be found." };

  // Back to the personal account first: leaving ends this work session.
  if (!(await signInAs(person))) return { error: "Couldn't switch back to your personal account. Please try again." };
  await forgetPerson();

  const done = await db.rpc("leave_business", { p_business: agent.id, p_person: person });
  if (done.error) {
    await tellOwner(person, own, `You're still part of ${agent.display_name}: ${done.error.message}`);
  } else {
    const departure = Departure.safeParse(done.data);
    await tellOwner(person, own, leftNote(agent.display_name));
    if (departure.success) {
      const notes = departureNotes(departure.data);
      const agents = await personalAgents(notes.map((n) => n.to));
      for (const note of notes) {
        const to = agents.get(note.to);
        if (to) await tellOwner(note.to, to, note.text).catch((error) => console.error("departure note failed", error instanceof Error ? error.message : error));
      }
    }
  }
  revalidatePath("/", "layout");
  redirect("/chats");
}

/** Settings → Privacy (an Owner, in the business): be told, or not, when a Manager or Staff member leaves. */
export async function saveDepartureNoticesAction(form: FormData): Promise<void> {
  const { user } = await requireAgent();
  if (user.businessRole !== "owner" || !user.working) redirect("/settings/privacy");
  const { error } = await (await createClient()).rpc("set_business_departure_notices", { p_enabled: form.get("notify_departures") === "on" });
  revalidatePath("/settings/privacy");
  redirect(error ? "/settings/privacy?error=departures" : "/settings/privacy?saved=1");
}
