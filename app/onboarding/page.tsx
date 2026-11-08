import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getAgentForUser } from "@/lib/data/agents";
import { OnboardingForm } from "./OnboardingForm";
import { safeNext } from "@/lib/next-path";

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const { next } = await searchParams;
  const user = await requireUser();
  if (await getAgentForUser(user.id)) redirect(safeNext(next));
  const suggested = (user.email ?? "").split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-10">
      <h1 className="text-2xl font-semibold">Create your agent</h1>
      <p className="mt-1 text-sm text-muted">Takes less than a minute. You can change everything later.</p>
      <OnboardingForm suggestedHandle={suggested} next={typeof next === "string" ? next : undefined} />
    </main>
  );
}
