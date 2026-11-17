"use server";

import { revalidatePath } from "next/cache";
import { requireBusinessPermission } from "@/lib/business/access";
import { patchBusinessInfo } from "@/lib/business/profile";
import { pageSettingsFrom } from "@/lib/business/public-page";
import { decodeCover, removeCover, saveCover } from "@/lib/business/cover-server";
import { hit } from "@/lib/limits";

type Out = { error?: string; saved?: boolean };

const refresh = (handle: string) => {
  revalidatePath("/business");
  revalidatePath(`/u/${handle}`);
};

/** Public page & sharing: what the page shows and its colour (Owners and Managers). */
export async function savePublicPageAction(_prev: Out | undefined, form: FormData): Promise<Out> {
  const { agent } = await requireBusinessPermission("configure");
  const settings = pageSettingsFrom({ accent: form.get("accent"), show: form.getAll("show") });
  try {
    await patchBusinessInfo(agent.id, { page: settings });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Couldn't save. Please try again." };
  }
  refresh(agent.handle);
  return { saved: true };
}

/** A new cover image for the public page, or none. */
export async function saveCoverAction(_prev: Out | undefined, form: FormData): Promise<Out> {
  const { user, agent } = await requireBusinessPermission("configure");
  try {
    if (form.get("remove") === "1") {
      await removeCover(agent.id);
    } else {
      const file = form.get("cover");
      if (!(file instanceof File) || !file.size) return { error: "Choose an image first." };
      if (!(await hit("coverUploadsPerUser", user.actorId ?? user.id)).allowed) return { error: "You've changed the cover several times. Please try again in a minute." };
      await saveCover(agent.id, await decodeCover(file));
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Couldn't save the cover. Please try again." };
  }
  refresh(agent.handle);
  return { saved: true };
}
