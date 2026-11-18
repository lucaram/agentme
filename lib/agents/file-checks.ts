import { AGENT_FILE_BYTES, AGENT_PDF_PAGES } from "@/lib/chat/rich";

/** What My Agent can read (after upload, photos are WebP). */
const ACCEPTED = ["image/webp", "image/jpeg", "image/png", "application/pdf", "text/plain"];

/** Pages in a PDF (its page objects; "/Type /Pages" is the page tree, not a page). */
export function pdfPages(body: Buffer): number {
  return body.toString("latin1").match(/\/Type\s*\/Page(?![a-z])/gi)?.length ?? 0;
}

/** Why your agent can't read this file, or null when it can. */
export function agentFileProblem(file: { name: string; mime: string; kind: string; bytes: number }, body?: Buffer): string | null {
  if (!ACCEPTED.includes(file.mime) || (file.kind !== "image" && file.kind !== "document")) return `Your agent reads photos, PDFs and text files. ${file.name} can be shared in a chat with people instead.`;
  if (file.bytes > AGENT_FILE_BYTES) return `${file.name} is larger than ${AGENT_FILE_BYTES / 1024 / 1024} MB. Attach a smaller file or a few pages of it.`;
  if (body && file.mime === "application/pdf" && pdfPages(body) > AGENT_PDF_PAGES) return `${file.name} has more than ${AGENT_PDF_PAGES} pages. Attach the pages you need.`;
  return null;
}

