import Link from "next/link";
import { requireAgent } from "@/lib/auth";
import { AddBusinessIntro } from "../AddBusinessIntro";

/** "Add a business" from your personal account. */
export default async function AddBusinessPage() {
  const { agent } = await requireAgent();
  if (agent.type === "business") {
    return (
      <div className="card space-y-2">
        <h1 className="text-lg font-semibold">Add a business</h1>
        <p className="text-sm text-muted">Switch to your personal account first (tap your name at the top), then add your business from there.</p>
        <Link href="/business" className="text-sm text-accent underline">Back to My Business</Link>
      </div>
    );
  }
  return <AddBusinessIntro guest={agent.guest} />;
}
