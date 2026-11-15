import { z } from "zod";

export const MAX_FILES = 6;
export const MAX_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;
export const FILE_ACCEPT = ".jpg,.jpeg,.png,.webp,.pdf,.txt,.mp4,.webm,.mp3,.m4a,.ogg,.wav";
export const LocationSchema = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), accuracy: z.number().nonnegative().max(100000).optional() }).strict();
export const PollDraftSchema = z.object({ question: z.string().trim().min(1).max(200), options: z.array(z.string().trim().min(1).max(100)).min(2).max(10), people: z.array(z.uuid()).max(19).default([]) }).strict().refine((p) => new Set(p.options.map((o) => o.toLocaleLowerCase())).size === p.options.length, "Use different poll options.");
export const RichSchema = z.object({ clientId: z.uuid(), attachments: z.array(z.uuid()).max(MAX_FILES).default([]), location: LocationSchema.nullable().optional(), poll: PollDraftSchema.nullable().optional() }).strict();
export type SharedLocation = z.infer<typeof LocationSchema>;
export type PollDraft = z.infer<typeof PollDraftSchema>;
export type AttachmentView = { id: string; name: string; mime: string; bytes: number; kind: "image" | "video" | "audio" | "document" };
export const mapsUrl = (p: SharedLocation) => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`;
export const fileSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
