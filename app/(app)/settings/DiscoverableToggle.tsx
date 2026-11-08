"use client";

import { useState, useTransition } from "react";
import { setDiscoverableAction } from "../people-actions";

export function DiscoverableToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4"
        checked={on}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.checked;
          setOn(next);
          start(async () => {
            await setDiscoverableAction(next);
          });
        }}
      />
      <span>
        Let people who have my email or phone number find me
        <span className="block text-xs text-muted">
          {on ? "They'll see you in their list and can send you a request. You decide whether to accept." : "You're hidden: nobody can find you by your email or number."}
        </span>
      </span>
    </label>
  );
}
