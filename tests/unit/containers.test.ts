import { describe, expect, it } from "vitest";
import { crc32, deflateRawSync, gzipSync } from "node:zlib";
import { officeProblem, officeText, rtfText, tarOrGzProblem, zipProblem } from "@/lib/chat/containers";
import { validateChatFile } from "@/lib/chat/files";

/** A real ZIP: each entry deflated (or stored), with local headers, a central directory and its end record. */
function zip(entries: [string, string | Buffer][], options: { encrypted?: boolean; store?: boolean } = {}): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const data = options.store ? raw : deflateRawSync(raw);
    const nameBytes = Buffer.from(name);
    const flags = options.encrypted ? 1 : 0, method = options.store ? 0 : 8, crc = crc32(raw);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data); centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** A TAR (ustar) with these files. */
function tar(entries: [string, string | Buffer][]): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, content] of entries) {
    const body = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const header = Buffer.alloc(512); header.write(name, 0); header.write("0000644\0", 100); header.write(body.length.toString(8).padStart(11, "0") + "\0", 124); header.write("0", 156); header.write("ustar\0", 257); header.write("00", 263);
    header.write("        ", 148); let sum = 0; for (const b of header) sum += b; header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}

const program = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(300, 7)]);
const TYPES = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const RELS = '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
const DOC = '<w:document><w:body><w:p><w:r><w:t>Jazz night</w:t></w:r></w:p><w:p><w:r><w:t>Friday 21 November &amp; 8pm</w:t></w:r></w:p></w:body></w:document>';
const docx = (extra: [string, string | Buffer][] = [], types = TYPES) => zip([["[Content_Types].xml", types], ["_rels/.rels", RELS], ["word/document.xml", DOC], ...extra]);

describe("archives: shared only when nothing in them can run", () => {
  it("accepts ordinary files", () => {
    expect(zipProblem(zip([["notes.txt", "hello"], ["photos/beach.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], ["docs/", ""]]))).toBeNull();
    expect(zipProblem(zip([["notes.txt", "hello"]], { store: true }))).toBeNull();
  });
  it("refuses programs and scripts, by name or by content (a program renamed to look like a PDF)", () => {
    expect(zipProblem(zip([["setup.exe", program]]))).toMatch(/contains a program or script \(setup\.exe\)/);
    expect(zipProblem(zip([["tools/run.sh", "echo hi"]]))).toMatch(/run\.sh/);
    expect(zipProblem(zip([["invoice.pdf", program]]))).toMatch(/contains a program or script \(invoice\.pdf\)/);
    expect(zipProblem(zip([["notes.txt", "#!/bin/sh\nrm -rf /"]]))).toMatch(/notes\.txt/);
  });
  it("refuses what can't be checked: archives inside, passwords, damage", () => {
    expect(zipProblem(zip([["more.zip", "x"]]))).toMatch(/another archive/);
    expect(zipProblem(zip([["notes.txt", "hello"]], { encrypted: true }))).toBe("Password-protected archives can't be checked.");
    expect(zipProblem(Buffer.from("PK not really"))).toBe("This archive is damaged.");
  });
  it("checks TAR and GZ files too", () => {
    expect(tarOrGzProblem(tar([["notes.txt", "hello"]]), false, "a.tar")).toBeNull();
    expect(tarOrGzProblem(tar([["bin/tool", program]]), false, "a.tar")).toMatch(/program or script \(tool\)/);
    expect(tarOrGzProblem(gzipSync(tar([["notes.txt", "hello"]])), true, "a.tar.gz")).toBeNull();
    expect(tarOrGzProblem(gzipSync(tar([["x.py", "print(1)"]])), true, "a.tgz")).toMatch(/x\.py/);
    expect(tarOrGzProblem(gzipSync(program), true, "report.pdf.gz")).toMatch(/program or script/);
    expect(tarOrGzProblem(Buffer.from("nope"), true, "a.gz")).toMatch(/damaged/);
  });
});

describe("Office and OpenDocument files: shared without macros, read as text", () => {
  it("accepts a plain document and refuses macros, ActiveX and embedded programs", () => {
    expect(officeProblem(docx())).toBeNull();
    expect(officeProblem(docx([["word/vbaProject.bin", "x"]]))).toMatch(/contains macros/);
    expect(officeProblem(docx([], TYPES.replace("document.main+xml", "document.macroEnabled.main+xml")))).toMatch(/contains macros/);
    expect(officeProblem(docx([["word/activeX/activeX1.xml", "<x/>"]]))).toMatch(/embedded objects/);
    expect(officeProblem(docx([["word/embeddings/oleObject1.bin", "x"]]))).toMatch(/embedded objects/);
    expect(officeProblem(docx([["word/media/image1.png", program]]))).toMatch(/program or script/);
    expect(officeProblem(zip([["mimetype", "application/vnd.oasis.opendocument.text"], ["content.xml", "<x/>"], ["Basic/Standard/Module1.xml", "<x/>"]]))).toMatch(/contains macros/);
  });
  it("reads the words in Word, PowerPoint, Excel and OpenDocument files", () => {
    expect(officeText(docx(), "docx")).toBe("Jazz night\nFriday 21 November & 8pm");
    expect(officeText(zip([["ppt/slides/slide2.xml", "<p:sld><a:p><a:t>Thanks</a:t></a:p></p:sld>"], ["ppt/slides/slide1.xml", "<p:sld><a:p><a:t>Welcome</a:t></a:p></p:sld>"]]), "pptx")).toBe("Slide 1\nWelcome\n\nSlide 2\nThanks");
    const xlsx = zip([["xl/sharedStrings.xml", "<sst><si><t>Item</t></si><si><t>Pizza</t></si></sst>"], ["xl/worksheets/sheet1.xml", '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>Price</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>9</v></c></row></sheetData></worksheet>']]);
    expect(officeText(xlsx, "xlsx")).toBe("Sheet 1\nItem\tPrice\nPizza\t9");
    expect(officeText(zip([["content.xml", "<office:text><text:h>Agenda</text:h><text:p>Start at 9</text:p></office:text>"]]), "odt")).toBe("Agenda\nStart at 9");
  });
  it("reads RTF as text", () => {
    expect(rtfText("{\\rtf1\\ansi{\\fonttbl\\f0 Arial;}{\\*\\generator Writer;}\\f0 Hello\\par Caf\\'e9 at 8\\tab pm}")).toBe("Hello\nCafé at 8\tpm");
  });
});

describe("what can be attached (the upload check)", () => {
  const file = (name: string, body: string | Buffer) => new File([Buffer.isBuffer(body) ? new Uint8Array(body) : body], name);
  it("accepts Word, CSV, RTF and ZIP files as downloads", async () => {
    expect(await validateChatFile(file("flyer.docx", docx()))).toMatchObject({ kind: "document", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    expect(await validateChatFile(file("prices.csv", "item,price\npizza,9\n"))).toMatchObject({ kind: "document", mime: "text/csv" });
    expect(await validateChatFile(file("note.rtf", "{\\rtf1\\ansi Hello}"))).toMatchObject({ mime: "application/rtf" });
    expect(await validateChatFile(file("photos.zip", zip([["notes.txt", "hello"]])))).toMatchObject({ mime: "application/zip" });
  });
  it("refuses programs in archives, macros, RTF objects, and says what to do with other formats", async () => {
    await expect(validateChatFile(file("photos.zip", zip([["setup.exe", program]])))).rejects.toThrow(/program or script/);
    await expect(validateChatFile(file("flyer.docx", docx([["word/vbaProject.bin", "x"]])))).rejects.toThrow(/macros/);
    await expect(validateChatFile(file("note.rtf", "{\\rtf1 {\\object\\objemb {\\*\\objdata 0105}}}"))).rejects.toThrow(/embedded objects/);
    await expect(validateChatFile(file("Plan.pages", "x"))).rejects.toThrow(/Export it as PDF or Word/);
    await expect(validateChatFile(file("budget.xls", "x"))).rejects.toThrow(/Save it as \.docx, \.xlsx, \.pptx or PDF/);
    await expect(validateChatFile(file("report.docm", "x"))).rejects.toThrow(/without macros/);
    await expect(validateChatFile(file("backup.7z", "x"))).rejects.toThrow(/Use a ZIP instead/);
    await expect(validateChatFile(file("tool.exe", program))).rejects.toThrow(/Programs and scripts aren't accepted/);
  });
});
