import { z } from "zod";

export const MAX_FILES = 6;
export const MAX_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;
/** Word, Excel, PowerPoint and OpenDocument: shared as downloads, and read as text by your agent. */
export const OFFICE_MIME: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
};
/** Archives that can be checked file by file (nothing in them may run). */
export const ARCHIVE_MIME = ["application/zip", "application/x-tar", "application/gzip"];
export const FILE_ACCEPT = ".jpg,.jpeg,.png,.webp,.pdf,.txt,.csv,.rtf,.docx,.xlsx,.pptx,.odt,.ods,.odp,.zip,.tar,.gz,.tgz,.mp4,.webm,.mp3,.m4a,.ogg,.wav";
/** The icon on a file card. */
export function fileIcon(name: string): string {
  const ext = name.split(".").at(-1)?.toLowerCase() ?? "";
  if (["docx", "odt", "rtf"].includes(ext)) return "📝";
  if (["xlsx", "ods", "csv"].includes(ext)) return "📊";
  if (["pptx", "odp"].includes(ext)) return "📽️";
  if (["zip", "tar", "gz", "tgz"].includes(ext)) return "🗜️";
  return "📄";
}
/**
 * My Agent reads photos, PDFs and text files to answer its owner (never passed on to anyone).
 * Kept well inside what the AI accepts (images up to 10 MB, PDFs up to 600 pages), to keep each answer quick and cheap.
 */
export const AGENT_FILE_ACCEPT = ".jpg,.jpeg,.png,.webp,.pdf,.txt,.csv,.rtf,.docx,.xlsx,.pptx,.odt,.ods,.odp";
export const AGENT_FILE_BYTES = 5 * 1024 * 1024;
export const AGENT_MAX_FILES = 3;
export const AGENT_PDF_PAGES = 20;
/** One line under the attach menu in My Agent. */
export const AGENT_FILES_NOTE = "Your agent reads photos, PDFs, Word, Excel, PowerPoint and text files to answer you. They're never sent to anyone else.";
export const LocationSchema = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), accuracy: z.number().nonnegative().max(100000).optional() }).strict();
export const PollDraftSchema = z.object({ question: z.string().trim().min(1).max(200), options: z.array(z.string().trim().min(1).max(100)).min(2).max(10), people: z.array(z.uuid()).max(19).default([]) }).strict().refine((p) => new Set(p.options.map((o) => o.toLocaleLowerCase())).size === p.options.length, "Use different poll options.");
export const RichSchema = z.object({ clientId: z.uuid(), attachments: z.array(z.uuid()).max(MAX_FILES).default([]), location: LocationSchema.nullable().optional(), poll: PollDraftSchema.nullable().optional() }).strict();
export type SharedLocation = z.infer<typeof LocationSchema>;
export type PollDraft = z.infer<typeof PollDraftSchema>;
export type AttachmentView = { id: string; name: string; mime: string; bytes: number; kind: "image" | "video" | "audio" | "document" };
export const mapsUrl = (p: SharedLocation) => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`;
export const fileSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
