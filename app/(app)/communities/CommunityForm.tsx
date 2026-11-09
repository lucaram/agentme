"use client";

import { useActionState, useState } from "react";
import { createCommunityAction, updateCommunityAction } from "../social-actions";
import { AvatarPicker } from "@/components/social/Controls";

const DEFAULT_RULES = "Be respectful.\nNo spam or selling.\nStay on topic.";

type Values = { name: string; description: string; rules: string; avatar: string; visibility: "public" | "private" };

function Fields({ values, avatars, isOwner }: { values: Values; avatars: string[]; isOwner: boolean }) {
  return (
    <>
      {isOwner && <AvatarPicker options={avatars} initial={values.avatar} />}
      <div>
        <label className="label" htmlFor="c-name">Name</label>
        <input className="input" id="c-name" name="name" defaultValue={values.name} minLength={3} maxLength={60} required disabled={!isOwner} placeholder="e.g. Manchester United fans" />
      </div>
      <div>
        <label className="label" htmlFor="c-description">What is it about?</label>
        <textarea className="input" id="c-description" name="description" defaultValue={values.description} rows={2} maxLength={500} />
      </div>
      <div>
        <label className="label" htmlFor="c-rules">Rules (members accept them to join)</label>
        <textarea className="input" id="c-rules" name="rules" defaultValue={values.rules} rows={3} maxLength={2000} placeholder={DEFAULT_RULES} />
      </div>
      {isOwner && (
        <fieldset className="space-y-1">
          <legend className="label">Who can join</legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="visibility" value="public" defaultChecked={values.visibility === "public"} className="mt-1" />
            <span>Public<span className="block text-xs text-muted">Listed in Communities; anyone can join after accepting the rules.</span></span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="visibility" value="private" defaultChecked={values.visibility === "private"} className="mt-1" />
            <span>Private<span className="block text-xs text-muted">Not listed; people join with an invite link or ask and a moderator approves.</span></span>
          </label>
        </fieldset>
      )}
    </>
  );
}

export function CreateCommunityForm({ avatars }: { avatars: string[] }) {
  const [state, action, pending] = useActionState(createCommunityAction, undefined);
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
        ＋ New community
      </button>
    );
  }
  return (
    <form action={action} className="card space-y-4" aria-label="New community">
      <h2 className="font-semibold">New community</h2>
      {/* The three universal rules come filled in (and are checked automatically); the owner can edit them. */}
      <Fields values={{ name: "", description: "", rules: DEFAULT_RULES, avatar: avatars[0], visibility: "public" }} avatars={avatars} isOwner />
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending}>{pending ? "Creating…" : "Create community"}</button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <p className="hint">It comes with two chats: Announcements (only you and moderators post) and General (everyone).</p>
    </form>
  );
}

export function EditCommunityForm({ id, values, avatars, isOwner }: { id: string; values: Values; avatars: string[]; isOwner: boolean }) {
  const [state, action, pending] = useActionState(updateCommunityAction.bind(null, id), undefined);
  return (
    <form action={action} className="space-y-4">
      {/* Disabled inputs aren't submitted: moderators keep the owner's name/visibility. */}
      {!isOwner && (
        <>
          <input type="hidden" name="name" value={values.name} />
          <input type="hidden" name="visibility" value={values.visibility} />
          <input type="hidden" name="avatar" value={values.avatar} />
        </>
      )}
      <Fields values={values} avatars={avatars} isOwner={isOwner} />
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
    </form>
  );
}
