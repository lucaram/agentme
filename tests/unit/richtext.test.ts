import { describe, expect, it } from "vitest";
import { parseRichText } from "@/lib/richtext";

describe("agent message formatting", () => {
  it("turns a summary into a heading and labelled bullet points", () => {
    const text = "📝 Summary\n- **Decided:** Saturday Italian Dinner at 7:00 PM.\n- **Who's in:** Marco and **Paul**.\n- Plain bullet";
    expect(parseRichText(text)).toEqual([
      { type: "paragraph", content: [{ text: "📝 Summary", bold: false }] },
      {
        type: "list",
        items: [
          { label: "Decided", content: [{ text: "Saturday Italian Dinner at 7:00 PM.", bold: false }] },
          { label: "Who's in", content: [{ text: "Marco and ", bold: false }, { text: "Paul", bold: true }, { text: ".", bold: false }] },
          { label: null, content: [{ text: "Plain bullet", bold: false }] },
        ],
      },
    ]);
  });

  it("accepts labels without bold and numbered lists", () => {
    expect(parseRichText("1. Still open: drinks timing")).toEqual([
      { type: "list", items: [{ label: "Still open", content: [{ text: "drinks timing", bold: false }] }] },
    ]);
  });

  it("keeps markup-like text as plain text (never HTML)", () => {
    expect(parseRichText("<b>hi</b> **bold**")).toEqual([
      { type: "paragraph", content: [{ text: "<b>hi</b> ", bold: false }, { text: "bold", bold: true }] },
    ]);
  });

  it("links only to the app's own allowed pages; any other link keeps just its words", () => {
    expect(parseRichText("You can add it in [What your agent knows about you](/settings/about).")).toEqual([
      { type: "paragraph", content: [{ text: "You can add it in ", bold: false }, { text: "What your agent knows about you", bold: false, href: "/settings/about" }, { text: ".", bold: false }] },
    ]);
    for (const href of ["https://evil.example", "javascript:alert(1)", "//evil.example/settings/about", "/settings/about/../../logout", "/admin"]) {
      const [block] = parseRichText(`Open [this](${href})`);
      const parts = block.type === "paragraph" ? block.content : [];
      expect(parts.some((part) => part.href), href).toBe(false);
      expect(parts.map((part) => part.text).join(""), href).toMatch(/^Open this/);
    }
    expect(parseRichText("**See [Lifestyle](/settings/about/lifestyle)**")[0]).toEqual({ type: "paragraph", content: [{ text: "See ", bold: true }, { text: "Lifestyle", bold: true, href: "/settings/about/lifestyle" }] });
  });
});
