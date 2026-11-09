"use client";

import { useActionState, useState, useTransition } from "react";
import { updateGroupInfoAction, updateGroupSettingsAction } from "../../social-actions";
import { AvatarPicker } from "@/components/social/Controls";
import { NameField } from "@/components/NameField";
import { MAX_GROUP_NAME } from "@/lib/social/limits";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";

export function GroupInfoForm({ groupId, title, description, avatar, avatars }: { groupId: string; title: string; description: string; avatar: string | null; avatars: string[] }) {
  const [state, action, pending] = useActionState(updateGroupInfoAction.bind(null, groupId), undefined);
  return (
    <form action={action} className="space-y-3">
      <AvatarPicker options={avatars} initial={avatar} />
      <NameField id="title" name="title" label="Name" max={MAX_GROUP_NAME} defaultValue={title} />
      <div>
        <label className="label" htmlFor="description">Description</label>
        <AutoGrowTextarea className="input" id="description" name="description" defaultValue={description} minRows={2} maxRows={6} maxLength={500} />
      </div>
      {state?.error && <p className="text-sm text-danger" role="alert">{state.error}</p>}
      <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
    </form>
  );
}

type Settings = { only_admins_send: boolean; only_admins_edit: boolean; approve_new_members: boolean };

export function GroupSettings({ groupId, initial }: { groupId: string; initial: Settings }) {
  const [settings, setSettings] = useState(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toggle = (key: keyof Settings) => {
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    start(async () => {
      const result = await updateGroupSettingsAction(groupId, next);
      if (result.error) setError(result.error);
    });
  };
  const row = (key: keyof Settings, title: string, hint: string) => (
    <label className="flex cursor-pointer items-start gap-3 text-sm">
      <input type="checkbox" className="mt-0.5 h-4 w-4" checked={settings[key]} disabled={pending} onChange={() => toggle(key)} />
      <span>
        {title}
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </label>
  );
  return (
    <div className="space-y-3">
      {row("only_admins_send", "Only admins can send messages", "Everyone else can read (good for announcements).")}
      {row("only_admins_edit", "Only admins can edit group info", "Name, picture and description.")}
      {row("approve_new_members", "Approve new members", "People who use the invite link ask first; an admin lets them in.")}
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    </div>
  );
}
