"use client";

import { useState } from "react";

/** Your agent's avatar (same look as at sign-up); saved with the profile form as "avatar". */
export function AvatarChoice({ options, initial }: { options: string[]; initial: string }) {
  const [avatar, setAvatar] = useState(initial);
  return (
    <div>
      <input type="hidden" name="avatar" value={avatar} />
      <span className="label">Avatar</span>
      <div className="flex flex-wrap gap-2">
        {options.map((a) => (
          <button
            key={a}
            type="button"
            aria-label={`Avatar ${a}`}
            aria-pressed={avatar === a}
            onClick={() => setAvatar(a)}
            className={`h-10 w-10 rounded-full border text-xl ${avatar === a ? "border-accent bg-accent-soft ring-2 ring-accent" : "border-border bg-surface"}`}
          >
            {a}
          </button>
        ))}
      </div>
    </div>
  );
}
