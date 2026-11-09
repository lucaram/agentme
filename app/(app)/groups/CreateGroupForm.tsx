"use client";

import { useActionState, useState } from "react";
import { createGroupAction } from "../social-actions";
import { AvatarPicker } from "@/components/social/Controls";
import { NameField } from "@/components/NameField";
import { MAX_GROUP_NAME } from "@/lib/social/limits";
import { ContactSearch } from "@/components/social/ContactSearch";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";

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
      <NameField id="group-title" name="title" label="Group name" max={MAX_GROUP_NAME} placeholder="e.g. Sunday football" />
      <div>
        <label className="label" htmlFor="group-description">Description <span className="font-normal text-muted">· optional</span></label>
        <AutoGrowTextarea className="input" id="group-description" name="description" minRows={2} maxRows={6} maxLength={500} />
      </div>
      <fieldset>
        <legend className="label">Members (from your contacts)</legend>
        <ContactSearch contacts={contacts} />
      </fieldset>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending || !contacts.length}>{pending ? "Creating…" : "Create group"}</button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <p className="hint">You&apos;ll be the group&apos;s owner. People who approve group invites themselves are asked by their agent first.</p>
    </form>
  );
}
