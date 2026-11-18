import { AGENT_FILE_BYTES, AGENT_PDF_PAGES, OFFICE_MIME } from "@/lib/chat/rich";

/** What My Agent can read (after upload, photos are WebP). */
const ACCEPTED = ["image/webp", "image/jpeg", "image/png", "application/pdf", ...TEXT_MIME()];
/** Documents your agent reads as text (their words; pictures inside are left out). */
function TEXT_MIME() { return ["text/plain", "text/csv", "application/rtf", ...Object.values(OFFICE_MIME)]; }
export const readAsText = (mime: string) => TEXT_MIME().includes(mime);
/** About 20 pages of text: longer documents are refused (attach the part you need). */
export const AGENT_TEXT_CHARS = 60_000;

/** Pages in a PDF (its page objects; "/Type /Pages" is the page tree, not a page). */
export function pdfPages(body: Buffer): number {
  return body.toString("latin1").match(/\/Type\s*\/Page(?![a-z])/gi)?.length ?? 0;
}

/** Why your agent can't read this file, or null when it can. */
export function agentFileProblem(file: { name: string; mime: string; kind: string; bytes: number }, body?: Buffer): string | null {
  if (!ACCEPTED.includes(file.mime) || (file.kind !== "image" && file.kind !== "document")) return `Your agent reads photos, PDFs, Word, Excel, PowerPoint and text files. ${file.name} can be shared in a chat with people instead.`;
  if (file.bytes > AGENT_FILE_BYTES) return `${file.name} is larger than ${AGENT_FILE_BYTES / 1024 / 1024} MB. Attach a smaller file or a few pages of it.`;
  if (body && file.mime === "application/pdf" && pdfPages(body) > AGENT_PDF_PAGES) return `${file.name} has more than ${AGENT_PDF_PAGES} pages. Attach the pages you need.`;
  return null;
}

