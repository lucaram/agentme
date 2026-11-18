import { describe, expect, it } from "vitest";
import { agentFileProblem, pdfPages } from "@/lib/agents/file-checks";

/** A minimal PDF with this many pages (page objects plus the page tree, which isn't a page). */
const pdf = (pages: number) => Buffer.from(`%PDF-1.4\n1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj\n2 0 obj<</Type /Pages /Count ${pages}>>endobj\n${Array.from({ length: pages }, (_, i) => `${i + 3} 0 obj<</Type /Page /Parent 2 0 R>>endobj`).join("\n")}\n%%EOF`, "latin1");

describe("files your agent reads in My Agent", () => {
  it("counts a PDF's pages, not its page tree", () => {
    expect(pdfPages(pdf(1))).toBe(1);
    expect(pdfPages(pdf(21))).toBe(21);
    expect(pdfPages(Buffer.from("not a pdf"))).toBe(0);
  });

  it("reads photos, PDFs and text files up to 5 MB, and PDFs up to 20 pages", () => {
    expect(agentFileProblem({ name: "sign.webp", mime: "image/webp", kind: "image", bytes: 200_000 })).toBeNull();
    expect(agentFileProblem({ name: "flyer.pdf", mime: "application/pdf", kind: "document", bytes: 50_000 }, pdf(3))).toBeNull();
    expect(agentFileProblem({ name: "notes.txt", mime: "text/plain", kind: "document", bytes: 900 })).toBeNull();
    expect(agentFileProblem({ name: "big.pdf", mime: "application/pdf", kind: "document", bytes: 50_000 }, pdf(21))).toBe("big.pdf has more than 20 pages. Attach the pages you need.");
    expect(agentFileProblem({ name: "scan.pdf", mime: "application/pdf", kind: "document", bytes: 6 * 1024 * 1024 })).toMatch(/larger than 5 MB/);
  });

  it("leaves voice messages and videos for chats with people", () => {
    expect(agentFileProblem({ name: "hello.webm", mime: "audio/webm", kind: "audio", bytes: 30_000 })).toMatch(/^Your agent reads photos, PDFs, Word, Excel, PowerPoint and text files/);
    expect(agentFileProblem({ name: "clip.mp4", mime: "video/mp4", kind: "video", bytes: 300_000 })).toMatch(/^Your agent reads photos, PDFs, Word, Excel, PowerPoint and text files/);
  });
});
