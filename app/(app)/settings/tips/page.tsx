import { redirect } from "next/navigation";
import { requireAgent } from "@/lib/auth";

/** Keep existing bookmarks working after moving tips into personal knowledge. */
export default async function TipsSettingsPage() {
  const { agent } = await requireAgent();
  redirect(agent.type === "personal" ? "/settings/about#saved-tips" : "/settings");
}
