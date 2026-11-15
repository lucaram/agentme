import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { validateChatFile } from "@/lib/chat/files";
import { LocationSchema, PollDraftSchema, MAX_FILE_BYTES, mapsUrl } from "@/lib/chat/rich";

describe("chat attachment validation", () => {
  it("decodes, downsizes and re-encodes photos without EXIF metadata", async () => {
    const png = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "#44aa77" } }).png().withMetadata().toBuffer();
    const result = await validateChatFile(new File([new Uint8Array(png)], "holiday.png", { type: "image/png" }));
    expect(result).toMatchObject({ kind: "image", mime: "image/webp", name: "holiday.webp" });
    const metadata = await sharp(result.body).metadata();
    expect(metadata.width).toBeLessThanOrEqual(1920); expect(metadata.exif).toBeUndefined();
  });
  it("rejects spoofed extensions, active PDFs, executable/web/archive formats and binary text", async () => {
    for (const [name, body] of [["invoice.pdf", "MZ executable"], ["image.png", "<svg onload='alert(1)'/>"], ["run.exe", "MZ00000"], ["page.html", "<html>hello</html>"], ["archive.zip", "PKxxxx"], ["note.txt", "hello\0binary"], ["active.pdf", "%PDF-1.4\n1 0 obj << /OpenAction << /S /JavaScript /JS (alert(1)) >> >> endobj\n%%EOF"]]) {
      await expect(validateChatFile(new File([body], name))).rejects.toThrow();
    }
  });
  it("keeps passive PDFs and UTF-8 text as downloadable documents", async () => {
    expect(await validateChatFile(new File(["Hello Luca 👋"], "note.txt"))).toMatchObject({ kind: "document", mime: "text/plain" });
    expect(await validateChatFile(new File(["%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF"], "note.pdf"))).toMatchObject({ kind: "document", mime: "application/pdf" });
  });
  it("enforces the byte limit before file parsing", async () => {
    await expect(validateChatFile(new File([new Uint8Array(MAX_FILE_BYTES + 1)], "large.txt"))).rejects.toThrow(/16 MB/);
  });
  it("accepts M4A recordings and normalises their legacy MIME alias for playback", async () => {
    const body = Buffer.from("00000018667479704d3441200000000069736f6d6d703432", "hex");
    expect(await validateChatFile(new File([new Uint8Array(body)], "voice.m4a", { type: "audio/mp4" }), "audio")).toMatchObject({ kind: "audio", mime: "audio/mp4", name: "voice.m4a" });
  });
  it("accepts only bounded numeric location snapshots and constructs Google Maps URLs itself", () => {
    for (const p of [{ lat: 91, lon: 0 }, { lat: 0, lon: Infinity }, { lat: NaN, lon: 0 }, { lat: 1, lon: 2, url: "javascript:alert(1)" }]) expect(LocationSchema.safeParse(p).success).toBe(false);
    expect(mapsUrl(LocationSchema.parse({ lat: 56.001, lon: -3.784 }))).toBe("https://www.google.com/maps/search/?api=1&query=56.001,-3.784");
  });
  it("requires a real question and at least two distinct poll options", () => {
    expect(PollDraftSchema.safeParse({ question: "Dinner?", options: ["Pizza", " pizza "] }).success).toBe(false);
    expect(PollDraftSchema.safeParse({ question: "", options: ["Pizza", "Sushi"] }).success).toBe(false);
    expect(PollDraftSchema.parse({ question: "Dinner?", options: ["Pizza", "Sushi"] }).options).toHaveLength(2);
  });
});
