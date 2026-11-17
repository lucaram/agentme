import { requireAgent } from "@/lib/auth";
import { currentAppearance } from "@/lib/appearance-server";
import { SettingsHeader } from "../SettingsHeader";
import { PersonaliseForm } from "./PersonaliseForm";

/** Settings → Personalise: how the app looks to you (theme, accent colour, text size, dark style). */
export default async function PersonaliseSettingsPage() {
  const { agent } = await requireAgent();
  const look = await currentAppearance();
  return (
    <div className="space-y-6">
      <SettingsHeader title="Personalise" hint={`Your appearance for @${agent.handle}. Changes apply straight away and follow you to every device. Other accounts and team members keep their own choices.`} />
      <PersonaliseForm key={agent.id} initial={look} name={agent.display_name} />
    </div>
  );
}
