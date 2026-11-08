"use client";

import { useActionState, useState } from "react";
import { AVATARS } from "@/lib/avatars";
import { joinAsGuestAction, joinPlanAction, type JoinState } from "./actions";

/** "Join plan" for people who already have an account. */
export function JoinButton({ token }: { token: string }) {
  const [state, action, pending] = useActionState<JoinState, FormData>(() => joinPlanAction(token), undefined);
  return (
    <form action={action} className="space-y-2">
      <button className="btn-primary w-full" disabled={pending}>{pending ? "Joining…" : "Join this plan"}</button>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
    </form>
  );
}

const toHandle = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20);

/** Guest: just a name (and an address), no email or password. */
export function GuestForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(joinAsGuestAction.bind(null, token), undefined);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [edited, setEdited] = useState(false);
  const [avatar, setAvatar] = useState(AVATARS[0]);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="avatar" value={avatar} />
      <div>
        <label className="label" htmlFor="display_name">Your name</label>
        <input
          className="input"
          id="display_name"
          name="display_name"
          required
          maxLength={60}
          autoComplete="given-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!edited) setHandle(toHandle(e.target.value));
          }}
        />
      </div>
      <div>
        <label className="label" htmlFor="handle">Your address</label>
        <div className="flex items-center gap-1">
          <span className="text-muted">@</span>
          <input
            className="input"
            id="handle"
            name="handle"
            required
            minLength={3}
            maxLength={20}
            value={handle}
            onChange={(e) => {
              setEdited(true);
              setHandle(e.target.value.toLowerCase());
            }}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Avatar">
        {AVATARS.slice(0, 8).map((a) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={avatar === a}
            onClick={() => setAvatar(a)}
            className={`rounded-xl px-2 py-1 text-2xl ${avatar === a ? "bg-accent-soft ring-2 ring-accent" : ""}`}
          >
            {a}
          </button>
        ))}
      </div>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <button className="btn-primary w-full" disabled={pending}>{pending ? "Joining…" : "Join as a guest"}</button>
      <p className="hint">No email or password needed. You can save your account later.</p>
    </form>
  );
}
