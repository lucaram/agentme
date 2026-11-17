"use client";

import { useState } from "react";
import { AgentSetupForm } from "@/components/onboarding/AgentSetupForm";
import { createAgent } from "./actions";

export function OnboardingForm({ suggestedHandle, next }: { suggestedHandle: string; next?: string }) {
  const [type, setType] = useState<"personal" | "business">("personal");
  return <div className="mt-6 space-y-5">
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Account type">
      {(["personal", "business"] as const).map((t) => <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)} className={`card text-left ${type === t ? "border-accent bg-accent-soft" : ""}`}><div className="font-medium">{t === "personal" ? "👤 Personal" : "🏪 Business"}</div><div className="hint">{t === "personal" ? "Coordinate with friends" : "Answer customer questions"}</div></button>)}
    </div>
    <AgentSetupForm key={type} type={type} submit={createAgent} suggestedHandle={suggestedHandle} next={next} />
  </div>;
}
