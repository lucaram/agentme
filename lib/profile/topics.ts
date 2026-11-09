/**
 * "What your agent knows about you": the topics, their quick chips and who
 * sees them by default. Sensitive topics (budget, practical needs) start private.
 * Pure (no server code): used by the profile page and the save actions.
 */
import type { FactCategory } from "@/lib/policy/disclosure";

export type TopicKey = Exclude<FactCategory, "away" | "custom">;

export type Topic = {
  key: TopicKey;
  icon: string;
  title: string;
  /** What it's for, in one line. */
  hint: string;
  placeholder: string;
  chips: string[];
  /** New entries start shared with contacts' agents (false: private). */
  shareByDefault: boolean;
  /** Never shared, whatever the setting. */
  alwaysPrivate?: boolean;
};

export const TOPICS: Topic[] = [
  {
    key: "availability",
    icon: "🗓️",
    title: "When you're free",
    hint: "Used to find times for plans.",
    placeholder: "e.g. Weekday evenings after 6:30 PM; Saturdays after 6 PM",
    chips: ["Weekday evenings", "Weekends", "Saturday afternoons", "Mornings before 9am", "Lunchtimes"],
    shareByDefault: true,
  },
  {
    key: "food",
    icon: "🍽️",
    title: "Food & drink",
    hint: "Used to pick a cuisine or a place for meals and drinks.",
    placeholder: "e.g. Loves Italian and Japanese, vegetarian",
    chips: ["Italian", "Japanese", "Indian", "Thai", "Vegetarian", "Vegan", "Halal", "Gluten-free"],
    shareByDefault: true,
  },
  {
    key: "interests",
    icon: "🎯",
    title: "Hobbies & interests",
    hint: "Used to suggest activities, and for introductions and asking around.",
    placeholder: "e.g. Climbing, cinema, five-a-side",
    chips: ["Climbing", "Running", "Football", "Cinema", "Live music", "Board games", "Cooking", "Travel", "Reading"],
    shareByDefault: true,
  },
  {
    key: "location",
    icon: "📍",
    title: "Where you usually are",
    hint: "Your neighbourhood and how you get around: used to pick places nearby.",
    placeholder: "e.g. Camden, London",
    chips: ["Travels by bike", "Has a car", "Public transport", "Walks everywhere"],
    shareByDefault: false,
  },
  {
    key: "budget",
    icon: "💸",
    title: "Budget for going out",
    hint: "Used to choose places at the right price.",
    placeholder: "e.g. ££, mid-range",
    chips: ["£ keep it cheap", "££ mid-range", "£££ happy to splurge"],
    shareByDefault: false,
  },
  {
    key: "practical",
    icon: "🏠",
    title: "Practical",
    hint: "Circumstances that change what plans suit you (kids, a dog, step-free access, no car…).",
    placeholder: "e.g. Two kids (4 and 7); needs step-free access",
    chips: ["Kids", "Dog", "Step-free access", "Doesn't drink alcohol", "No car"],
    shareByDefault: false,
  },
  {
    key: "notes",
    icon: "🔒",
    title: "Private notes",
    hint: "Anything else, for your own agent only. Never shared.",
    placeholder: "e.g. Saving for a new bike, so keep spending low",
    chips: [],
    shareByDefault: false,
    alwaysPrivate: true,
  },
];

export const MAX_CUSTOM_TOPICS = 5;

/** "Climbing" added to "Cinema" → "Cinema, Climbing" (no duplicates). */
export function addChip(current: string, chip: string): string {
  const parts = current.split(/[,;]\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.some((p) => p.toLowerCase() === chip.toLowerCase())) return current;
  return parts.length ? `${current.trim().replace(/[,;]\s*$/, "")}, ${chip}` : chip;
}

/** Your own topic's name, tidied ("  music i like " → "Music i like"). */
export function cleanLabel(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ").slice(0, 40);
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}
