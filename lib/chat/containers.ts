import { constants, gunzipSync, inflateRawSync } from "node:zlib";

/**
 * Looks inside ZIP-based files (archives, Word/Excel/PowerPoint, OpenDocument), TAR and GZ without
 * unpacking them to disk: what's in them, whether anything could run (programs, scripts, macros), and,
 * for documents, their text. Nothing here ever executes or extracts a file.
 */

/** File names that run code, on any system: refused inside archives and documents. */
const EXECUTABLE = /\.(exe|dll|com|scr|msi|msix|msp|cpl|sys|drv|ocx|bat|cmd|ps1|psm1|vbs|vbe|js|jse|mjs|cjs|wsf|wsh|hta|lnk|reg|inf|jar|class|apk|aab|xapk|ipa|app|dmg|pkg|mpkg|deb|rpm|appimage|sh|bash|zsh|csh|ksh|command|run|bin|elf|so|dylib|py|pyc|pyw|pl|rb|php|cgi|scpt|applescript|workflow|action|xll|xlam|ppam|dotm|docm|xlsm|pptm|potm|sldm|iso|img|vhd|vhdx|crx|xpi|msc|gadget|url|website|desktop)$/i;
/** Archives inside archives can't be checked all the way down. */
const ARCHIVE = /\.(zip|zipx|7z|rar|tar|tgz|gz|bz2|xz|zst|cab|arj|lz|lzh|lha|z)$/i;
const MAX_ENTRIES = 1000;
const MAX_UNPACKED = 200 * 1024 * 1024;
const MAX_PART = 16 * 1024 * 1024;

export type ZipEntry = { name: string; method: number; flags: number; compressedSize: number; size: number; offset: number };

/** A ZIP's table of contents (its central directory). Throws on anything that can't be checked. */
export function zipEntries(buf: Buffer): ZipEntry[] {
  // The end-of-central-directory record: in the last 64 KB (after an optional comment).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("This archive is damaged.");
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || at === 0xffffffff) throw new Error("This archive is too large to check.");
  if (count > MAX_ENTRIES) throw new Error(`This archive has more than ${MAX_ENTRIES} files.`);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) throw new Error("This archive is damaged.");
    const flags = buf.readUInt16LE(at + 8), method = buf.readUInt16LE(at + 10);
    const compressedSize = buf.readUInt32LE(at + 20), size = buf.readUInt32LE(at + 24);
    const nameLength = buf.readUInt16LE(at + 28), extraLength = buf.readUInt16LE(at + 30), commentLength = buf.readUInt16LE(at + 32);
    const offset = buf.readUInt32LE(at + 42);
    if (compressedSize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) throw new Error("This archive is too large to check.");
    entries.push({ name: buf.toString("utf8", at + 46, at + 46 + nameLength), method, flags, compressedSize, size, offset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** One file from a ZIP, at most `max` bytes (stored or deflated only). */
export function zipRead(buf: Buffer, entry: ZipEntry, max = MAX_PART): Buffer {
  if (entry.flags & 1) throw new Error("Password-protected files can't be checked.");
  if (entry.size > max) throw new Error("A file inside is too large to check.");
  const at = entry.offset;
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== 0x04034b50) throw new Error("This archive is damaged.");
  const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
  const data = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return inflateRawSync(data, { maxOutputLength: Math.max(1, max) });
  throw new Error("This archive uses a compression that can't be checked. Save it as a standard ZIP.");
}

/** The first bytes of a file in a ZIP (enough to recognise a program), without unpacking all of it. */
function zipHead(buf: Buffer, entry: ZipEntry): Buffer {
  if (entry.method === 0 || entry.size <= 4096) return zipRead(buf, entry).subarray(0, 8);
  const at = entry.offset;
  const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
  try { return inflateRawSync(buf.subarray(start, start + Math.min(entry.compressedSize, 2048)), { finishFlush: constants.Z_SYNC_FLUSH }).subarray(0, 8); } catch { return Buffer.alloc(0); }
}

/** Programs for Windows, Linux and macOS, and scripts, recognised by their first bytes. */
export function looksExecutable(head: Buffer): boolean {
  if (head.length < 2) return false;
  if (head[0] === 0x4d && head[1] === 0x5a) return true; // MZ: Windows programs and libraries
  if (head[0] === 0x23 && head[1] === 0x21) return true; // #!: scripts
  if (head.length >= 4) {
    const word = head.readUInt32BE(0);
    if (word === 0x7f454c46) return true; // ELF: Linux programs
    if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(word)) return true; // Mach-O, fat binaries, Java classes
    if (word === 0x6465780a) return true; // dex: Android
  }
  return false;
}

/** Why a file inside an archive or document can't be accepted, or null. */
function entryProblem(name: string, head?: Buffer): string | null {
  const base = name.split("/").pop() ?? name;
  if (EXECUTABLE.test(base) || (head && looksExecutable(head))) return `It contains a program or script (${base}), which can't be shared.`;
  if (ARCHIVE.test(base)) return `It contains another archive (${base}), which can't be checked. Unpack it and attach the files instead.`;
  return null;
}

/** A ZIP archive: refused if anything in it could run, is hidden behind a password, or is too big. */
export function zipProblem(buf: Buffer): string | null {
  try {
    const entries = zipEntries(buf);
    let total = 0;
    for (const entry of entries) {
      if (entry.name.endsWith("/")) continue;
      total += entry.size;
      if (total > MAX_UNPACKED) return "This archive unpacks to more than 200 MB.";
      if (entry.flags & 1) return "Password-protected archives can't be checked.";
      const problem = entryProblem(entry.name, zipHead(buf, entry));
      if (problem) return problem;
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "This archive can't be checked.";
  }
}

/** Files in a TAR archive (ustar), with their first bytes. */
function tarProblem(buf: Buffer): string | null {
  let at = 0, count = 0;
  while (at + 512 <= buf.length) {
    const header = buf.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const field = (from: number, to: number) => header.toString("utf8", from, to).replace(/\0[\s\S]*$/, "");
    const prefix = field(345, 500);
    const name = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100);
    const size = parseInt(header.toString("latin1", 124, 136).replace(/\0[\s\S]*$/, "").trim() || "0", 8);
    const type = String.fromCharCode(header[156] || 48);
    if (!Number.isFinite(size) || size < 0) return "This archive is damaged.";
    if (++count > MAX_ENTRIES) return `This archive has more than ${MAX_ENTRIES} files.`;
    if (type === "1" || type === "2") return "Archives with links can't be checked.";
    if (type === "0" || type === "\0" || type === "7") {
      const problem = entryProblem(name, buf.subarray(at + 512, at + 512 + Math.min(size, 8)));
      if (problem) return problem;
    }
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return null;
}

/** TAR and GZ (one compressed file, often a TAR): unpacked in memory, within limits. */
export function tarOrGzProblem(buf: Buffer, gz: boolean, name: string): string | null {
  try {
    if (!gz) return tarProblem(buf);
    const inner = gunzipSync(buf, { maxOutputLength: MAX_UNPACKED });
    const innerName = name.replace(/\.(tgz)$/i, ".tar").replace(/\.gz$/i, "");
    if (/\.tar$/i.test(innerName) || inner.toString("latin1", 257, 262) === "ustar") return tarProblem(inner);
    return entryProblem(innerName, inner.subarray(0, 8));
  } catch {
    return "This archive is damaged or unpacks to more than 200 MB.";
  }
}

/**
 * Word, Excel, PowerPoint and OpenDocument files: refused when they carry macros, ActiveX, embedded
 * programs or OLE objects (the usual ways documents carry malware), or anything that can't be checked.
 */
export function officeProblem(buf: Buffer): string | null {
  try {
    const entries = zipEntries(buf);
    for (const entry of entries) {
      const name = entry.name;
      if (/(^|\/)vbaProject\.bin$|(^|\/)vbaData\.xml$/i.test(name) || /^(Basic|Scripts)\//.test(name)) return "This document contains macros, which can't be shared. Save a copy without macros (.docx, .xlsx, .pptx) or as PDF.";
      if (/(^|\/)activeX\//i.test(name) || /oleObject\d*\.bin$/i.test(name)) return "This document contains embedded objects that can run code. Save a copy without them, or as PDF.";
      if (entry.flags & 1) return "Password-protected documents can't be checked. Remove the password and attach it again.";
      if (!name.endsWith("/")) {
        const problem = entryProblem(name, zipHead(buf, entry));
        if (problem) return `This document can't be shared. ${problem}`;
      }
    }
    const types = entries.find((e) => e.name === "[Content_Types].xml");
    if (types && /macroEnabled/i.test(zipRead(buf, types).toString("utf8"))) return "This document contains macros, which can't be shared. Save a copy without macros (.docx, .xlsx, .pptx) or as PDF.";
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "This document can't be checked.";
  }
}

const decode = (xml: string) => xml.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");
const numbered = (name: string) => Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);

/** The words in an Office or OpenDocument file (pictures and formatting left out). */
export function officeText(buf: Buffer, extension: string): string {
  const entries = zipEntries(buf);
  const part = (name: string) => { const e = entries.find((x) => x.name === name); return e ? zipRead(buf, e).toString("utf8") : ""; };
  const ext = extension.toLowerCase();
  if (ext === "docx") {
    return decode(part("word/document.xml").replace(/<\/w:p>/g, "\n").replace(/<w:tab\/>/g, "\t").replace(/<\/w:tc>/g, "\t").replace(/<[^>]+>/g, "")).replace(/\n{3,}/g, "\n\n").trim();
  }
  if (ext === "pptx") {
    return entries.filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name)).sort((a, b) => numbered(a.name) - numbered(b.name))
      .map((e, i) => `Slide ${i + 1}\n${decode(zipRead(buf, e).toString("utf8").replace(/<\/a:p>/g, "\n").replace(/<[^>]+>/g, "")).trim()}`).join("\n\n");
  }
  if (ext === "xlsx") {
    const shared = [...part("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decode(m[1].replace(/<[^>]+>/g, "")));
    return entries.filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name)).sort((a, b) => numbered(a.name) - numbered(b.name)).map((e, i) => {
      const rows = [...zipRead(buf, e).toString("utf8").matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) =>
        [...row[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((cell) => {
          const value = cell[2]?.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? cell[2]?.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "";
          return /t="s"/.test(cell[1]) ? shared[Number(value)] ?? "" : decode(value);
        }).join("\t"));
      return `Sheet ${i + 1}\n${rows.join("\n")}`;
    }).join("\n\n");
  }
  // OpenDocument (.odt, .ods, .odp): paragraphs, cells and slides in content.xml.
  return decode(part("content.xml").replace(/<\/text:(p|h)>/g, "\n").replace(/<\/table:table-cell>/g, "\t").replace(/<\/table:table-row>/g, "\n").replace(/<\/draw:page>/g, "\n\n").replace(/<text:tab\/>/g, "\t").replace(/<[^>]+>/g, "")).replace(/\n{3,}/g, "\n\n").trim();
}

/** RTF's words, without its control codes. Embedded objects (a known way to carry exploits) are refused before this. */
export function rtfText(rtf: string): string {
  // Groups that hold settings, not words (fonts, colours, styles, document info, pictures, "\*" extras).
  const SKIP = /^\\(\*|(fonttbl|colortbl|stylesheet|info|pict|listtable|listoverridetable|rsidtbl|generator|xmlnstbl|themedata|colorschememapping|latentstyles|datastore)\b)/;
  let out = "";
  const skipping: boolean[] = [false];
  for (let i = 0; i < rtf.length; i++) {
    const ch = rtf[i];
    if (ch === "{") { skipping.push(skipping[skipping.length - 1] || SKIP.test(rtf.slice(i + 1, i + 40))); continue; }
    if (ch === "}") { if (skipping.length > 1) skipping.pop(); continue; }
    const skip = skipping[skipping.length - 1];
    if (ch === "\\") {
      const next = rtf[i + 1];
      if (next === "'" ) { if (!skip) out += String.fromCharCode(parseInt(rtf.slice(i + 2, i + 4), 16)); i += 3; continue; }
      if (next === "\\" || next === "{" || next === "}") { if (!skip) out += next; i++; continue; }
      const word = rtf.slice(i + 1).match(/^([a-z]+)(-?\d+)? ?/i);
      if (word) {
        if (!skip && (word[1] === "par" || word[1] === "line")) out += "\n";
        else if (!skip && word[1] === "tab") out += "\t";
        i += word[0].length;
        continue;
      }
      i++;
      continue;
    }
    if (!skip && ch !== "\r" && ch !== "\n") out += ch;
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}
