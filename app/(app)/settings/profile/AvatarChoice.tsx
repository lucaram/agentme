"use client";
import { useState } from "react";
import { AvatarPicker } from "@/components/profile/AvatarPicker";
export function AvatarChoice({ options, initial, business = false }: { options: string[]; initial: string; business?: boolean }) {
  const [avatar, setAvatar] = useState(initial);
  return <div><input type="hidden" name="avatar" value={avatar} /><span className="label">Avatar</span><AvatarPicker options={options} value={avatar} onChange={setAvatar} business={business} /></div>;
}
