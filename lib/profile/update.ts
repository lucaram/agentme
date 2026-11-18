/**
 * Proposed changes to "What your agent knows about you", from what the owner says about themselves
 * in My Agent. Checked against what's saved, shown on a card, and applied only when the owner taps.
 * Pure (no server code): unit-tested.
 */
import { z } from "zod";
import { TOPICS } from "./topics";

export const UPDATE_CATEGORIES = ["availability", "away", "food", "interests", "location", "budget", "practical", "notes", "custom"] as const;
export type UpdateCategory = (typeof UPDATE_CATEGORIES)[number];

export const ProfileUpdateSchema = z.object({
  category: z.enum(UPDATE_CATEGORIES).describe("Where it belongs: availability (when they're usually free), away (time away, with an end date), food, interests, location (where they usually are), budget, practical (allergies, mobility, kids, pets, no car), custom (one of the owner's own topics, named in topic), notes (anything else private)."),
  topic: z.string().max(40).nullable().describe("For custom: the name of one of the owner's own topics, exactly as given. Otherwise null."),
  action: z.enum(["add", "replace", "remove"]).describe("add: new. replace: it changes or contradicts something saved. remove: something saved no longer applies."),
  value: z.string().max(160).describe("The new text, short, in the style of the saved items, without 'I' (e.g. 'Tuesday evenings'). Empty for remove."),
  old: z.string().max(300).nullable().describe("For replace and remove: the saved text it changes, copied exactly from saved. Null for add."),
  reason: z.string().max(120).describe("Why, in a few words addressed to the owner, e.g. 'You said you eat fish now.'"),
  until: z.string().nullable().describe("For away: the last day away, YYYY-MM-DD. Otherwise null."),
});
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;
/** As kept on a card: cards from before your own topics have no topic. */
export const StoredUpdateSchema = ProfileUpdateSchema.extend({ topic: z.string().max(40).nullable().optional().transform((t) => t ?? null) });
export const ProfileUpdatesSchema = z.object({ updates: z.array(ProfileUpdateSchema).max(3) });

/** Where it's shown in Settings → What your agent knows about you. */
export function sectionName(category: UpdateCategory, ownTopic?: string | null): string {
  if (category === "custom") return ownTopic || "your own topic";
  if (category === "away") return "Away for a while";
  const topic = TOPICS.find((t) => t.key === category);
  return topic ? (["availability", "notes"].includes(category) ? topic.title : `Lifestyle → ${topic.title}`) : "your profile";
}

/**
 * Worth a quick look: something the owner says about themselves ("I…", "my…"), not a question or a
 * request (those are answered, not remembered).
 */
export function looksAboutSelf(text: string): boolean {
  const t = text.trim();
  if (t.length < 4 || t.length > 500 || /\?\s*$/.test(t) || /@\w/.test(t)) return false;
  if (/^(please\s+)?(organi[sz]e|arrange|ask|tell|find|book|remind|create|make|send|share|help|show|can you|could you|would you|what|when|where|who|how|why|is|are|do|does)\b/i.test(t)) return false;
  return /\b(i|i'm|im|i am|i've|i'll|i'd|my|me)\b/i.test(t);
}

const clean = (s: string) => s.trim().replace(/\s+/g, " ").replace(/^["“”']|["“”']$/g, "").replace(/[.;,\s]+$/, "");
const has = (text: string | undefined, part: string) => Boolean(text && part && text.toLowerCase().includes(part.toLowerCase()));

/** What can be offered: an addition already saved is dropped; a change must name text that's really saved. */
export function checkUpdate(update: ProfileUpdate, current: string | undefined): ProfileUpdate | null {
  const value = clean(update.value);
  const old = update.old ? clean(update.old) : null;
  if (update.category === "away") return value ? { ...update, value, old: current ?? null } : null;
  if (update.action === "add") return value && !has(current, value) ? { ...update, value, old: null } : null;
  if (update.action === "replace") {
    if (!value) return null;
    if (!old || !has(current, old)) return has(current, value) ? null : { ...update, action: "add", value, old: null };
    return { ...update, value, old };
  }
  return old && has(current, old) ? { ...update, value: "", old } : null;
}

/** The saved text after the change ("keep both": the new text is added next to the old). */
export function applyUpdate(current: string | undefined, update: ProfileUpdate, keepBoth = false): string {
  const base = (current ?? "").trim();
  const join = (a: string, b: string) => (a ? `${a.replace(/[;,.\s]+$/, "")}; ${b}` : b);
  if (update.category === "away") return update.value;
  if (update.action === "add" || keepBoth) return join(base, update.value);
  const at = base.toLowerCase().indexOf((update.old ?? "").toLowerCase());
  if (!update.old || at < 0) return update.action === "replace" ? join(base, update.value) : base;
  const next = base.slice(0, at) + (update.action === "replace" ? update.value : "") + base.slice(at + update.old.length);
  return next.replace(/\s*;\s*(;\s*)+/g, "; ").replace(/\s*,\s*(,\s*)+/g, ", ").replace(/^[\s;,]+|[\s;,]+$/g, "").replace(/\s{2,}/g, " ");
}
