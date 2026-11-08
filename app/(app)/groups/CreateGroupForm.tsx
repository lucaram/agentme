"use client";

import { useActionState, useState } from "react";
import { createGroupAction } from "../social-actions";
import { AvatarPicker } from "@/components/social/Controls";

type Person = { id: string; avatar: string; display_name: string; handle: string };

export function CreateGroupForm({ contacts, avatars }: { contacts: Person[]; avatars: string[] }) {
  const [state, action, pending] = useActionState(createGroupAction, undefined);
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
        ＋ New group
      </button>
    );
  }
  return (
    <form action={action} className="card space-y-4" aria-label="New group">
      <h2 className="font-semibold">New group</h2>
      <AvatarPicker options={avatars} />
      <div>
        <label className="label" htmlFor="group-title">Group name</label>
        <input className="input" id="group-title" name="title" maxLength={80} required placeholder="e.g. Sunday football" />
      </div>
      <div>
        <label className="label" htmlFor="group-description">Description (optional)</label>
        <textarea className="input" id="group-description" name="description" rows={2} maxLength={500} />
      </div>
      <fieldset>
        <legend className="label">Members (from your contacts)</legend>
        {contacts.length ? (
          <div className="flex flex-wrap gap-2">
            {contacts.map((a) => (
              <label key={a.id} className="flex cursor-pointer items-center gap-1 rounded-full border border-border px-3 py-1 text-sm">
                <input type="checkbox" name="members" value={a.id} /> {a.avatar} {a.display_name}
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">Add contacts first (Discover or Contacts).</p>
        )}
      </fieldset>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending || !contacts.length}>{pending ? "Creating…" : "Create group"}</button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <p className="hint">You&apos;ll be the group&apos;s owner. People who only accept group invites get one in their Inbox.</p>
    </form>
  );
}
