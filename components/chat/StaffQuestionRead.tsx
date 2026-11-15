"use client";
import { useEffect } from "react";
import { watchVisibleMessages } from "@/lib/client/message-visibility";
import { acknowledgeBusinessQuestion } from "@/app/(app)/receipt-actions";

export function StaffQuestionRead({ ids }: { ids: string[] }) {
  const key = ids.join(",");
  useEffect(() => watchVisibleMessages(key.split(",").filter(Boolean), "data-staff-question", async (items) => (await Promise.all(items.map(acknowledgeBusinessQuestion))).flat()), [key]);
  return null;
}
