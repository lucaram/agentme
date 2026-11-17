"use client";

import { AgentSetupForm } from "@/components/onboarding/AgentSetupForm";
import { addBusinessAction } from "../identity-actions";

export function AddBusinessForm() {
  return <AgentSetupForm type="business" managed submit={addBusinessAction} />;
}
